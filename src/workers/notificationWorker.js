import { v4 as uuidv4 } from 'uuid';
import NotificationJob from '../models/NotificationJob.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';

export class NotificationWorker {
  constructor(options = {}) {
    this.workerId = options.workerId || `worker-${uuidv4()}`;
    this.pollIntervalMs = options.pollIntervalMs ?? config.WORKER_POLL_INTERVAL_MS;
    this.batchSize = options.batchSize ?? config.WORKER_BATCH_SIZE;
    this.leaseDurationMs = options.leaseDurationMs ?? config.WORKER_LEASE_DURATION_MS;
    this.maxAttempts = options.maxAttempts ?? config.WORKER_MAX_ATTEMPTS;
    this.initialBackoffMs = options.initialBackoffMs ?? config.WORKER_INITIAL_BACKOFF_MS;
    this.backoffFactor = options.backoffFactor ?? config.WORKER_BACKOFF_FACTOR;
    this.maxBackoffMs = options.maxBackoffMs ?? config.WORKER_MAX_BACKOFF_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? config.WORKER_REQUEST_TIMEOUT_MS;
    this.mockUrl = options.mockUrl || config.MOCK_NOTIFICATION_URL;
    this.jitterMs = options.jitterMs ?? 200;

    this.isRunning = false;
    this.isPolling = false;
    this.timer = null;
    this.activeJobs = new Set();

    this.validateConfig();
  }

  validateConfig() {
    if (this.pollIntervalMs <= 0) throw new Error('pollIntervalMs must be positive');
    if (this.leaseDurationMs <= 0) throw new Error('leaseDurationMs must be positive');
    if (this.maxAttempts < 1) throw new Error('maxAttempts must be at least 1');
    if (this.initialBackoffMs <= 0) throw new Error('initialBackoffMs must be positive');
    if (this.backoffFactor < 1) throw new Error('backoffFactor must be at least 1');
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('Notification worker started', { workerId: this.workerId, pollIntervalMs: this.pollIntervalMs });
    this.scheduleNextPoll(0);
  }

  async stop(timeoutMs = 5000) {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    logger.info('Notification worker stopping, waiting for in-flight jobs...', {
      workerId: this.workerId,
      activeJobsCount: this.activeJobs.size,
    });

    const start = Date.now();
    while (this.activeJobs.size > 0 && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    logger.info('Notification worker stopped gracefully', {
      workerId: this.workerId,
      remainingInFlight: this.activeJobs.size,
    });
  }

  scheduleNextPoll(delayMs = this.pollIntervalMs) {
    if (!this.isRunning) return;
    this.timer = setTimeout(() => this.pollAndProcess(), delayMs);
  }

  async pollAndProcess() {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      const jobPromises = [];
      // Process up to batchSize jobs in one poll cycle
      for (let i = 0; i < this.batchSize; i++) {
        const job = await this.claimJob();
        if (!job) break; // No due jobs available

        jobPromises.push(
          this.processJob(job).catch((err) => {
            logger.error('Unhandled error during job processing', { jobId: job.jobId, error: err.message });
          })
        );
      }
      await Promise.all(jobPromises);
    } catch (err) {
      logger.error('Error during worker poll cycle', { workerId: this.workerId, error: err.message });
    } finally {
      this.isPolling = false;
      if (this.isRunning) {
        this.scheduleNextPoll();
      }
    }
  }

  /**
   * Atomically claims a due job or recovers a job whose processing lease expired.
   */
  async claimJob() {
    const now = new Date();
    const leaseExpiration = new Date(Date.now() + this.leaseDurationMs);

    return NotificationJob.findOneAndUpdate(
      {
        $or: [
          { status: 'pending', nextAttemptAt: { $lte: now } },
          { status: 'processing', leaseExpiresAt: { $lte: now } }, // Expired lease recovery
        ],
      },
      {
        $set: {
          status: 'processing',
          lockedBy: this.workerId,
          leaseExpiresAt: leaseExpiration,
        },
      },
      {
        returnDocument: 'after',
        sort: { nextAttemptAt: 1 },
      }
    );
  }

  /**
   * Delivers a claimed job to the mock HTTP notification service.
   * Uses idempotency key, handles retries, backoff, dead-lettering, and fencing.
   */
  async processJob(job) {
    this.activeJobs.add(job.jobId);
    try {
      logger.info('Worker processing notification job', {
        workerId: this.workerId,
        jobId: job.jobId,
        eventType: job.eventType,
        attempt: job.attemptCount + 1,
        recipientId: job.recipientId,
      });

      const response = await this.dispatchNotification(job);

      if (response.ok) {
        // Success: Transition to delivered
        const updateResult = await NotificationJob.updateOne(
          {
            jobId: job.jobId,
            lockedBy: this.workerId, // Fencing: verify worker still owns the lease
            status: 'processing',
          },
          {
            $set: {
              status: 'delivered',
              deliveredAt: new Date(),
              leaseExpiresAt: null,
              lockedBy: null,
            },
            $inc: { attemptCount: 1 },
          }
        );

        if (updateResult.matchedCount === 0) {
          logger.warn('Stale worker lease: Job was already reclaimed by another worker after timeout', {
            workerId: this.workerId,
            jobId: job.jobId,
          });
        } else {
          logger.info('Notification job delivered successfully', {
            workerId: this.workerId,
            jobId: job.jobId,
            recipientId: job.recipientId,
          });
        }
      } else {
        const errorBody = await response.text().catch(() => '');
        await this.handleFailure(job, new Error(`HTTP ${response.status}: ${errorBody || response.statusText}`));
      }
    } catch (err) {
      await this.handleFailure(job, err);
    } finally {
      this.activeJobs.delete(job.jobId);
    }
  }

  async dispatchNotification(job) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await fetch(this.mockUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-idempotency-key': job.idempotencyKey,
          'x-job-id': job.jobId,
          'x-worker-id': this.workerId,
        },
        body: JSON.stringify({
          jobId: job.jobId,
          eventType: job.eventType,
          workshopId: job.workshopId,
          recipientId: job.recipientId,
          destination: job.destination,
          payload: job.payload,
        }),
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async handleFailure(job, err) {
    const nextAttemptCount = job.attemptCount + 1;
    const isPermanent = nextAttemptCount >= this.maxAttempts;

    let nextAttemptAt = new Date();
    if (!isPermanent) {
      // Exponential backoff with optional jitter
      const exponentialDelay = this.initialBackoffMs * Math.pow(this.backoffFactor, nextAttemptCount - 1);
      const cappedDelay = Math.min(this.maxBackoffMs, exponentialDelay);
      const jitter = Math.floor(Math.random() * (this.jitterMs + 1));
      const totalDelay = cappedDelay + jitter;
      nextAttemptAt = new Date(Date.now() + totalDelay);
    }

    const lastError = {
      message: err.message,
      name: err.name,
      timestamp: new Date(),
    };

    const updateResult = await NotificationJob.updateOne(
      {
        jobId: job.jobId,
        lockedBy: this.workerId, // Fencing: protect against stale worker
        status: 'processing',
      },
      {
        $set: {
          status: isPermanent ? 'dead_lettered' : 'pending',
          nextAttemptAt,
          lastError,
          leaseExpiresAt: null,
          lockedBy: null,
        },
        $inc: { attemptCount: 1 },
      }
    );

    if (updateResult.matchedCount === 0) {
      logger.warn('Stale worker lease: Failure update ignored as job was reclaimed', {
        workerId: this.workerId,
        jobId: job.jobId,
      });
    } else {
      logger.warn(
        isPermanent
          ? `Notification job permanently failed after ${nextAttemptCount} attempts, moved to dead-lettered`
          : `Notification job failed (attempt ${nextAttemptCount}/${this.maxAttempts}), scheduled retry`,
        {
          workerId: this.workerId,
          jobId: job.jobId,
          recipientId: job.recipientId,
          error: err.message,
          nextAttemptAt: isPermanent ? null : nextAttemptAt,
        }
      );
    }
  }
}

export default NotificationWorker;
