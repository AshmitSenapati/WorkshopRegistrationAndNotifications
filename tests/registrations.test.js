import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import Workshop from '../src/models/Workshop.js';
import Registration from '../src/models/Registration.js';
import NotificationJob from '../src/models/NotificationJob.js';
import { setupTestDB, teardownTestDB, clearDatabase } from './setup.js';
import { registerMember } from '../src/services/registrationService.js';

describe('2. Registrations & Transactional Outbox', () => {
  let app;
  let activeWorkshop;
  let cancelledWorkshop;

  beforeAll(async () => {
    await setupTestDB();
    app = createApp();
  });

  afterAll(async () => {
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearDatabase();

    activeWorkshop = await Workshop.create({
      workshopId: 'ws-active-1',
      title: 'Advanced System Architecture',
      description: 'Distributed systems & transactional patterns',
      organizerId: 'org-1',
      status: 'active',
    });

    cancelledWorkshop = await Workshop.create({
      workshopId: 'ws-cancelled-1',
      title: 'Cancelled Architecture Seminar',
      description: 'Will not happen',
      organizerId: 'org-2',
      status: 'cancelled',
    });
  });

  it('2. Successful registration creates registration and outbox job', async () => {
    const res = await request(app)
      .post(`/api/workshops/${activeWorkshop.workshopId}/registrations`)
      .send({ memberId: 'member-101', destination: 'member101@example.com' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.registrationId).toBeDefined();
    expect(res.body.data.workshopId).toBe(activeWorkshop.workshopId);
    expect(res.body.data.memberId).toBe('member-101');

    // Verify registration document in DB
    const savedReg = await Registration.findOne({ registrationId: res.body.data.registrationId });
    expect(savedReg).not.toBeNull();
    expect(savedReg.memberId).toBe('member-101');
  });

  it('3. Duplicate registration rejection returns 409 conflict', async () => {
    // First registration succeeds
    await request(app)
      .post(`/api/workshops/${activeWorkshop.workshopId}/registrations`)
      .send({ memberId: 'member-102', destination: 'member102@example.com' })
      .expect(201);

    // Second registration with identical member & workshop
    const res = await request(app)
      .post(`/api/workshops/${activeWorkshop.workshopId}/registrations`)
      .send({ memberId: 'member-102', destination: 'member102@example.com' })
      .expect(409);

    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/already registered/i);

    // Verify still only 1 registration and 1 job in DB
    const count = await Registration.countDocuments({
      workshopId: activeWorkshop.workshopId,
      memberId: 'member-102',
    });
    expect(count).toBe(1);

    const jobCount = await NotificationJob.countDocuments({
      workshopId: activeWorkshop.workshopId,
      recipientId: 'member-102',
    });
    expect(jobCount).toBe(1);
  });

  it('4. Concurrent duplicate registration attempts allow only one winner', async () => {
    const memberId = 'concurrent-member-4';
    const payload = { memberId, destination: 'concurrent@example.com' };

    // Fire 10 parallel registration requests simultaneously
    const requests = Array.from({ length: 10 }, () =>
      request(app)
        .post(`/api/workshops/${activeWorkshop.workshopId}/registrations`)
        .send(payload)
    );

    const responses = await Promise.all(requests);

    const successes = responses.filter((r) => r.status === 201);
    const conflicts = responses.filter((r) => r.status === 409);

    expect(successes.length).toBe(1);
    expect(conflicts.length).toBe(9);

    // Ensure database-level constraint produced exactly one registration and one job
    const regCount = await Registration.countDocuments({
      workshopId: activeWorkshop.workshopId,
      memberId,
    });
    expect(regCount).toBe(1);

    const jobCount = await NotificationJob.countDocuments({
      workshopId: activeWorkshop.workshopId,
      recipientId: memberId,
    });
    expect(jobCount).toBe(1);
  });

  it('5. Rejection of registration for a cancelled workshop', async () => {
    const res = await request(app)
      .post(`/api/workshops/${cancelledWorkshop.workshopId}/registrations`)
      .send({ memberId: 'member-cancelled', destination: 'cancelled@example.com' })
      .expect(400);

    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/cancelled/i);

    // Ensure no registration or job was created
    const reg = await Registration.findOne({ memberId: 'member-cancelled' });
    expect(reg).toBeNull();

    const job = await NotificationJob.findOne({ recipientId: 'member-cancelled' });
    expect(job).toBeNull();
  });

  it('6. Confirmation delivery occurs asynchronously without blocking the response', async () => {
    const start = Date.now();
    const res = await request(app)
      .post(`/api/workshops/${activeWorkshop.workshopId}/registrations`)
      .send({ memberId: 'async-member', destination: 'async@example.com' })
      .expect(201);

    const duration = Date.now() - start;
    // API returns immediately (well within 200ms)
    expect(duration).toBeLessThan(500);

    // Job in DB is persisted in 'pending' status for the worker to pick up
    const job = await NotificationJob.findOne({ recipientId: 'async-member' });
    expect(job).not.toBeNull();
    expect(job.status).toBe('pending');
    expect(job.attemptCount).toBe(0);
    expect(job.eventType).toBe('registration_confirmation');
  });

  it('7. A failed registration creates no confirmation job', async () => {
    // Attempt with invalid destination
    await request(app)
      .post(`/api/workshops/${activeWorkshop.workshopId}/registrations`)
      .send({ memberId: '', destination: '' })
      .expect(400);

    // Attempt with non-existent workshop
    await request(app)
      .post('/api/workshops/non-existent-workshop/registrations')
      .send({ memberId: 'orphan-member', destination: 'orphan@example.com' })
      .expect(404);

    const orphanJob = await NotificationJob.findOne({ recipientId: 'orphan-member' });
    expect(orphanJob).toBeNull();
  });

  it('8. A successful registration creates exactly one confirmation job', async () => {
    await request(app)
      .post(`/api/workshops/${activeWorkshop.workshopId}/registrations`)
      .send({ memberId: 'exact-one-member', destination: 'exact@example.com' })
      .expect(201);

    const jobs = await NotificationJob.find({ recipientId: 'exact-one-member' });
    expect(jobs.length).toBe(1);
    expect(jobs[0].idempotencyKey).toBe(`reg_conf:${jobs[0].registrationId}`);
  });

  it('22. Transaction rollback when job creation fails', async () => {
    // Spy on NotificationJob.prototype.save and force an error
    const saveSpy = vi.spyOn(NotificationJob.prototype, 'save').mockRejectedValueOnce(
      new Error('Simulated disk/database failure while persisting outbox job')
    );

    await expect(
      registerMember(activeWorkshop.workshopId, {
        memberId: 'rollback-member',
        destination: 'rollback@example.com',
      })
    ).rejects.toThrow(/Simulated disk\/database failure/);

    // Verify registration was rolled back and does not exist
    const reg = await Registration.findOne({ memberId: 'rollback-member' });
    expect(reg).toBeNull();

    // Verify job does not exist
    const job = await NotificationJob.findOne({ recipientId: 'rollback-member' });
    expect(job).toBeNull();

    saveSpy.mockRestore();
  });
});
