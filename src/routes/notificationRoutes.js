import { Router } from 'express';
import * as notificationController from '../controllers/notificationController.js';
import validate from '../middleware/validate.js';
import { listJobsSchema } from './schemas.js';

const router = Router();

router.get('/jobs', validate(listJobsSchema), notificationController.listJobs);
router.get('/jobs/:id', notificationController.getJobById);

export default router;
