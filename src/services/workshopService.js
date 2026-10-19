import { v4 as uuidv4 } from 'uuid';
import Workshop from '../models/Workshop.js';
import Registration from '../models/Registration.js';
import NotificationJob from '../models/NotificationJob.js';
import { runInTransaction } from '../utils/db.js';
import { NotFoundError, BadRequestError } from '../utils/errors.js';
import logger from '../utils/logger.js';

export async function createWorkshop({ title, description, organizerId }) {
  const workshopId = uuidv4();
  const workshop = new Workshop({
    workshopId,
    title,
    description,
    organizerId,
    status: 'active',
  });
  await workshop.save();
  logger.info('Workshop created', { workshopId, title });
  return workshop;
}

export async function listWorkshops(filter = {}) {
  const query = {};
  if (filter.status) {
    query.status = filter.status;
  }
  if (filter.organizerId) {
    query.organizerId = filter.organizerId;
  }
  return Workshop.find(query).sort({ createdAt: -1 });
}

export async function getWorkshopById(workshopId) {
  const workshop = await Workshop.findOne({ workshopId });
  if (!workshop) {
    throw new NotFoundError(`Workshop with id '${workshopId}' not found`);
  }
  return workshop;
}

/**
 * Atomically cancels a workshop and schedules cancellation notification jobs
 * for all currently registered members inside a multi-document transaction.
 * Repeated cancellations are idempotent and create no duplicate jobs.
 */
export async function cancelWorkshop(workshopId, reason = 'Workshop cancelled by organizer') {
  return runInTransaction(async (session) => {
    // 1. Check if workshop exists
    const existing = await Workshop.findOne({ workshopId }, null, { session });
    if (!existing) {
      throw new NotFoundError(`Workshop with id '${workshopId}' not found`);
    }

    // 2. Idempotency: If already cancelled, do not recreate notification jobs
    if (existing.status === 'cancelled') {
      logger.info('Workshop is already cancelled', { workshopId });
      return {
        workshop: existing,
        alreadyCancelled: true,
        jobsCreated: 0,
      };
    }

    // 3. Atomically transition status to cancelled
    const updatedWorkshop = await Workshop.findOneAndUpdate(
      { workshopId, status: 'active' },
      { $set: { status: 'cancelled' } },
      { session, returnDocument: 'after' }
    );

    if (!updatedWorkshop) {
      throw new BadRequestError('Could not cancel workshop: status was updated concurrently');
    }

    // 4. Retrieve every registration for this workshop
    const registrations = await Registration.find({ workshopId }, null, { session });

    // 5. Create one distinct cancellation job per registered member
    const jobs = registrations.map((reg) => ({
      jobId: uuidv4(),
      eventType: 'workshop_cancellation',
      workshopId,
      registrationId: reg.registrationId,
      recipientId: reg.memberId,
      destination: reg.destination,
      status: 'pending',
      attemptCount: 0,
      nextAttemptAt: new Date(),
      idempotencyKey: `cancel:${workshopId}:${reg.memberId}`,
      payload: {
        workshopTitle: updatedWorkshop.title,
        cancellationReason: reason,
        memberId: reg.memberId,
      },
    }));

    if (jobs.length > 0) {
      await NotificationJob.insertMany(jobs, { session });
    }

    logger.info('Workshop cancelled and notification jobs created', {
      workshopId,
      registeredMembersCount: registrations.length,
      jobsScheduled: jobs.length,
    });

    return {
      workshop: updatedWorkshop,
      alreadyCancelled: false,
      jobsCreated: jobs.length,
    };
  });
}
