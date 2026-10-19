import { v4 as uuidv4 } from 'uuid';
import Workshop from '../models/Workshop.js';
import Registration from '../models/Registration.js';
import NotificationJob from '../models/NotificationJob.js';
import { runInTransaction } from '../utils/db.js';
import { NotFoundError, BadRequestError, ConflictError } from '../utils/errors.js';
import logger from '../utils/logger.js';

/**
 * Registers a member for a workshop using the Transactional Outbox pattern.
 * Creates the registration and notification job atomically inside a MongoDB transaction.
 * Returns immediately without waiting for HTTP delivery.
 */
export async function registerMember(workshopId, { memberId, destination }) {
  return runInTransaction(async (session) => {
    // 1. Fetch workshop to verify existence and active status
    const workshop = await Workshop.findOne({ workshopId }, null, { session });
    if (!workshop) {
      throw new NotFoundError(`Workshop with id '${workshopId}' not found`);
    }

    if (workshop.status !== 'active') {
      throw new BadRequestError(`Cannot register: workshop is '${workshop.status}'`);
    }

    // 2. Concurrency guard: Touch the workshop document conditionally inside the transaction.
    // If a cancellation transaction is committing concurrently, this triggers MongoDB write-conflict
    // detection, ensuring registration cannot commit after cancellation has won.
    const activeLock = await Workshop.findOneAndUpdate(
      { workshopId, status: 'active' },
      { $inc: { __v: 1 } },
      { session, returnDocument: 'after' }
    );

    if (!activeLock) {
      throw new BadRequestError('Cannot register: workshop was cancelled concurrently');
    }

    // 3. Pre-check for duplicate registration to give a clear error before index violation
    const existingReg = await Registration.findOne({ workshopId, memberId }, null, { session });
    if (existingReg) {
      throw new ConflictError(`Member '${memberId}' is already registered for workshop '${workshopId}'`);
    }

    // 4. Create registration record
    const registrationId = uuidv4();
    const registration = new Registration({
      registrationId,
      workshopId,
      memberId,
      destination,
      createdAt: new Date(),
    });

    try {
      await registration.save({ session });
    } catch (err) {
      if (err.code === 11000) {
        throw new ConflictError(`Member '${memberId}' is already registered for workshop '${workshopId}'`);
      }
      throw err;
    }

    // 5. Create confirmation notification job in outbox
    const jobId = uuidv4();
    const job = new NotificationJob({
      jobId,
      eventType: 'registration_confirmation',
      workshopId,
      registrationId,
      recipientId: memberId,
      destination,
      status: 'pending',
      attemptCount: 0,
      nextAttemptAt: new Date(),
      idempotencyKey: `reg_conf:${registrationId}`,
      payload: {
        workshopTitle: workshop.title,
        memberId,
        destination,
        registrationId,
      },
    });

    await job.save({ session });

    logger.info('Member registered and confirmation job scheduled', {
      workshopId,
      memberId,
      registrationId,
      jobId,
    });

    return registration;
  });
}

export async function listRegistrations(workshopId) {
  const workshop = await Workshop.findOne({ workshopId });
  if (!workshop) {
    throw new NotFoundError(`Workshop with id '${workshopId}' not found`);
  }

  return Registration.find({ workshopId }).sort({ createdAt: 1 });
}
