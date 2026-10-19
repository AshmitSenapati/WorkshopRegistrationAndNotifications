import * as workshopService from '../services/workshopService.js';

export async function createWorkshop(req, res, next) {
  try {
    const workshop = await workshopService.createWorkshop(req.body);
    res.status(201).json({
      success: true,
      data: workshop,
    });
  } catch (err) {
    next(err);
  }
}

export async function listWorkshops(req, res, next) {
  try {
    const workshops = await workshopService.listWorkshops(req.query);
    res.status(200).json({
      success: true,
      count: workshops.length,
      data: workshops,
    });
  } catch (err) {
    next(err);
  }
}

export async function getWorkshopById(req, res, next) {
  try {
    const workshop = await workshopService.getWorkshopById(req.params.id);
    res.status(200).json({
      success: true,
      data: workshop,
    });
  } catch (err) {
    next(err);
  }
}

export async function cancelWorkshop(req, res, next) {
  try {
    const reason = req.body?.reason;
    const result = await workshopService.cancelWorkshop(req.params.id, reason);
    res.status(200).json({
      success: true,
      data: result.workshop,
      meta: {
        alreadyCancelled: result.alreadyCancelled,
        jobsCreated: result.jobsCreated,
      },
    });
  } catch (err) {
    next(err);
  }
}
