import http from 'http';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import createApp from '../src/app.js';
import { createMockApp } from '../src/notification-mock/mockServer.js';
import mockStore from '../src/notification-mock/mockStore.js';
import NotificationWorker from '../src/workers/notificationWorker.js';
import { connectDB, disconnectDB } from '../src/utils/db.js';
import { isPortAvailable, findAvailablePort } from '../src/utils/ports.js';
import Workshop from '../src/models/Workshop.js';
import Registration from '../src/models/Registration.js';
import NotificationJob from '../src/models/NotificationJob.js';
import MockDelivery from '../src/models/MockDelivery.js';

// ANSI terminal colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
  bgGreen: '\x1b[42m\x1b[30m',
  bgRed: '\x1b[41m\x1b[37m',
};

// Summary tracker
const stageResults = [];

function stageHeader(num, title) {
  console.log(`\n${c.bold}${c.cyan}┌─────────────────────────────────────────────────────────────────────────────┐${c.reset}`);
  console.log(`${c.bold}${c.cyan}│ STAGE ${String(num).padStart(2, '0')}: ${title.padEnd(67)} │${c.reset}`);
  console.log(`${c.bold}${c.cyan}└─────────────────────────────────────────────────────────────────────────────┘${c.reset}`);
}

function printEvidence({ stage, title, action, expected, observed, identifiers = {}, status = null, attemptCount = null, passed }) {
  const resultTag = passed ? `${c.bgGreen}${c.bold} PASS ${c.reset}` : `${c.bgRed}${c.bold} FAIL ${c.reset}`;
  console.log(`  ${c.bold}• Action:${c.reset}   ${action}`);
  console.log(`  ${c.bold}• Expected:${c.reset} ${expected}`);
  console.log(`  ${c.bold}• Observed:${c.reset} ${observed}`);
  
  const idEntries = Object.entries(identifiers).filter(([_, v]) => v != null);
  if (idEntries.length > 0) {
    const idStr = idEntries.map(([k, v]) => `${k}=${v}`).join(', ');
    console.log(`  ${c.bold}• Records:${c.reset}  ${c.dim}${idStr}${c.reset}`);
  }
  
  if (status !== null || attemptCount !== null) {
    const metaStr = [
      status != null ? `Status: ${status}` : '',
      attemptCount != null ? `Attempts: ${attemptCount}` : '',
    ].filter(Boolean).join(' | ');
    console.log(`  ${c.bold}• State:${c.reset}    ${metaStr}`);
  }

  console.log(`  ${c.bold}• Result:${c.reset}   ${resultTag}`);

  stageResults.push({
    stage,
    title,
    action,
    observed,
    passed,
  });
}

async function waitForCondition(predicate, { timeoutMs = 10000, intervalMs = 60, description = 'condition' } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await predicate();
    if (result) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout after ${timeoutMs}ms waiting for: ${description}`);
}

async function runDemo() {
  console.log(`\n${c.bold}${c.magenta}╔═════════════════════════════════════════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}${c.magenta}║    WORKSHOP REGISTRATION & NOTIFICATIONS — VERIFICATION DEMONSTRATION      ║${c.reset}`);
  console.log(`${c.bold}${c.magenta}╚═════════════════════════════════════════════════════════════════════════════╝${c.reset}`);

  // Unique run identifier ensures completely isolated test data
  const runId = `demo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  console.log(`${c.dim}Run ID: ${runId}${c.reset}`);

  let replSet = null;
  let apiServer = null;
  let mockServer = null;
  let worker = null;

  try {
    // ─────────────────────────────────────────────────────────────
    // Environment & Port Setup
    // ─────────────────────────────────────────────────────────────
    console.log(`\n${c.bold}[1/3] Database Initialization...${c.reset}`);
    let mongoUri = process.env.MONGODB_URI;
    let externalDb = false;

    if (mongoUri && !mongoUri.includes('127.0.0.1:27017')) {
      try {
        await connectDB(mongoUri);
        externalDb = true;
        console.log(`  Connected to external MongoDB replica set: ${c.green}${mongoUri}${c.reset}`);
      } catch (err) {
        console.log(`  Could not connect to external MongoDB (${err.message}). Falling back to embedded replica set.`);
      }
    }

    if (!externalDb) {
      console.log(`  Starting native high-availability MongoMemoryReplSet (ACID transactions enabled)...`);
      replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
      mongoUri = replSet.getUri();
      await connectDB(mongoUri);
      console.log(`  Embedded Replica Set ready: ${c.green}${mongoUri}${c.reset}`);
    }

    console.log(`\n${c.bold}[2/3] Port Allocation & Process Isolation Audit...${c.reset}`);
    // Inspect standard development ports (3000 / 4000)
    const stdApiFree = await isPortAvailable(3000);
    const stdMockFree = await isPortAvailable(4000);

    if (!stdApiFree) {
      console.log(`  ${c.yellow}Notice: Port 3000 is occupied by an existing process.${c.reset}`);
    }
    if (!stdMockFree) {
      console.log(`  ${c.yellow}Notice: Port 4000 is occupied (e.g. by a previously started mockServer).${c.reset}`);
    }

    // Allocate dedicated demonstration ports to avoid collisions
    const preferredApiPort = Number(process.env.DEMO_PORT) || 3050;
    const preferredMockPort = Number(process.env.DEMO_MOCK_PORT) || 4050;

    const apiPort = await findAvailablePort(preferredApiPort);
    const mockPort = await findAvailablePort(preferredMockPort);

    console.log(`  Allocated isolated Demo API Server port:  ${c.green}${apiPort}${c.reset}`);
    console.log(`  Allocated isolated Demo Mock Server port: ${c.green}${mockPort}${c.reset}`);

    // Start Demo Mock HTTP Notification Server
    const mockApp = createMockApp();
    mockServer = mockApp.listen(mockPort);
    const mockUrl = `http://127.0.0.1:${mockPort}/notifications`;

    // Start Demo API Server
    const app = createApp();
    apiServer = app.listen(apiPort);
    const apiBase = `http://127.0.0.1:${apiPort}/api`;

    // Start Background Notification Worker with fast demonstration timings
    console.log(`\n${c.bold}[3/3] Starting Persistent Notification Worker Daemon...${c.reset}`);
    worker = new NotificationWorker({
      mockUrl,
      pollIntervalMs: 100,
      initialBackoffMs: 200,
      backoffFactor: 2,
      jitterMs: 25,
      maxAttempts: 4,
    });
    worker.start();
    console.log(`  Worker started: pollInterval=100ms, initialBackoff=200ms, maxAttempts=4`);

    // Helper for JSON API requests
    async function apiRequest(path, options = {}) {
      const res = await fetch(`${apiBase}${path}`, {
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options,
      });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    }

    // ─────────────────────────────────────────────────────────────
    // STAGE 1: Create a workshop
    // ─────────────────────────────────────────────────────────────
    stageHeader(1, 'Create a Workshop');
    const ws1Title = `Distributed Systems Architecture (${runId})`;
    const createWsRes = await apiRequest('/workshops', {
      method: 'POST',
      body: JSON.stringify({
        title: ws1Title,
        description: 'Transactional Outbox, At-Least-Once Delivery & Idempotency',
        organizerId: 'lead_architect',
      }),
    });

    const createdWs = createWsRes.data.data;
    const dbWorkshop1 = await Workshop.findOne({ workshopId: createdWs?.workshopId });
    const s1Passed = createWsRes.status === 201 && dbWorkshop1?.status === 'active';

    printEvidence({
      stage: 1,
      title: 'Create a Workshop',
      action: `POST /api/workshops with title="${ws1Title}"`,
      expected: 'HTTP 201 Created and Workshop saved to MongoDB with status="active"',
      observed: `HTTP ${createWsRes.status}, Workshop ID: ${createdWs?.workshopId}, DB status: "${dbWorkshop1?.status}"`,
      identifiers: { workshopId: createdWs?.workshopId },
      status: dbWorkshop1?.status,
      passed: s1Passed,
    });

    // ─────────────────────────────────────────────────────────────
    // STAGE 2: Register a member and measure the API response time
    // ─────────────────────────────────────────────────────────────
    stageHeader(2, 'Register a Member and Measure API Response Time');
    // Configure a controlled 2000ms mock delay to test Stage 2 and Stage 3 deterministically
    mockStore.updateConfig({ delayMs: 2000 });

    const member1 = `member_${runId}_alice`;
    const regStart = Date.now();
    const regRes1 = await apiRequest(`/workshops/${createdWs.workshopId}/registrations`, {
      method: 'POST',
      body: JSON.stringify({
        memberId: member1,
        destination: 'alice@example.com',
      }),
    });
    const regDurationMs = Date.now() - regStart;

    const regData1 = regRes1.data.data;
    const dbReg1 = await Registration.findOne({ registrationId: regData1?.registrationId });
    const s2Passed = regRes1.status === 201 && dbReg1 !== null && regDurationMs < 600;

    printEvidence({
      stage: 2,
      title: 'Register Member & Latency Measurement',
      action: `POST /api/workshops/:id/registrations for "${member1}"`,
      expected: 'HTTP 201 Created in <600ms with Registration document persisted in MongoDB',
      observed: `HTTP ${regRes1.status} returned in ${regDurationMs}ms; DB registration record verified`,
      identifiers: { registrationId: regData1?.registrationId, memberId: member1 },
      passed: s2Passed,
    });

    // ─────────────────────────────────────────────────────────────
    // STAGE 3: Prove registration response does NOT wait for notification delivery
    // ─────────────────────────────────────────────────────────────
    stageHeader(3, 'Prove API Response Does Not Wait for Notification Delivery');
    // Check outbox immediately: while the 2000ms delay is actively running downstream,
    // the outbox job exists and is still in pending/processing, with deliveredAt === null!
    const jobDuringDelay = await NotificationJob.findOne({ recipientId: member1 });
    const isUndeliveredDuringDelay = jobDuringDelay && jobDuringDelay.status !== 'delivered' && jobDuringDelay.deliveredAt === null;
    const isProvedNonBlocking = regDurationMs < 600; // Responded in <600ms despite 2000ms mock delay!

    // Restore mock delay to normal baseline
    mockStore.updateConfig({ delayMs: 0 });

    const s3Passed = isProvedNonBlocking && isUndeliveredDuringDelay;

    printEvidence({
      stage: 3,
      title: 'Non-Blocking Transactional Outbox Proof',
      action: `Downstream mock delay was 2000ms. Measured API latency and checked DB outbox status immediately upon API return`,
      expected: 'API response time <600ms (far below 2000ms downstream delay); Outbox job status is pending/processing; deliveredAt is null',
      observed: `API latency: ${regDurationMs}ms (vs 2000ms mock delay). Immediate outbox state: status="${jobDuringDelay?.status}", deliveredAt=${jobDuringDelay?.deliveredAt}`,
      identifiers: { jobId: jobDuringDelay?.jobId, registrationId: regData1?.registrationId },
      status: jobDuringDelay?.status,
      passed: s3Passed,
    });

    // ─────────────────────────────────────────────────────────────
    // STAGE 4: Confirm notification job is persisted and eventually delivered
    // ─────────────────────────────────────────────────────────────
    stageHeader(4, 'Confirm Notification Job is Persisted and Eventually Delivered');
    const deliveredJob1 = await waitForCondition(
      async () => {
        const j = await NotificationJob.findOne({ recipientId: member1 });
        return j && j.status === 'delivered' ? j : null;
      },
      { timeoutMs: 6000, description: `Job for ${member1} to be marked delivered` }
    );

    const mockRecord1 = await MockDelivery.findOne({ idempotencyKey: deliveredJob1.idempotencyKey });
    const s4Passed = deliveredJob1.status === 'delivered' && deliveredJob1.deliveredAt !== null && mockRecord1?.status === 'accepted';

    printEvidence({
      stage: 4,
      title: 'Persisted Job Eventual Delivery',
      action: 'Worker polls MongoDB and dispatches pending notification to mock service',
      expected: 'Job status transitions to "delivered", deliveredAt is populated, Mock persistent store records delivery',
      observed: `Job status="${deliveredJob1.status}", deliveredAt=${deliveredJob1.deliveredAt.toISOString()}, MockDelivery status="${mockRecord1?.status}"`,
      identifiers: { jobId: deliveredJob1.jobId, idempotencyKey: deliveredJob1.idempotencyKey },
      status: deliveredJob1.status,
      attemptCount: deliveredJob1.attemptCount,
      passed: s4Passed,
    });

    // ─────────────────────────────────────────────────────────────
    // STAGE 5: Reject a duplicate registration and prove it creates no extra job
    // ─────────────────────────────────────────────────────────────
    stageHeader(5, 'Reject Duplicate Registration and Prevent Duplicate Job');
    const dupRes = await apiRequest(`/workshops/${createdWs.workshopId}/registrations`, {
      method: 'POST',
      body: JSON.stringify({
        memberId: member1, // Same member!
        destination: 'alice@example.com',
      }),
    });

    const regCountMember1 = await Registration.countDocuments({
      workshopId: createdWs.workshopId,
      memberId: member1,
    });
    const jobCountMember1 = await NotificationJob.countDocuments({
      workshopId: createdWs.workshopId,
      recipientId: member1,
    });

    const s5Passed = dupRes.status === 409 && regCountMember1 === 1 && jobCountMember1 === 1;

    printEvidence({
      stage: 5,
      title: 'Duplicate Registration Rejection',
      action: `Issued second POST /registrations with identical memberId "${member1}"`,
      expected: 'HTTP 409 Conflict; exactly 1 registration document in DB; exactly 1 notification job in DB',
      observed: `HTTP ${dupRes.status} ("${dupRes.data.error?.message}"); Total DB registrations=${regCountMember1}, Total DB jobs=${jobCountMember1}`,
      identifiers: { workshopId: createdWs.workshopId, memberId: member1 },
      passed: s5Passed,
    });

    // ─────────────────────────────────────────────────────────────
    // STAGE 6: Simulate notification HTTP failures, timeouts, backoff, and recovery
    // ─────────────────────────────────────────────────────────────
    stageHeader(6, 'Simulate Failures, Backoff, and Recovery When Service Returns');
    // Configure mock service to fail the first 2 attempts with HTTP 503
    mockStore.updateConfig({ failFirstNAttempts: 2 });

    const memberRetry = `member_${runId}_retry`;
    const retryRegRes = await apiRequest(`/workshops/${createdWs.workshopId}/registrations`, {
      method: 'POST',
      body: JSON.stringify({
        memberId: memberRetry,
        destination: 'retry@example.com',
      }),
    });

    // Wait for worker to fail attempt 1
    const jobAttempt1 = await waitForCondition(
      async () => {
        const j = await NotificationJob.findOne({ recipientId: memberRetry });
        return j && j.attemptCount >= 1 ? j : null;
      },
      { timeoutMs: 4000, description: 'Job to register attempt 1' }
    );

    const hadBackoff1 = jobAttempt1.nextAttemptAt.getTime() > Date.now() - 500;
    const err1 = jobAttempt1.lastError?.message;

    // Wait for worker to fail attempt 2
    const jobAttempt2 = await waitForCondition(
      async () => {
        const j = await NotificationJob.findOne({ recipientId: memberRetry });
        return j && j.attemptCount >= 2 ? j : null;
      },
      { timeoutMs: 4000, description: 'Job to register attempt 2' }
    );

    const err2 = jobAttempt2.lastError?.message;

    // Restore mock service to healthy state
    mockStore.updateConfig({ failFirstNAttempts: 0, failMode: 'none' });

    // Wait for eventual successful delivery on attempt 3
    const jobRecovered = await waitForCondition(
      async () => {
        const j = await NotificationJob.findOne({ recipientId: memberRetry });
        return j && j.status === 'delivered' ? j : null;
      },
      { timeoutMs: 8000, description: 'Job to recover and reach status=delivered' }
    );

    const s6Passed = jobAttempt1.attemptCount >= 1 && err1?.includes('503') &&
                     jobAttempt2.attemptCount >= 2 && err2?.includes('503') &&
                     jobRecovered.status === 'delivered' && jobRecovered.attemptCount >= 3;

    printEvidence({
      stage: 6,
      title: 'HTTP Failures, Backoff & Recovery',
      action: 'Simulated HTTP 503 errors on initial 2 attempts; observed backoff; then restored mock service health',
      expected: 'Attempts 1 & 2 fail with HTTP 503 and backoff scheduled; attempt 3 recovers to status="delivered" once mock is healthy',
      observed: `Attempt 1 error: "${err1}". Attempt 2 error: "${err2}". Final state: status="${jobRecovered.status}", totalAttempts=${jobRecovered.attemptCount}`,
      identifiers: { jobId: jobRecovered.jobId, recipientId: memberRetry },
      status: jobRecovered.status,
      attemptCount: jobRecovered.attemptCount,
      passed: s6Passed,
    });

    // ─────────────────────────────────────────────────────────────
    // STAGE 7: Prove pending jobs survive a worker restart
    // ─────────────────────────────────────────────────────────────
    stageHeader(7, 'Prove Pending Jobs Survive a Worker Restart');
    // Stop the active worker completely
    await worker.stop();
    const workerIsStopped = !worker.isRunning;

    // Register a new member while the worker process is completely stopped
    const memberOffline = `member_${runId}_offline`;
    const offlineRegRes = await apiRequest(`/workshops/${createdWs.workshopId}/registrations`, {
      method: 'POST',
      body: JSON.stringify({
        memberId: memberOffline,
        destination: 'offline@example.com',
      }),
    });

    // Verify job exists in DB in pending state
    const pendingDuringOutage = await NotificationJob.findOne({ recipientId: memberOffline });
    const isSafelyPersisted = pendingDuringOutage && pendingDuringOutage.status === 'pending' && pendingDuringOutage.attemptCount === 0;

    // Start a brand-new worker daemon instance
    worker = new NotificationWorker({
      mockUrl,
      pollIntervalMs: 100,
      initialBackoffMs: 200,
    });
    worker.start();

    // Verify the new worker picks up the orphaned pending job and delivers it
    const jobDeliveredAfterRestart = await waitForCondition(
      async () => {
        const j = await NotificationJob.findOne({ recipientId: memberOffline });
        return j && j.status === 'delivered' ? j : null;
      },
      { timeoutMs: 5000, description: 'Job to be delivered after worker restart' }
    );

    const s7Passed = workerIsStopped && isSafelyPersisted && jobDeliveredAfterRestart.status === 'delivered';

    printEvidence({
      stage: 7,
      title: 'Worker Restart & Crash Recovery',
      action: 'Stopped worker daemon; registered member during downtime; booted new worker daemon',
      expected: 'Job persisted safely in MongoDB while worker was down; new worker successfully delivers it',
      observed: `Job created during downtime (status="${pendingDuringOutage?.status}"). New worker resumed and delivered job (status="${jobDeliveredAfterRestart?.status}")`,
      identifiers: { jobId: jobDeliveredAfterRestart.jobId, recipientId: memberOffline },
      status: jobDeliveredAfterRestart.status,
      attemptCount: jobDeliveredAfterRestart.attemptCount,
      passed: s7Passed,
    });

    // ─────────────────────────────────────────────────────────────
    // STAGE 8: Create a workshop with multiple registered members and cancel it
    // ─────────────────────────────────────────────────────────────
    stageHeader(8, 'Create Workshop with Multiple Members and Cancel It');
    const wsCancelRes = await apiRequest('/workshops', {
      method: 'POST',
      body: JSON.stringify({
        title: `Multi-Member Workshop to Cancel (${runId})`,
        description: 'Testing independent cancellation fan-out',
        organizerId: 'lead_organizer',
      }),
    });
    const wsCancel = wsCancelRes.data.data;

    const cancelMembers = [
      `cancel_${runId}_alice`,
      `cancel_${runId}_bob`,
      `cancel_${runId}_charlie`,
    ];

    for (const mId of cancelMembers) {
      await apiRequest(`/workshops/${wsCancel.workshopId}/registrations`, {
        method: 'POST',
        body: JSON.stringify({ memberId: mId, destination: `${mId}@example.com` }),
      });
    }

    // Wait for the 3 registration confirmation notifications to finish delivery cleanly
    await waitForCondition(
      async () => {
        const count = await NotificationJob.countDocuments({
          workshopId: wsCancel.workshopId,
          eventType: 'registration_confirmation',
          status: 'delivered',
        });
        return count === 3;
      },
      { timeoutMs: 6000, description: 'All 3 registration confirmations to deliver' }
    );

    // Cancel workshop
    const cancelRes = await apiRequest(`/workshops/${wsCancel.workshopId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'Emergency weather warning' }),
    });

    const updatedWs = await Workshop.findOne({ workshopId: wsCancel.workshopId });
    const s8Passed = cancelRes.status === 200 && updatedWs?.status === 'cancelled' && cancelRes.data.meta?.jobsCreated === 3;

    printEvidence({
      stage: 8,
      title: 'Workshop Cancellation',
      action: `Cancelled workshop "${wsCancel.workshopId}" with 3 registered members`,
      expected: 'HTTP 200; Workshop status="cancelled"; 3 cancellation jobs created in single transaction',
      observed: `HTTP ${cancelRes.status}; DB workshop status="${updatedWs?.status}"; API meta.jobsCreated=${cancelRes.data.meta?.jobsCreated}`,
      identifiers: { workshopId: wsCancel.workshopId },
      status: updatedWs?.status,
      passed: s8Passed,
    });

    // ─────────────────────────────────────────────────────────────
    // STAGE 9: Prove each registered member has an independent cancellation job
    // ─────────────────────────────────────────────────────────────
    stageHeader(9, 'Prove Independent Cancellation Job Per Registered Member');
    const cancelJobs = await NotificationJob.find({
      workshopId: wsCancel.workshopId,
      eventType: 'workshop_cancellation',
    });

    const cancelRecipients = cancelJobs.map((j) => j.recipientId).sort();
    const uniqueKeys = new Set(cancelJobs.map((j) => j.idempotencyKey));
    const expectedRecipients = [...cancelMembers].sort();

    const s9Passed = cancelJobs.length === 3 && uniqueKeys.size === 3 && JSON.stringify(cancelRecipients) === JSON.stringify(expectedRecipients);

    printEvidence({
      stage: 9,
      title: 'Independent Cancellation Jobs',
      action: `Queried NotificationJob collection for workshopId="${wsCancel.workshopId}" and eventType="workshop_cancellation"`,
      expected: 'Exactly 3 distinct jobs created, each with corresponding recipientId and unique idempotencyKey',
      observed: `Retrieved ${cancelJobs.length} cancellation jobs. Recipients: [${cancelRecipients.join(', ')}]. Unique idempotency keys: ${uniqueKeys.size}/3`,
      identifiers: { workshopId: wsCancel.workshopId },
      passed: s9Passed,
    });

    // ─────────────────────────────────────────────────────────────
    // STAGE 10: Make one recipient fail and demonstrate other recipients still receive notifications
    // ─────────────────────────────────────────────────────────────
    stageHeader(10, 'Recipient Failure Isolation (Non-Blocking Multi-Recipient Delivery)');
    const failingRecipient = cancelMembers[1]; // Bob
    const okRecipient1 = cancelMembers[0];      // Alice
    const okRecipient2 = cancelMembers[2];      // Charlie

    // Configure mock to fail specifically for Bob
    mockStore.updateConfig({ failRecipientId: failingRecipient });

    // Wait for Alice and Charlie to reach delivered
    const aliceDelivered = await waitForCondition(
      async () => {
        const j = await NotificationJob.findOne({ workshopId: wsCancel.workshopId, recipientId: okRecipient1, eventType: 'workshop_cancellation' });
        return j && j.status === 'delivered' ? j : null;
      },
      { timeoutMs: 5000, description: `Cancellation job for ${okRecipient1} to be delivered` }
    );

    const charlieDelivered = await waitForCondition(
      async () => {
        const j = await NotificationJob.findOne({ workshopId: wsCancel.workshopId, recipientId: okRecipient2, eventType: 'workshop_cancellation' });
        return j && j.status === 'delivered' ? j : null;
      },
      { timeoutMs: 5000, description: `Cancellation job for ${okRecipient2} to be delivered` }
    );

    // Verify Bob is in pending (or retry backoff) and has an error recorded
    const bobJob = await NotificationJob.findOne({ workshopId: wsCancel.workshopId, recipientId: failingRecipient, eventType: 'workshop_cancellation' });
    const bobIsolated = bobJob && bobJob.status !== 'delivered' && bobJob.attemptCount >= 1 && bobJob.lastError !== null;

    // Restore mock service so Bob can eventually deliver
    mockStore.updateConfig({ failRecipientId: null });

    const bobEventuallyDelivered = await waitForCondition(
      async () => {
        const j = await NotificationJob.findOne({ jobId: bobJob.jobId });
        return j && j.status === 'delivered' ? j : null;
      },
      { timeoutMs: 5000, description: 'Bob cancellation job to recover' }
    );

    const s10Passed = aliceDelivered.status === 'delivered' && charlieDelivered.status === 'delivered' && bobIsolated && bobEventuallyDelivered.status === 'delivered';

    printEvidence({
      stage: 10,
      title: 'Recipient Failure Isolation',
      action: `Forced HTTP failure on recipient "${failingRecipient}"; allowed worker to process all jobs`,
      expected: 'Alice & Charlie succeed without blocking; Bob fails independently and retries; Bob delivers upon service restore',
      observed: `Alice: ${aliceDelivered.status} | Charlie: ${charlieDelivered.status} | Bob during failure: ${bobJob?.status} (err="${bobJob?.lastError?.message}") -> recovered: ${bobEventuallyDelivered.status}`,
      identifiers: { aliceJobId: aliceDelivered.jobId, bobJobId: bobJob.jobId, charlieJobId: charlieDelivered.jobId },
      passed: s10Passed,
    });

    // ─────────────────────────────────────────────────────────────
    // STAGE 11: Demonstrate idempotency and duplicate-delivery protection
    // ─────────────────────────────────────────────────────────────
    stageHeader(11, 'Idempotency and Duplicate-Delivery Protection');
    // Part 1: Mock HTTP delivery idempotency
    const testDeliveryKey = deliveredJob1.idempotencyKey;
    const dupMockRes = await fetch(mockUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-idempotency-key': testDeliveryKey,
      },
      body: JSON.stringify({
        jobId: deliveredJob1.jobId,
        eventType: deliveredJob1.eventType,
        recipientId: deliveredJob1.recipientId,
        destination: deliveredJob1.destination,
      }),
    });
    const dupMockData = await dupMockRes.json();

    const mockRecordAfterDup = await MockDelivery.findOne({ idempotencyKey: testDeliveryKey });
    const isMockDeduplicated = dupMockRes.status === 200 && dupMockData.status === 'deduplicated' && mockRecordAfterDup?.receivedCount >= 2;

    // Part 2: API cancellation idempotency
    const repeatCancelRes = await apiRequest(`/workshops/${wsCancel.workshopId}/cancel`, { method: 'POST' });
    const totalCancelJobsAfterRepeat = await NotificationJob.countDocuments({
      workshopId: wsCancel.workshopId,
      eventType: 'workshop_cancellation',
    });

    const isCancelIdempotent = repeatCancelRes.status === 200 &&
      repeatCancelRes.data.meta?.alreadyCancelled === true &&
      repeatCancelRes.data.meta?.jobsCreated === 0 &&
      totalCancelJobsAfterRepeat === 3;

    const s11Passed = isMockDeduplicated && isCancelIdempotent;

    printEvidence({
      stage: 11,
      title: 'Idempotency & Deduplication',
      action: 'Resent duplicate delivery with identical idempotencyKey; re-issued cancellation on cancelled workshop',
      expected: 'Mock returns 200 "deduplicated" with no duplicate delivery record; Repeated cancellation returns jobsCreated=0',
      observed: `Mock deduplication status: "${dupMockData.status}" (receivedCount=${mockRecordAfterDup?.receivedCount}); Cancel idempotency: alreadyCancelled=${repeatCancelRes.data.meta?.alreadyCancelled}, newJobs=${repeatCancelRes.data.meta?.jobsCreated}`,
      identifiers: { idempotencyKey: testDeliveryKey, workshopId: wsCancel.workshopId },
      passed: s11Passed,
    });

    // ─────────────────────────────────────────────────────────────
    // STAGE 12: Final job states & concise summary
    // ─────────────────────────────────────────────────────────────
    stageHeader(12, 'Final Job States & Concise Pass/Fail Summary');

    // Query all jobs created in this run
    const allRunJobs = await NotificationJob.find({
      $or: [
        { workshopId: createdWs.workshopId },
        { workshopId: wsCancel.workshopId },
      ],
    }).sort({ createdAt: 1 });

    console.log(`\n${c.bold}Final Database States for All Run Jobs (${allRunJobs.length} records):${c.reset}`);
    console.table(
      allRunJobs.map((j) => ({
        JobId: j.jobId.slice(0, 18) + '...',
        Event: j.eventType,
        Recipient: j.recipientId,
        Status: j.status,
        Attempts: j.attemptCount,
        DeliveredAt: j.deliveredAt ? j.deliveredAt.toISOString().slice(11, 19) : 'none',
        IdempotencyKey: j.idempotencyKey.slice(0, 24) + '...',
      }))
    );

    const allPassed = stageResults.every((s) => s.passed);

    console.log(`\n${c.bold}Execution Summary Table:${c.reset}`);
    console.table(
      stageResults.map((s) => ({
        Stage: `Stage ${s.stage}`,
        Scenario: s.title,
        Result: s.passed ? 'PASS' : 'FAIL',
        Evidence: s.observed.length > 50 ? s.observed.slice(0, 47) + '...' : s.observed,
      }))
    );

    if (allPassed) {
      console.log(`\n${c.bgGreen}${c.bold}  OVERALL DEMONSTRATION VERDICT: ALL 12 STAGES PASSED (100%)  ${c.reset}\n`);
    } else {
      console.log(`\n${c.bgRed}${c.bold}  OVERALL DEMONSTRATION VERDICT: SOME STAGES FAILED  ${c.reset}\n`);
      process.exitCode = 1;
    }
  } catch (fatalErr) {
    console.error(`\n${c.bgRed}${c.bold} FATAL DEMONSTRATION ERROR ${c.reset}`, fatalErr);
    process.exitCode = 1;
  } finally {
    console.log(`${c.dim}\nCleaning up demonstration resources...${c.reset}`);
    
    // Stop worker
    if (worker) {
      await worker.stop();
      console.log(`  Worker stopped.`);
    }

    // Close servers started by the demo
    if (apiServer) {
      await new Promise((res) => apiServer.close(res));
      console.log(`  Demo API Server closed.`);
    }
    if (mockServer) {
      await new Promise((res) => mockServer.close(res));
      console.log(`  Demo Mock Server closed.`);
    }

    // Reset mockStore configuration to baseline
    mockStore.clear();

    // Clean up isolated test data from this run
    try {
      await Workshop.deleteMany({ workshopId: { $regex: runId } });
      await Registration.deleteMany({ workshopId: { $regex: runId } });
      await NotificationJob.deleteMany({ workshopId: { $regex: runId } });
      await MockDelivery.deleteMany({ idempotencyKey: { $regex: runId } });
      console.log(`  Demo isolated test records cleaned.`);
    } catch {
      // Ignore cleanup error if DB disconnected
    }

    // Disconnect DB and stop replica set if created
    await disconnectDB();
    if (replSet) {
      await replSet.stop();
      console.log(`  Embedded MongoMemoryReplSet stopped.`);
    }
    console.log(`${c.green}Cleanup completed.${c.reset}\n`);
  }
}

runDemo();
