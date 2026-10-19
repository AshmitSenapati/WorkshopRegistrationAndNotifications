import { Router } from 'express';
import mockStore from './mockStore.js';
import logger from '../utils/logger.js';

const router = Router();

// Test Delivery Ingestion Endpoint
router.post('/notifications', async (req, res) => {
  const idempotencyKey = req.headers['x-idempotency-key'] || req.body?.idempotencyKey;

  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Missing x-idempotency-key header or body property' });
  }

  const { jobId, eventType, recipientId, destination, payload } = req.body || {};

  if (!jobId || !eventType || !recipientId || !destination) {
    return res.status(400).json({ error: 'Missing required delivery payload fields' });
  }

  const result = await mockStore.processNotification({
    idempotencyKey,
    jobId,
    eventType,
    recipientId,
    destination,
    payload,
  });

  return res.status(result.statusCode).json(result.body);
});

// Mock Service Health Endpoint
router.get('/mock/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'mock-notification-service',
    timestamp: new Date().toISOString(),
  });
});

// Mock Configuration Endpoints for Tests & Demonstrations
router.get('/mock/config', (req, res) => {
  res.status(200).json({
    success: true,
    config: mockStore.getConfig(),
  });
});

router.post('/mock/config', (req, res) => {
  const updated = mockStore.updateConfig(req.body);
  res.status(200).json({
    success: true,
    message: 'Configuration updated',
    config: updated,
  });
});

// Mock Delivery Inspection Endpoints
router.get('/mock/deliveries', async (req, res) => {
  const deliveries = await mockStore.getAllDeliveries();
  res.status(200).json({
    success: true,
    count: deliveries.length,
    deliveries,
  });
});

router.post('/mock/deliveries/clear', async (req, res) => {
  await mockStore.clearDeliveries();
  res.status(200).json({
    success: true,
    message: 'Mock deliveries and attempt counters cleared',
  });
});

export default router;
