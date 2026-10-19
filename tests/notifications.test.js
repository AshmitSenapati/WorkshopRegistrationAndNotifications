import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import NotificationJob from '../src/models/NotificationJob.js';
import { setupTestDB, teardownTestDB, clearDatabase } from './setup.js';

describe('6. Notification Jobs Query API & Outbox Inspection', () => {
  let app;

  beforeAll(async () => {
    await setupTestDB();
    app = createApp();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearDatabase();

    // Populate outbox with representative jobs
    await NotificationJob.create([
      {
        jobId: 'job-inspect-1',
        eventType: 'registration_confirmation',
        workshopId: 'ws-alpha',
        recipientId: 'member-1',
        destination: 'm1@example.com',
        status: 'pending',
        attemptCount: 0,
        nextAttemptAt: new Date(Date.now() + 10000),
        idempotencyKey: 'key-1',
      },
      {
        jobId: 'job-inspect-2',
        eventType: 'registration_confirmation',
        workshopId: 'ws-alpha',
        recipientId: 'member-2',
        destination: 'm2@example.com',
        status: 'delivered',
        attemptCount: 1,
        deliveredAt: new Date(),
        idempotencyKey: 'key-2',
      },
      {
        jobId: 'job-inspect-3',
        eventType: 'workshop_cancellation',
        workshopId: 'ws-beta',
        recipientId: 'member-3',
        destination: 'm3@example.com',
        status: 'dead_lettered',
        attemptCount: 5,
        lastError: { message: 'HTTP 500: Persistent outage' },
        idempotencyKey: 'key-3',
      },
    ]);
  });

  it('lists all notification jobs with pagination totals (GET /api/notifications/jobs)', async () => {
    const res = await request(app)
      .get('/api/notifications/jobs')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.total).toBe(3);
    expect(res.body.count).toBe(3);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(3);
  });

  it('filters notification jobs by workshopId', async () => {
    const res = await request(app)
      .get('/api/notifications/jobs?workshopId=ws-alpha')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.total).toBe(2);
    expect(res.body.count).toBe(2);
    expect(res.body.data.every((j) => j.workshopId === 'ws-alpha')).toBe(true);
  });

  it('filters notification jobs by status', async () => {
    const resDelivered = await request(app)
      .get('/api/notifications/jobs?status=delivered')
      .expect(200);

    expect(resDelivered.body.total).toBe(1);
    expect(resDelivered.body.data[0].jobId).toBe('job-inspect-2');

    // Also verify dead-lettered format (with hyphen) is normalized and accepted
    const resDlq = await request(app)
      .get('/api/notifications/jobs?status=dead-lettered')
      .expect(200);

    expect(resDlq.body.total).toBe(1);
    expect(resDlq.body.data[0].jobId).toBe('job-inspect-3');
    expect(resDlq.body.data[0].status).toBe('dead_lettered');
  });

  it('filters notification jobs by eventType and recipientId', async () => {
    const resEvent = await request(app)
      .get('/api/notifications/jobs?eventType=workshop_cancellation')
      .expect(200);

    expect(resEvent.body.total).toBe(1);
    expect(resEvent.body.data[0].jobId).toBe('job-inspect-3');

    const resRecipient = await request(app)
      .get('/api/notifications/jobs?recipientId=member-1')
      .expect(200);

    expect(resRecipient.body.total).toBe(1);
    expect(resRecipient.body.data[0].jobId).toBe('job-inspect-1');
  });

  it('supports pagination with limit and skip', async () => {
    const res = await request(app)
      .get('/api/notifications/jobs?limit=1&skip=1')
      .expect(200);

    expect(res.body.total).toBe(3);
    expect(res.body.count).toBe(1);
  });

  it('retrieves a single notification job by ID (GET /api/notifications/jobs/:id)', async () => {
    const res = await request(app)
      .get('/api/notifications/jobs/job-inspect-1')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.jobId).toBe('job-inspect-1');
    expect(res.body.data.recipientId).toBe('member-1');
    expect(res.body.data.status).toBe('pending');
  });

  it('returns 404 for non-existent notification job ID', async () => {
    const res = await request(app)
      .get('/api/notifications/jobs/non-existent-job')
      .expect(404);

    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/not found/i);
  });

  it('rejects invalid query parameter for status with 400', async () => {
    const res = await request(app)
      .get('/api/notifications/jobs?status=invalid_status')
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
  });
});
