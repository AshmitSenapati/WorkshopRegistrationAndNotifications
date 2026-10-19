import * as registrationService from '../services/registrationService.js';

export async function registerMember(req, res, next) {
  try {
    const workshopId = req.params.id;
    const registration = await registrationService.registerMember(workshopId, req.body);
    res.status(201).json({
      success: true,
      data: registration,
    });
  } catch (err) {
    next(err);
  }
}

export async function listRegistrations(req, res, next) {
  try {
    const workshopId = req.params.id;
    const registrations = await registrationService.listRegistrations(workshopId);
    res.status(200).json({
      success: true,
      count: registrations.length,
      data: registrations,
    });
  } catch (err) {
    next(err);
  }
}
