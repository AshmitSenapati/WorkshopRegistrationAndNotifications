import { z } from 'zod';

export const createWorkshopSchema = {
  body: z.object({
    title: z.string({ required_error: 'Title is required' }).trim().min(1, 'Title cannot be empty').max(200),
    description: z.string({ required_error: 'Description is required' }).trim().min(1, 'Description cannot be empty'),
    organizerId: z.string({ required_error: 'Organizer ID is required' }).trim().min(1, 'Organizer ID cannot be empty'),
  }),
};

export const getWorkshopSchema = {
  params: z.object({
    id: z.string().trim().min(1, 'Workshop ID is required'),
  }),
};

export const registerMemberSchema = {
  params: z.object({
    id: z.string().trim().min(1, 'Workshop ID is required'),
  }),
  body: z.object({
    memberId: z.string({ required_error: 'memberId is required' }).trim().min(1, 'memberId cannot be empty'),
    destination: z.string({ required_error: 'destination is required' }).trim().min(1, 'destination cannot be empty'),
  }),
};

export const cancelWorkshopSchema = {
  params: z.object({
    id: z.string().trim().min(1, 'Workshop ID is required'),
  }),
  body: z.object({
    reason: z.string().trim().optional(),
  }).optional(),
};

export const listJobsSchema = {
  query: z.object({
    workshopId: z.string().optional(),
    status: z.preprocess(
      (val) => (val === 'dead-lettered' ? 'dead_lettered' : val),
      z.enum(['pending', 'processing', 'delivered', 'dead_lettered']).optional()
    ),
    eventType: z.enum(['registration_confirmation', 'workshop_cancellation']).optional(),
    recipientId: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    skip: z.coerce.number().int().min(0).optional(),
  }),
};
