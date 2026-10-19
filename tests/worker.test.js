import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import NotificationJob from '../src/models/NotificationJob.js';
import MockDelivery from '../src/models/MockDelivery.js';
import NotificationWorker from '../src/workers/notificationWorker.js';
import mockStore from '../src/notification-mock/mockStore.js';
import { createMockApp } from '../src/notification-mock/mockServer.js';
import { setupTestDB, teardownTestDB, clearDatabase } from './setup.js';

describe('4. Worker, Retry Policy, Leases & Idempotency', () => {
  let mockServer;
  let mockPort = 5520;
  let mockUrl;

  beforeAll(async () => {
    await setupTestDB();
    const mockApp = createMockApp();
    mockServer = mockApp.listen(mockPort);
    mockUrl = `http://127.0.0.1:${mockPort}/notifications`;
  });

  afterAll(async () => {
    if (mockServer) {
      await new Promise((resolve) => mockServer.close(resolve));
    }
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearDatabase();
    mockStore.clear();
  });

  it('9. Handles HTTP 500, HTTP 503, connection failure, and timeout retry behavior', async () => {
    // 9a: HTTP 500
    mockStore.updateConfig({ failMode: '500' });
    const job500 = await NotificationJob.create({
      jobId: 'job-500',
      eventType: 'registration_confirmation',
      workshopId: 'ws-1',
      recipientId: 'user-500',
      destination: 'u500@example.com',
      status: 'pending',
      nextAttemptAt: new Date(),
      idempotencyKey: 'idem-500',
    });

    const worker = new NotificationWorker({ mockUrl, initialBackoffMs: 200, jitterMs: 0 });
    const claimed500 = await worker.claimJob();
    await worker.processJob(claimed500);

    const after500 = await NotificationJob.findOne({ jobId: 'job-500' });
    expect(after500.status).toBe('pending');
    expect(after500.attemptCount).toBe(1);
    expect(after500.lastError.message).toMatch(/500/);
    expect(after500.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() - 1000);

    // 9b: HTTP 503
    mockStore.updateConfig({ failMode: '503' });
    const job503 = await NotificationJob.create({
      jobId: 'job-503',
      eventType: 'registration_confirmation',
      workshopId: 'ws-1',
      recipientId: 'user-503',
      destination: 'u503@example.com',
      status: 'pending',
      nextAttemptAt: new Date(),
      idempotencyKey: 'idem-503',
    });

    const claimed503 = await worker.claimJob();
    await worker.processJob(claimed503);

    const after503 = await NotificationJob.findOne({ jobId: 'job-503' });
    expect(after503.status).toBe('pending');
    expect(after503.attemptCount).toBe(1);
    expect(after503.lastError.message).toMatch(/503/);

    // 9c: Connection failure (invalid unreachable port)
    const deadWorker = new NotificationWorker({
      mockUrl: 'http://127.0.0.1:59999/notifications',
      initialBackoffMs: 200,
    });
    const jobConn = await NotificationJob.create({
      jobId: 'job-conn',
      eventType: 'registration_confirmation',
      workshopId: 'ws-1',
      recipientId: 'user-conn',
      destination: 'uconn@example.com',
      status: 'pending',
      nextAttemptAt: new Date(),
      idempotencyKey: 'idem-conn',
    });

    const claimedConn = await deadWorker.claimJob();
    await deadWorker.processJob(claimedConn);

    const afterConn = await NotificationJob.findOne({ jobId: 'job-conn' });
    expect(afterConn.status).toBe('pending');
    expect(afterConn.attemptCount).toBe(1);
    expect(afterConn.lastError).toBeDefined();

    // 9d: Request timeout
    mockStore.updateConfig({ delayMs: 1500 });
    const timeoutWorker = new NotificationWorker({
      mockUrl,
      requestTimeoutMs: 300, // Aborts after 300ms
      initialBackoffMs: 200,
    });
    const jobTimeout = await NotificationJob.create({
      jobId: 'job-timeout',
      eventType: 'registration_confirmation',
      workshopId: 'ws-1',
      recipientId: 'user-timeout',
      destination: 'utimeout@example.com',
      status: 'pending',
      nextAttemptAt: new Date(),
      idempotencyKey: 'idem-timeout',
    });

    const claimedTimeout = await timeoutWorker.claimJob();
    await timeoutWorker.processJob(claimedTimeout);

    const afterTimeout = await NotificationJob.findOne({ jobId: 'job-timeout' });
    expect(afterTimeout.status).toBe('pending');
    expect(afterTimeout.attemptCount).toBe(1);
    expect(afterTimeout.lastError.name).toMatch(/AbortError|Error/);
  });

  it('10. Retry recovery after the mock service becomes healthy', async () => {
    // Fail first 2 attempts, then recover
    mockStore.updateConfig({ failFirstNAttempts: 2 });

    const job = await NotificationJob.create({
      jobId: 'job-recover-10',
      eventType: 'registration_confirmation',
      workshopId: 'ws-10',
      recipientId: 'user-10',
      destination: 'u10@example.com',
      status: 'pending',
      nextAttemptAt: new Date(),
      idempotencyKey: 'idem-recover-10',
    });

    const worker = new NotificationWorker({ mockUrl, initialBackoffMs: 100, jitterMs: 0 });

    // Attempt 1 -> Fails
    let claimed = await worker.claimJob();
    await worker.processJob(claimed);
    let current = await NotificationJob.findOne({ jobId: 'job-recover-10' });
    expect(current.status).toBe('pending');
    expect(current.attemptCount).toBe(1);

    // Make due again
    await NotificationJob.updateOne({ jobId: 'job-recover-10' }, { nextAttemptAt: new Date(Date.now() - 1000) });

    // Attempt 2 -> Fails
    claimed = await worker.claimJob();
    await worker.processJob(claimed);
    current = await NotificationJob.findOne({ jobId: 'job-recover-10' });
    expect(current.status).toBe('pending');
    expect(current.attemptCount).toBe(2);

    // Make due again
    await NotificationJob.updateOne({ jobId: 'job-recover-10' }, { nextAttemptAt: new Date(Date.now() - 1000) });

    // Attempt 3 -> Succeeds!
    claimed = await worker.claimJob();
    await worker.processJob(claimed);
    current = await NotificationJob.findOne({ jobId: 'job-recover-10' });
    expect(current.status).toBe('delivered');
    expect(current.attemptCount).toBe(3);
    expect(current.deliveredAt).not.toBeNull();
  });

  it('11. Persistence of jobs across worker and API restarts', async () => {
    // Insert a pending job
    await NotificationJob.create({
      jobId: 'job-persist-11',
      eventType: 'registration_confirmation',
      workshopId: 'ws-11',
      recipientId: 'user-11',
      destination: 'u11@example.com',
      status: 'pending',
      nextAttemptAt: new Date(),
      idempotencyKey: 'idem-persist-11',
    });

    // Simulate Worker Instance 1 starting, doing partial work or shutting down
    const worker1 = new NotificationWorker({ mockUrl });
    worker1.start();
    await worker1.stop(); // Worker 1 crashes / stops

    // Simulate Worker Instance 2 starting later in a new lifecycle
    const worker2 = new NotificationWorker({ mockUrl });
    const claimed = await worker2.claimJob();
    expect(claimed).not.toBeNull();
    expect(claimed.jobId).toBe('job-persist-11');

    await worker2.processJob(claimed);

    const delivered = await NotificationJob.findOne({ jobId: 'job-persist-11' });
    expect(delivered.status).toBe('delivered');
  });

  it('12. Recovery of a job with an expired processing lease', async () => {
    // Job was claimed 30 seconds ago by a worker that died, lease expired 10 seconds ago
    await NotificationJob.create({
      jobId: 'job-lease-12',
      eventType: 'registration_confirmation',
      workshopId: 'ws-12',
      recipientId: 'user-12',
      destination: 'u12@example.com',
      status: 'processing',
      lockedBy: 'crashed-worker-dead',
      leaseExpiresAt: new Date(Date.now() - 10000), // Expired!
      nextAttemptAt: new Date(Date.now() - 20000),
      idempotencyKey: 'idem-lease-12',
    });

    const activeWorker = new NotificationWorker({
      workerId: 'surviving-worker',
      mockUrl,
      leaseDurationMs: 15000,
    });

    // Active worker polls and claims the expired lease job
    const reclaimed = await activeWorker.claimJob();
    expect(reclaimed).not.toBeNull();
    expect(reclaimed.jobId).toBe('job-lease-12');
    expect(reclaimed.lockedBy).toBe('surviving-worker');
    expect(reclaimed.leaseExpiresAt.getTime()).toBeGreaterThan(Date.now());

    await activeWorker.processJob(reclaimed);

    const finalJob = await NotificationJob.findOne({ jobId: 'job-lease-12' });
    expect(finalJob.status).toBe('delivered');
  });

  it('13. Worker claim safety with competing workers', async () => {
    // Create 5 jobs
    const jobs = Array.from({ length: 5 }, (_, i) => ({
      jobId: `job-compete-${i}`,
      eventType: 'registration_confirmation',
      workshopId: 'ws-13',
      recipientId: `user-compete-${i}`,
      destination: `compete${i}@example.com`,
      status: 'pending',
      nextAttemptAt: new Date(Date.now() - (5 - i) * 1000),
      idempotencyKey: `idem-compete-${i}`,
    }));
    await NotificationJob.insertMany(jobs);

    const workerA = new NotificationWorker({ workerId: 'worker-A', mockUrl });
    const workerB = new NotificationWorker({ workerId: 'worker-B', mockUrl });
    const workerC = new NotificationWorker({ workerId: 'worker-C', mockUrl });

    // Compete to claim jobs concurrently
    const claims = await Promise.all([
      workerA.claimJob(),
      workerB.claimJob(),
      workerC.claimJob(),
      workerA.claimJob(),
      workerB.claimJob(),
    ]);

    const nonNullClaims = claims.filter(Boolean);
    const claimedJobIds = nonNullClaims.map((c) => c.jobId);
    const uniqueClaimedJobIds = new Set(claimedJobIds);

    // Every claimed job must be unique (no two workers claimed the same job!)
    expect(claimedJobIds.length).toBe(uniqueClaimedJobIds.size);
  });

  it('17. Mock-service idempotency prevents duplicate accepted deliveries', async () => {
    const idempotencyKey = 'idem-unique-17';
    const payload = {
      jobId: 'job-17',
      eventType: 'registration_confirmation',
      recipientId: 'member-17',
      destination: 'm17@example.com',
    };

    // First attempt -> Accepted
    const res1 = await fetch(mockUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-idempotency-key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    });
    const body1 = await res1.json();
    expect(res1.status).toBe(200);
    expect(body1.status).toBe('accepted');

    // Second attempt with same key -> Deduplicated
    const res2 = await fetch(mockUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-idempotency-key': idempotencyKey,
      },
      body: JSON.stringify(payload),
    });
    const body2 = await res2.json();
    expect(res2.status).toBe(200);
    expect(body2.status).toBe('deduplicated');

    // Check MockDelivery persistent count
    const deliveries = await MockDelivery.find({ idempotencyKey });
    expect(deliveries.length).toBe(1);
    expect(deliveries[0].receivedCount).toBe(2);
  });

  it('18. Crash after delivery acceptance but before job acknowledgement', async () => {
    const idempotencyKey = 'idem-crash-18';
    const job = await NotificationJob.create({
      jobId: 'job-crash-18',
      eventType: 'registration_confirmation',
      workshopId: 'ws-18',
      recipientId: 'user-crash-18',
      destination: 'crash18@example.com',
      status: 'pending',
      nextAttemptAt: new Date(),
      idempotencyKey,
    });

    const crashedWorker = new NotificationWorker({ workerId: 'worker-will-crash', mockUrl });
    const claimed = await crashedWorker.claimJob();

    // Worker dispatches to mock service successfully
    const response = await crashedWorker.dispatchNotification(claimed);
    expect(response.ok).toBe(true);

    // Simulated Crash: The worker dies here without executing `updateOne` to mark job delivered in DB.
    // Expire the lease to simulate time passing
    await NotificationJob.updateOne(
      { jobId: job.jobId },
      { $set: { leaseExpiresAt: new Date(Date.now() - 5000) } }
    );

    // Another worker recovers the job
    const recoveryWorker = new NotificationWorker({ workerId: 'recovery-worker', mockUrl });
    const recoveredJob = await recoveryWorker.claimJob();
    expect(recoveredJob).not.toBeNull();
    expect(recoveredJob.jobId).toBe(job.jobId);

    // Recovery worker dispatches with the same idempotency key
    await recoveryWorker.processJob(recoveredJob);

    // Final job status is delivered
    const finalJob = await NotificationJob.findOne({ jobId: job.jobId });
    expect(finalJob.status).toBe('delivered');

    // And Mock service deduplicated the second delivery attempt without double-counting!
    const mockRecord = await MockDelivery.findOne({ idempotencyKey });
    expect(mockRecord).not.toBeNull();
    expect(mockRecord.receivedCount).toBe(2);
  });

  it('19. Dead-lettering after the configured retry limit', async () => {
    mockStore.updateConfig({ failAll: true });

    const job = await NotificationJob.create({
      jobId: 'job-dlq-19',
      eventType: 'registration_confirmation',
      workshopId: 'ws-19',
      recipientId: 'user-dlq-19',
      destination: 'dlq19@example.com',
      status: 'pending',
      nextAttemptAt: new Date(),
      idempotencyKey: 'idem-dlq-19',
    });

    const worker = new NotificationWorker({
      mockUrl,
      maxAttempts: 3,
      initialBackoffMs: 50,
      jitterMs: 0,
    });

    // Attempt 1
    let claimed = await worker.claimJob();
    await worker.processJob(claimed);

    // Attempt 2
    await NotificationJob.updateOne({ jobId: 'job-dlq-19' }, { nextAttemptAt: new Date(Date.now() - 1000) });
    claimed = await worker.claimJob();
    await worker.processJob(claimed);

    // Attempt 3 (Final attempt -> reaches maxAttempts = 3)
    await NotificationJob.updateOne({ jobId: 'job-dlq-19' }, { nextAttemptAt: new Date(Date.now() - 1000) });
    claimed = await worker.claimJob();
    await worker.processJob(claimed);

    const dlqJob = await NotificationJob.findOne({ jobId: 'job-dlq-19' });
    expect(dlqJob.status).toBe('dead_lettered');
    expect(dlqJob.attemptCount).toBe(3);
    expect(dlqJob.lastError).toBeDefined();
  });

  it('21. Graceful worker shutdown and restart', async () => {
    const worker = new NotificationWorker({
      mockUrl,
      pollIntervalMs: 100,
    });

    worker.start();
    expect(worker.isRunning).toBe(true);

    await worker.stop();
    expect(worker.isRunning).toBe(false);

    // Restart
    worker.start();
    expect(worker.isRunning).toBe(true);

    await worker.stop();
    expect(worker.isRunning).toBe(false);
  });
});
