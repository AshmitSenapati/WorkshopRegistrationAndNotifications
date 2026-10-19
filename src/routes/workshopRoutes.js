import { Router } from 'express';
import * as workshopController from '../controllers/workshopController.js';
import * as registrationController from '../controllers/registrationController.js';
import validate from '../middleware/validate.js';
import {
  createWorkshopSchema,
  getWorkshopSchema,
  registerMemberSchema,
  cancelWorkshopSchema,
} from './schemas.js';

const router = Router();

router.post('/', validate(createWorkshopSchema), workshopController.createWorkshop);
router.get('/', workshopController.listWorkshops);
router.get('/:id', validate(getWorkshopSchema), workshopController.getWorkshopById);

// Registration routes nested under workshop
router.post('/:id/registrations', validate(registerMemberSchema), registrationController.registerMember);
router.get('/:id/registrations', validate(getWorkshopSchema), registrationController.listRegistrations);

// Workshop cancellation
router.post('/:id/cancel', validate(cancelWorkshopSchema), workshopController.cancelWorkshop);

export default router;
