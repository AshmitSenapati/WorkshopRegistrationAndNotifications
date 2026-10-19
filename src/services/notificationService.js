import NotificationJob from '../models/NotificationJob.js';
import { NotFoundError } from '../utils/errors.js';

export async function listNotificationJobs(filter = {}, pagination = {}) {
  const query = {};

  if (filter.workshopId) {
    query.workshopId = filter.workshopId;
  }
  if (filter.status) {
    query.status = filter.status;
  }
  if (filter.eventType) {
    query.eventType = filter.eventType;
  }
  if (filter.recipientId) {
    query.recipientId = filter.recipientId;
  }

  const limit = Math.min(Number(pagination.limit) || 50, 100);
  const skip = Math.max(Number(pagination.skip) || 0, 0);

  const [total, jobs] = await Promise.all([
    NotificationJob.countDocuments(query),
    NotificationJob.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
  ]);

  return {
    total,
    count: jobs.length,
    jobs,
  };
}

export async function getNotificationJobById(jobId) {
  const job = await NotificationJob.findOne({ jobId });
  if (!job) {
    throw new NotFoundError(`Notification job '${jobId}' not found`);
  }
  return job;
}
