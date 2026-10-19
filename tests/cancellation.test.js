import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import Workshop from '../src/models/Workshop.js';
import Registration from '../src/models/Registration.js';
import NotificationJob from '../src/models/NotificationJob.js';
import { setupTestDB, teardownTestDB, clearDatabase } from './setup.js';
import NotificationWorker from '../src/workers/notificationWorker.js';
import mockStore from '../src/notification-mock/mockStore.js';
import { createMockApp } from '../src/notification-mock/mockServer.js';
import { cancelWorkshop } from '../src/services/workshopService.js';
import { registerMember } from '../src/services/registrationService.js';

describe('3. Workshop Cancellation & Member Notifications', () => {
  let app;
  let mockServer;
  let mockPort = 5510;
  let mockUrl;

  beforeAll(async () => {
    await setupTestDB();
    app = createApp();

    const mockApp = createMockApp();
    mockServer = mockApp.listen(mockPort);
    mockUrl = `http://127.0.0.1:${mockPort}/notifications`;
  });

  afterAll(async () => {
    if (mockServer) {
      await new Promise((resolve) => mockServer.close(resolve));
    }
    await teardownTestDB();
  });

  beforeEach(async () => {
    await clearDatabase();
    mockStore.clear();
  });

  it('14. Workshop cancellation creates one job per registered member', async () => {
    const workshop = await Workshop.create({
      workshopId: 'ws-cancel-14',
      title: 'Cloud Native Distributed Systems',
      description: 'Hands-on microservices',
      organizerId: 'org-14',
      status: 'active',
    });

    // Register 3 members
    await Registration.create([
      { registrationId: 'reg-1', workshopId: workshop.workshopId, memberId: 'member-1', destination: 'm1@example.com' },
      { registrationId: 'reg-2', workshopId: workshop.workshopId, memberId: 'member-2', destination: 'm2@example.com' },
      { registrationId: 'reg-3', workshopId: workshop.workshopId, memberId: 'member-3', destination: 'm3@example.com' },
    ]);

    const res = await request(app)
      .post(`/api/workshops/${workshop.workshopId}/cancel`)
      .send({ reason: 'Speaker unavailable' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('cancelled');
    expect(res.body.meta.jobsCreated).toBe(3);

    const jobs = await NotificationJob.find({
      workshopId: workshop.workshopId,
      eventType: 'workshop_cancellation',
    });

    expect(jobs.length).toBe(3);
    const recipients = jobs.map((j) => j.recipientId).sort();
    expect(recipients).toEqual(['member-1', 'member-2', 'member-3']);
  });

  it('15. One recipient failing does not block other recipients', async () => {
    const workshop = await Workshop.create({
      workshopId: 'ws-cancel-15',
      title: 'High Availability Systems',
      description: 'Fault tolerance patterns',
      organizerId: 'org-15',
      status: 'active',
    });

    await Registration.create([
      { registrationId: 'reg-a', workshopId: workshop.workshopId, memberId: 'recipient-fail', destination: 'fail@example.com' },
      { registrationId: 'reg-b', workshopId: workshop.workshopId, memberId: 'recipient-ok-1', destination: 'ok1@example.com' },
      { registrationId: 'reg-c', workshopId: workshop.workshopId, memberId: 'recipient-ok-2', destination: 'ok2@example.com' },
    ]);

    // Configure mock to fail specifically for recipient-fail
    mockStore.updateConfig({ failRecipientId: 'recipient-fail' });

    // Cancel workshop
    await cancelWorkshop(workshop.workshopId);

    // Run worker to process all jobs
    const worker = new NotificationWorker({
      mockUrl,
      pollIntervalMs: 50,
      batchSize: 10,
      initialBackoffMs: 500,
    });

    // Run a poll cycle
    await worker.pollAndProcess();
    // Allow any in-flight async job dispatch to settle
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Verify recipient-ok-1 and recipient-ok-2 were delivered successfully
    const okJob1 = await NotificationJob.findOne({ recipientId: 'recipient-ok-1' });
    const okJob2 = await NotificationJob.findOne({ recipientId: 'recipient-ok-2' });
    const failJob = await NotificationJob.findOne({ recipientId: 'recipient-fail' });

    expect(okJob1.status).toBe('delivered');
    expect(okJob2.status).toBe('delivered');

    // recipient-fail was retried and scheduled for backoff, not blocking others
    expect(failJob.status).toBe('pending');
    expect(failJob.attemptCount).toBe(1);
    expect(failJob.lastError).toBeDefined();
  });

  it('16. Repeated cancellation creates no duplicate jobs', async () => {
    const workshop = await Workshop.create({
      workshopId: 'ws-cancel-16',
      title: 'Resilient Design',
      description: 'Idempotency patterns',
      organizerId: 'org-16',
      status: 'active',
    });

    await Registration.create([
      { registrationId: 'reg-16a', workshopId: workshop.workshopId, memberId: 'member-16a', destination: '16a@example.com' },
      { registrationId: 'reg-16b', workshopId: workshop.workshopId, memberId: 'member-16b', destination: '16b@example.com' },
    ]);

    // First cancellation
    const firstRes = await request(app)
      .post(`/api/workshops/${workshop.workshopId}/cancel`)
      .expect(200);

    expect(firstRes.body.meta.alreadyCancelled).toBe(false);
    expect(firstRes.body.meta.jobsCreated).toBe(2);

    // Second cancellation
    const secondRes = await request(app)
      .post(`/api/workshops/${workshop.workshopId}/cancel`)
      .expect(200);

    expect(secondRes.body.meta.alreadyCancelled).toBe(true);
    expect(secondRes.body.meta.jobsCreated).toBe(0);

    // Total jobs in DB must remain exactly 2
    const totalJobs = await NotificationJob.countDocuments({ workshopId: workshop.workshopId });
    expect(totalJobs).toBe(2);
  });

  it('20. Registration and cancellation concurrency race handling', async () => {
    const workshop = await Workshop.create({
      workshopId: 'ws-race-20',
      title: 'Concurrent Systems Workshop',
      description: 'Stress testing race conditions',
      organizerId: 'org-20',
      status: 'active',
    });

    // Run cancelWorkshop and 5 concurrent registerMember calls in parallel
    const operations = [
      cancelWorkshop(workshop.workshopId),
      registerMember(workshop.workshopId, { memberId: 'race-member-1', destination: 'r1@example.com' }).catch((e) => e),
      registerMember(workshop.workshopId, { memberId: 'race-member-2', destination: 'r2@example.com' }).catch((e) => e),
      registerMember(workshop.workshopId, { memberId: 'race-member-3', destination: 'r3@example.com' }).catch((e) => e),
      registerMember(workshop.workshopId, { memberId: 'race-member-4', destination: 'r4@example.com' }).catch((e) => e),
      registerMember(workshop.workshopId, { memberId: 'race-member-5', destination: 'r5@example.com' }).catch((e) => e),
    ];

    await Promise.all(operations);

    // Final workshop status must be cancelled
    const finalWorkshop = await Workshop.findOne({ workshopId: workshop.workshopId });
    expect(finalWorkshop.status).toBe('cancelled');

    // Any registration that succeeded must have been registered BEFORE cancellation won
    // And any registration that succeeded must have a corresponding cancellation job!
    const registrations = await Registration.find({ workshopId: workshop.workshopId });
    const cancellationJobs = await NotificationJob.find({
      workshopId: workshop.workshopId,
      eventType: 'workshop_cancellation',
    });

    // Every committed registration must have a cancellation notification scheduled!
    expect(cancellationJobs.length).toBeGreaterThanOrEqual(registrations.length);

    // Attempting another registration now that it is definitely cancelled MUST fail
    await expect(
      registerMember(workshop.workshopId, { memberId: 'post-cancel-member', destination: 'post@example.com' })
    ).rejects.toThrow(/cancelled/i);
  });
});
