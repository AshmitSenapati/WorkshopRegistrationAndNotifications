import * as notificationService from '../services/notificationService.js';

export async function listJobs(req, res, next) {
  try {
    const { workshopId, status, eventType, recipientId, limit, skip } = req.validatedQuery || req.query;
    const result = await notificationService.listNotificationJobs(
      { workshopId, status, eventType, recipientId },
      { limit, skip }
    );
    res.status(200).json({
      success: true,
      total: result.total,
      count: result.count,
      data: result.jobs,
    });
  } catch (err) {
    next(err);
  }
}

export async function getJobById(req, res, next) {
  try {
    const job = await notificationService.getNotificationJobById(req.params.id);
    res.status(200).json({
      success: true,
      data: job,
    });
  } catch (err) {
    next(err);
  }
}
