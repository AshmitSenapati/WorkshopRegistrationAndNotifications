import { v4 as uuidv4 } from 'uuid';
import MockDelivery from '../models/MockDelivery.js';
import logger from '../utils/logger.js';

class MockNotificationStore {
  constructor() {
    this.resetConfig();
    this.inMemoryDeliveries = new Map();
    this.attemptCounters = new Map();
  }

  resetConfig() {
    this.config = {
      failMode: 'none', // 'none' | '500' | '503' | 'timeout'
      failRecipientId: null,
      failFirstNAttempts: 0,
      delayMs: 0,
      failAll: false,
    };
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    logger.info('Mock notification service configuration updated', this.config);
    return this.config;
  }

  getConfig() {
    return { ...this.config };
  }

  clear() {
    this.resetConfig();
    this.inMemoryDeliveries.clear();
    this.attemptCounters.clear();
  }

  async processNotification({ idempotencyKey, jobId, eventType, recipientId, destination, payload }) {
    // 1. Artificial delay if configured
    if (this.config.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.delayMs));
    }

    // 2. Track attempts for this idempotency key
    const currentAttempts = (this.attemptCounters.get(idempotencyKey) || 0) + 1;
    this.attemptCounters.set(idempotencyKey, currentAttempts);

    // 3. Deduplication Check: Check persistent DB or in-memory
    let existingDelivery = null;
    try {
      existingDelivery = await MockDelivery.findOne({ idempotencyKey });
    } catch {
      existingDelivery = this.inMemoryDeliveries.get(idempotencyKey);
    }

    if (existingDelivery) {
      logger.info('Duplicate delivery attempt detected (idempotent deduplication)', {
        idempotencyKey,
        jobId,
        recipientId,
        receivedAttempts: currentAttempts,
      });

      // Update delivery record
      try {
        await MockDelivery.updateOne(
          { idempotencyKey },
          { $inc: { receivedCount: 1 }, $set: { lastReceivedAt: new Date() } }
        );
      } catch {
        if (this.inMemoryDeliveries.has(idempotencyKey)) {
          const rec = this.inMemoryDeliveries.get(idempotencyKey);
          rec.receivedCount += 1;
          rec.lastReceivedAt = new Date();
        }
      }

      return {
        statusCode: 200,
        body: {
          status: 'deduplicated',
          idempotencyKey,
          message: 'Notification previously accepted and delivered',
        },
      };
    }

    // 4. Failure Simulations
    if (this.config.failMode === 'timeout') {
      // Simulate timeout by delaying longer than worker timeout
      await new Promise((resolve) => setTimeout(resolve, 8000));
      return {
        statusCode: 504,
        body: { error: 'Gateway Timeout (simulated)' },
      };
    }

    if (this.config.failAll) {
      return {
        statusCode: 500,
        body: { error: 'Internal Server Error (simulated global failure)' },
      };
    }

    if (this.config.failRecipientId && this.config.failRecipientId === recipientId) {
      return {
        statusCode: 500,
        body: { error: `Recipient failure simulation for '${recipientId}'` },
      };
    }

    if (this.config.failFirstNAttempts > 0 && currentAttempts <= this.config.failFirstNAttempts) {
      return {
        statusCode: 503,
        body: {
          error: `Simulated temporary failure (attempt ${currentAttempts} of ${this.config.failFirstNAttempts})`,
        },
      };
    }

    if (this.config.failMode === '500') {
      return {
        statusCode: 500,
        body: { error: 'Simulated HTTP 500 Internal Server Error' },
      };
    }

    if (this.config.failMode === '503') {
      return {
        statusCode: 503,
        body: { error: 'Simulated HTTP 503 Service Unavailable' },
      };
    }

    // 5. Successful Delivery Acceptance
    const deliveryRecord = {
      idempotencyKey,
      jobId,
      eventType,
      recipientId,
      destination,
      payload,
      status: 'accepted',
      receivedCount: 1,
      receivedAt: new Date(),
      lastReceivedAt: new Date(),
    };

    try {
      const doc = new MockDelivery(deliveryRecord);
      await doc.save();
    } catch {
      this.inMemoryDeliveries.set(idempotencyKey, deliveryRecord);
    }

    logger.info('Mock notification accepted successfully', {
      idempotencyKey,
      jobId,
      recipientId,
      destination,
      eventType,
    });

    return {
      statusCode: 200,
      body: {
        status: 'accepted',
        deliveryId: uuidv4(),
        idempotencyKey,
        jobId,
        receivedAt: deliveryRecord.receivedAt,
      },
    };
  }

  async getAllDeliveries() {
    try {
      const deliveries = await MockDelivery.find().sort({ receivedAt: -1 });
      if (deliveries.length > 0) return deliveries;
    } catch {
      // Fallback to in-memory
    }
    return Array.from(this.inMemoryDeliveries.values());
  }

  async clearDeliveries() {
    this.attemptCounters.clear();
    this.inMemoryDeliveries.clear();
    try {
      await MockDelivery.deleteMany({});
    } catch {
      // Ignore
    }
  }
}

export const mockStore = new MockNotificationStore();
export default mockStore;
