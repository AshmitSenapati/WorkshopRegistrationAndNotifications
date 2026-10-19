import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { fork } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import config from '../src/config/index.js';
import {
  validateWorkshopInput,
  validateRegistrationInput,
  validateCancellationConfirmation,
  validateFailureSimulationChoice,
} from '../src/utils/menuValidation.js';

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
  bgBlue: '\x1b[44m\x1b[37m',
  bgGreen: '\x1b[42m\x1b[30m',
  bgRed: '\x1b[41m\x1b[37m',
};

const API_BASE = process.env.API_BASE_URL || `http://localhost:${config.PORT || 3000}/api`;
const MOCK_BASE = process.env.MOCK_BASE_URL || `http://localhost:${config.MOCK_PORT || 4000}`;

let rl;

function printBanner() {
  console.log(`\n${c.bold}${c.cyan}╔═════════════════════════════════════════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}${c.cyan}║         WORKSHOP REGISTRATION & TRANSACTIONAL OUTBOX — CLI MENU            ║${c.reset}`);
  console.log(`${c.bold}${c.cyan}╚═════════════════════════════════════════════════════════════════════════════╝${c.reset}`);
  console.log(`${c.dim}API Server Target:    ${API_BASE}${c.reset}`);
  console.log(`${c.dim}Mock Service Target:  ${MOCK_BASE}${c.reset}`);
}

async function checkServiceHealth() {
  let apiHealthy = false;
  let mockHealthy = false;

  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(1500) });
    apiHealthy = res.ok;
  } catch {
    apiHealthy = false;
  }

  try {
    const res = await fetch(`${MOCK_BASE}/mock/health`, { signal: AbortSignal.timeout(1500) });
    mockHealthy = res.ok;
  } catch {
    mockHealthy = false;
  }

  return { apiHealthy, mockHealthy };
}

async function printHealthStatus(health) {
  const apiStatus = health.apiHealthy
    ? `${c.green}● ONLINE${c.reset}  (${API_BASE})`
    : `${c.red}○ OFFLINE${c.reset} (Start with: ${c.bold}npm start${c.reset})`;
  const mockStatus = health.mockHealthy
    ? `${c.green}● ONLINE${c.reset}  (${MOCK_BASE})`
    : `${c.red}○ OFFLINE${c.reset} (Start with: ${c.bold}npm run mock${c.reset})`;

  console.log(`\n${c.bold}System Service Status:${c.reset}`);
  console.log(`  • API Server:     ${apiStatus}`);
  console.log(`  • Mock Delivery:  ${mockStatus}`);
  console.log(`  • Worker Daemon:  ${c.dim}Ensure running in background via: ${c.bold}npm run worker${c.reset}`);
}

function printMenu() {
  console.log(`\n${c.bold}Select an operation:${c.reset}`);
  console.log(`  ${c.yellow}[1]${c.reset} Create workshop`);
  console.log(`  ${c.yellow}[2]${c.reset} Register member ${c.dim}(with immediate response & live delivery observation)${c.reset}`);
  console.log(`  ${c.yellow}[3]${c.reset} View workshops and registrations`);
  console.log(`  ${c.yellow}[4]${c.reset} Cancel workshop ${c.dim}(fan-out cancellation notifications)${c.reset}`);
  console.log(`  ${c.yellow}[5]${c.reset} View notification jobs and delivery history`);
  console.log(`  ${c.yellow}[6]${c.reset} Simulate notification failure or timeout`);
  console.log(`  ${c.yellow}[7]${c.reset} Restore mock notification service`);
  console.log(`  ${c.yellow}[8]${c.reset} Demonstrate pending-job recovery after worker restart`);
  console.log(`  ${c.yellow}[9]${c.reset} Run the complete automated demonstration (12 stages)`);
  console.log(`  ${c.yellow}[0]${c.reset} Exit`);
}

async function fetchJson(url, options = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────
// OPTION 1: Create workshop
// ─────────────────────────────────────────────────────────────
async function handleCreateWorkshop() {
  console.log(`\n${c.bold}${c.cyan}── Option 1: Create a Workshop ──${c.reset}`);
  const title = await rl.question('Enter workshop title: ');
  const description = await rl.question('Enter workshop description: ');
  const defaultOrg = 'organizer_lead';
  const organizerInput = await rl.question(`Enter organizer ID [default: ${defaultOrg}]: `);
  const organizerId = organizerInput.trim() || defaultOrg;

  const validation = validateWorkshopInput({ title, description, organizerId });
  if (!validation.isValid) {
    console.log(`\n${c.red}Validation Error:${c.reset}`);
    validation.errors.forEach((err) => console.log(`  • ${err}`));
    return;
  }

  console.log(`\nCreating workshop via POST ${API_BASE}/workshops...`);
  const res = await fetchJson(`${API_BASE}/workshops`, {
    method: 'POST',
    body: JSON.stringify(validation.data),
  });

  if (res.ok) {
    const ws = res.data.data;
    console.log(`\n${c.green}✔ Workshop created successfully!${c.reset}`);
    console.log(`  • ID:          ${c.bold}${ws.workshopId}${c.reset}`);
    console.log(`  • Title:       ${ws.title}`);
    console.log(`  • Description: ${ws.description}`);
    console.log(`  • Organizer:   ${ws.organizerId}`);
    console.log(`  • Status:      ${ws.status}`);
    console.log(`  • Created At:  ${ws.createdAt}`);
  } else {
    console.log(`\n${c.red}Failed to create workshop (HTTP ${res.status}):${c.reset} ${res.data?.error?.message || res.error || 'Unknown error'}`);
  }
}

// ─────────────────────────────────────────────────────────────
// OPTION 2: Register member
// ─────────────────────────────────────────────────────────────
async function handleRegisterMember() {
  console.log(`\n${c.bold}${c.cyan}── Option 2: Register Member ──${c.reset}`);

  // Fetch active workshops to assist the user
  const wsListRes = await fetchJson(`${API_BASE}/workshops?status=active`);
  let workshops = [];
  if (wsListRes.ok && wsListRes.data.data?.length > 0) {
    workshops = wsListRes.data.data;
    console.log(`\nAvailable Active Workshops:`);
    workshops.forEach((ws, idx) => {
      console.log(`  [${idx + 1}] ${ws.title} (${c.dim}ID: ${ws.workshopId}${c.reset})`);
    });
  }

  let workshopId = '';
  const wsInput = await rl.question(`\nSelect workshop # or paste Workshop ID: `);
  const wsIndex = parseInt(wsInput.trim(), 10);
  if (!isNaN(wsIndex) && wsIndex >= 1 && wsIndex <= workshops.length) {
    workshopId = workshops[wsIndex - 1].workshopId;
  } else {
    workshopId = wsInput.trim();
  }

  const defaultMember = `member_${uuidv4().slice(0, 6)}`;
  const memberInput = await rl.question(`Enter member ID [default: ${defaultMember}]: `);
  const memberId = memberInput.trim() || defaultMember;

  const defaultDest = `${memberId}@example.com`;
  const destInput = await rl.question(`Enter notification destination [default: ${defaultDest}]: `);
  const destination = destInput.trim() || defaultDest;

  const validation = validateRegistrationInput({ workshopId, memberId, destination });
  if (!validation.isValid) {
    console.log(`\n${c.red}Validation Error:${c.reset}`);
    validation.errors.forEach((err) => console.log(`  • ${err}`));
    return;
  }

  console.log(`\nSubmitting registration via POST ${API_BASE}/workshops/:id/registrations...`);
  const startTime = Date.now();
  const res = await fetchJson(`${API_BASE}/workshops/${workshopId}/registrations`, {
    method: 'POST',
    body: JSON.stringify({ memberId, destination }),
  });
  const latencyMs = Date.now() - startTime;

  if (res.ok) {
    const reg = res.data.data;
    console.log(`\n${c.green}${c.bold}✔ Registration Confirmed in ${latencyMs}ms!${c.reset}`);
    console.log(`  • Registration ID: ${reg.registrationId}`);
    console.log(`  • Workshop ID:     ${reg.workshopId}`);
    console.log(`  • Member ID:       ${reg.memberId}`);
    console.log(`  • Destination:     ${reg.destination}`);
    console.log(`  • Registered At:   ${reg.createdAt}`);
    console.log(`\n${c.cyan}[Transactional Outbox Architecture]${c.reset}`);
    console.log(`  The API responded ${c.bold}IMMEDIATELY${c.reset} without blocking on HTTP delivery.`);
    console.log(`  The notification job was persisted atomically in the MongoDB Outbox.`);

    // Offer live delivery observation
    const observe = await rl.question(`\nObserve asynchronous notification delivery live? (Y/n): `);
    if (observe.trim().toLowerCase() !== 'n') {
      console.log(`\nWatching outbox job status for ${memberId}...`);
      let delivered = false;
      for (let attempt = 1; attempt <= 15; attempt++) {
        await new Promise((r) => setTimeout(r, 400));
        const jobRes = await fetchJson(`${API_BASE}/notifications/jobs?workshopId=${workshopId}&recipientId=${memberId}`);
        if (jobRes.ok && jobRes.data.data?.length > 0) {
          const job = jobRes.data.data[0];
          process.stdout.write(`\r  [Polling ${attempt}/15] Job Status: ${c.bold}${job.status}${c.reset} | Attempts: ${job.attemptCount} | Next: ${job.nextAttemptAt ? new Date(job.nextAttemptAt).toLocaleTimeString() : 'none'} `);
          if (job.status === 'delivered') {
            delivered = true;
            console.log(`\n\n${c.green}✔ Outbox job delivered successfully!${c.reset}`);
            console.log(`  • Delivered At: ${job.deliveredAt}`);
            console.log(`  • Idempotency Key: ${job.idempotencyKey}`);
            break;
          }
          if (job.status === 'dead_lettered') {
            console.log(`\n\n${c.red}✖ Job reached Dead-Letter Queue (DLQ): ${job.lastError?.message}${c.reset}`);
            break;
          }
        }
      }
      if (!delivered) {
        console.log(`\n${c.dim}(Job is still processing or scheduled for backoff retry. Inspect via Option 5.)${c.reset}`);
      }
    }
  } else {
    console.log(`\n${c.red}Registration Failed (HTTP ${res.status}):${c.reset} ${res.data?.error?.message || res.error || 'Unknown error'}`);
  }
}

// ─────────────────────────────────────────────────────────────
// OPTION 3: View workshops and registrations
// ─────────────────────────────────────────────────────────────
async function handleViewWorkshopsAndRegistrations() {
  console.log(`\n${c.bold}${c.cyan}── Option 3: Workshops & Registrations ──${c.reset}`);
  const wsRes = await fetchJson(`${API_BASE}/workshops`);
  if (!wsRes.ok) {
    console.log(`${c.red}Failed to retrieve workshops:${c.reset} ${wsRes.error || wsRes.data?.error?.message}`);
    return;
  }

  const workshops = wsRes.data.data || [];
  if (workshops.length === 0) {
    console.log(`${c.yellow}No workshops found in database. Create one using Option 1.${c.reset}`);
    return;
  }

  console.log(`\nTotal Workshops: ${workshops.length}`);
  console.table(
    workshops.map((w, idx) => ({
      '#': idx + 1,
      'Workshop ID': w.workshopId.slice(0, 18) + '...',
      Title: w.title.length > 30 ? w.title.slice(0, 27) + '...' : w.title,
      Status: w.status,
      Organizer: w.organizerId,
      'Created At': new Date(w.createdAt).toLocaleTimeString(),
    }))
  );

  const sel = await rl.question(`\nEnter # or Workshop ID to view registrations (or press Enter to return): `);
  const selStr = sel.trim();
  if (!selStr) return;

  let targetId = selStr;
  const num = parseInt(selStr, 10);
  if (!isNaN(num) && num >= 1 && num <= workshops.length) {
    targetId = workshops[num - 1].workshopId;
  }

  const regRes = await fetchJson(`${API_BASE}/workshops/${targetId}/registrations`);
  if (!regRes.ok) {
    console.log(`${c.red}Failed to retrieve registrations:${c.reset} ${regRes.data?.error?.message || regRes.error}`);
    return;
  }

  const registrations = regRes.data.data || [];
  console.log(`\nRegistrations for workshop "${targetId}" (${registrations.length} total):`);
  if (registrations.length === 0) {
    console.log(`${c.dim}No members registered for this workshop yet.${c.reset}`);
  } else {
    console.table(
      registrations.map((r, idx) => ({
        '#': idx + 1,
        'Registration ID': r.registrationId.slice(0, 18) + '...',
        Member: r.memberId,
        Destination: r.destination,
        'Registered At': new Date(r.createdAt).toLocaleTimeString(),
      }))
    );
  }
}

// ─────────────────────────────────────────────────────────────
// OPTION 4: Cancel workshop
// ─────────────────────────────────────────────────────────────
async function handleCancelWorkshop() {
  console.log(`\n${c.bold}${c.cyan}── Option 4: Cancel Workshop ──${c.reset}`);

  // Fetch active workshops
  const wsRes = await fetchJson(`${API_BASE}/workshops?status=active`);
  const workshops = wsRes.data?.data || [];

  if (workshops.length === 0) {
    console.log(`${c.yellow}No active workshops available to cancel.${c.reset}`);
    return;
  }

  console.log(`\nActive Workshops:`);
  workshops.forEach((ws, idx) => {
    console.log(`  [${idx + 1}] ${ws.title} (${c.dim}ID: ${ws.workshopId}${c.reset})`);
  });

  const sel = await rl.question(`\nEnter # or Workshop ID to cancel (or press Enter to return): `);
  const selStr = sel.trim();
  if (!selStr) return;

  let targetWs = null;
  const num = parseInt(selStr, 10);
  if (!isNaN(num) && num >= 1 && num <= workshops.length) {
    targetWs = workshops[num - 1];
  } else {
    targetWs = workshops.find((w) => w.workshopId === selStr) || { workshopId: selStr, title: selStr };
  }

  console.log(`\n${c.bold}${c.red}⚠ WARNING: Cancelling a workshop is IRREVERSIBLE.${c.reset}`);
  console.log(`  • Future registrations will be rejected.`);
  console.log(`  • An independent cancellation notification will be scheduled for every registered member.`);
  console.log(`  Target: "${targetWs.title}" (${targetWs.workshopId})`);

  const confirm = await rl.question(`\nAre you sure you want to cancel this workshop? (yes/no): `);
  if (!validateCancellationConfirmation(confirm)) {
    console.log(`${c.dim}Cancellation aborted by user.${c.reset}`);
    return;
  }

  const reason = await rl.question(`Enter cancellation reason [default: Organizer cancelled workshop]: `);

  console.log(`\nSubmitting cancellation via POST ${API_BASE}/workshops/:id/cancel...`);
  const cancelRes = await fetchJson(`${API_BASE}/workshops/${targetWs.workshopId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason: reason.trim() || 'Organizer cancelled workshop' }),
  });

  if (cancelRes.ok) {
    const meta = cancelRes.data.meta;
    console.log(`\n${c.green}✔ Workshop cancelled successfully!${c.reset}`);
    console.log(`  • Workshop ID:       ${cancelRes.data.data.workshopId}`);
    console.log(`  • Status:            ${cancelRes.data.data.status}`);
    console.log(`  • Already Cancelled: ${meta.alreadyCancelled}`);
    console.log(`  • Outbox Jobs Made:  ${meta.jobsCreated} (one per registered member)`);
    if (meta.alreadyCancelled) {
      console.log(`  ${c.dim}(Idempotent call: No duplicate cancellation jobs were created.)${c.reset}`);
    }
  } else {
    console.log(`\n${c.red}Failed to cancel workshop (HTTP ${cancelRes.status}):${c.reset} ${cancelRes.data?.error?.message || cancelRes.error}`);
  }
}

// ─────────────────────────────────────────────────────────────
// OPTION 5: View notification jobs and delivery history
// ─────────────────────────────────────────────────────────────
async function handleViewJobsAndHistory() {
  console.log(`\n${c.bold}${c.cyan}── Option 5: Notification Jobs & Delivery History ──${c.reset}`);
  console.log(`  [1] View Outbox Notification Jobs (from API server)`);
  console.log(`  [2] View Mock Delivery History (from Mock HTTP service)`);
  console.log(`  [3] View Both`);

  const choice = await rl.question(`Select option [1-3, default: 3]: `);
  const opt = choice.trim() || '3';

  if (opt === '1' || opt === '3') {
    const jobsRes = await fetchJson(`${API_BASE}/notifications/jobs?limit=50`);
    if (jobsRes.ok) {
      const jobs = jobsRes.data.data || [];
      console.log(`\n${c.bold}Transactional Outbox Notification Jobs (${jobs.length} total):${c.reset}`);
      if (jobs.length === 0) {
        console.log(`  ${c.dim}No jobs in outbox.${c.reset}`);
      } else {
        console.table(
          jobs.map((j) => ({
            'Job ID': j.jobId.slice(0, 16) + '...',
            Event: j.eventType === 'registration_confirmation' ? 'reg_conf' : 'ws_cancel',
            Recipient: j.recipientId.slice(0, 20),
            Status: j.status,
            Attempts: j.attemptCount,
            'Last Error': j.lastError?.message ? j.lastError.message.slice(0, 22) + '...' : 'none',
            'Delivered At': j.deliveredAt ? new Date(j.deliveredAt).toLocaleTimeString() : 'pending',
            IdempotencyKey: j.idempotencyKey.slice(0, 24) + '...',
          }))
        );
      }
    } else {
      console.log(`${c.red}Failed to fetch notification jobs:${c.reset} ${jobsRes.error || jobsRes.data?.error?.message}`);
    }
  }

  if (opt === '2' || opt === '3') {
    const mockRes = await fetchJson(`${MOCK_BASE}/mock/deliveries`);
    if (mockRes.ok) {
      const deliveries = mockRes.data.deliveries || [];
      console.log(`\n${c.bold}Mock Notification Service Delivery History (${deliveries.length} total):${c.reset}`);
      if (deliveries.length === 0) {
        console.log(`  ${c.dim}No deliveries recorded in mock service yet.${c.reset}`);
      } else {
        console.table(
          deliveries.map((d) => ({
            'Idempotency Key': d.idempotencyKey.slice(0, 28) + '...',
            Recipient: d.recipientId,
            Event: d.eventType,
            'Received Count': d.receivedCount,
            Status: d.status,
            'Received At': new Date(d.receivedAt).toLocaleTimeString(),
          }))
        );
      }
    } else {
      console.log(`${c.yellow}Mock service deliveries could not be reached:${c.reset} ${mockRes.error || 'Service offline'}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// OPTION 6: Simulate notification failure or timeout
// ─────────────────────────────────────────────────────────────
async function handleSimulateFailure() {
  console.log(`\n${c.bold}${c.cyan}── Option 6: Simulate Failure or Timeout ──${c.reset}`);

  // Fetch current config
  const cfgRes = await fetchJson(`${MOCK_BASE}/mock/config`);
  if (!cfgRes.ok) {
    console.log(`${c.red}Mock service is not reachable at ${MOCK_BASE}.${c.reset} Please start with: npm run mock`);
    return;
  }

  const currentCfg = cfgRes.data.config;
  console.log(`\nCurrent Mock Settings:`);
  console.log(`  • Failure Mode:      ${currentCfg.failMode}`);
  console.log(`  • Fail Recipient ID: ${currentCfg.failRecipientId || 'none'}`);
  console.log(`  • Fail 1st N Times:  ${currentCfg.failFirstNAttempts}`);
  console.log(`  • Artificial Delay:  ${currentCfg.delayMs}ms`);

  console.log(`\nSelect simulation to apply:`);
  console.log(`  ${c.yellow}[1]${c.reset} HTTP 500 (Internal Server Error on all deliveries)`);
  console.log(`  ${c.yellow}[2]${c.reset} HTTP 503 (Service Unavailable on all deliveries)`);
  console.log(`  ${c.yellow}[3]${c.reset} Request Timeout (Artificial delay > worker timeout)`);
  console.log(`  ${c.yellow}[4]${c.reset} Selective Recipient Failure (Fails only a specific member ID)`);
  console.log(`  ${c.yellow}[5]${c.reset} Temporary Outage (Fail the first N attempts, then succeed)`);
  console.log(`  ${c.yellow}[6]${c.reset} Introduce Artificial Delivery Delay`);

  const choice = await rl.question(`Select simulation [1-6]: `);
  if (!validateFailureSimulationChoice(choice)) {
    console.log(`${c.red}Invalid option.${c.reset}`);
    return;
  }

  let updatePayload = {};

  switch (choice.trim()) {
    case '1':
      updatePayload = { failMode: '500' };
      break;
    case '2':
      updatePayload = { failMode: '503' };
      break;
    case '3':
      updatePayload = { failMode: 'timeout' };
      break;
    case '4': {
      const recipient = await rl.question('Enter recipient memberId to fail (e.g. member_bob): ');
      updatePayload = { failRecipientId: recipient.trim() || 'member_bob' };
      break;
    }
    case '5': {
      const nStr = await rl.question('Enter number of initial attempts to fail [default: 2]: ');
      const n = parseInt(nStr.trim(), 10) || 2;
      updatePayload = { failFirstNAttempts: n };
      break;
    }
    case '6': {
      const msStr = await rl.question('Enter delay in milliseconds [default: 2000]: ');
      const delayMs = parseInt(msStr.trim(), 10) || 2000;
      updatePayload = { delayMs };
      break;
    }
  }

  const updateRes = await fetchJson(`${MOCK_BASE}/mock/config`, {
    method: 'POST',
    body: JSON.stringify(updatePayload),
  });

  if (updateRes.ok) {
    console.log(`\n${c.green}✔ Mock configuration updated successfully!${c.reset}`);
    console.log(`  New configuration:`, updateRes.data.config);
    console.log(`\n${c.cyan}Next Steps:${c.reset} Register a member or cancel a workshop to observe worker retry, backoff, or failure isolation.`);
  } else {
    console.log(`\n${c.red}Failed to update mock configuration:${c.reset} ${updateRes.error || updateRes.data?.error}`);
  }
}

// ─────────────────────────────────────────────────────────────
// OPTION 7: Restore mock notification service
// ─────────────────────────────────────────────────────────────
async function handleRestoreMockService() {
  console.log(`\n${c.bold}${c.cyan}── Option 7: Restore Mock Notification Service ──${c.reset}`);
  const resetPayload = {
    failMode: 'none',
    failRecipientId: null,
    failFirstNAttempts: 0,
    delayMs: 0,
    failAll: false,
  };

  const res = await fetchJson(`${MOCK_BASE}/mock/config`, {
    method: 'POST',
    body: JSON.stringify(resetPayload),
  });

  if (res.ok) {
    console.log(`\n${c.green}✔ Mock notification service restored to healthy normal baseline!${c.reset}`);
    console.log(`  • Failure Mode:      none`);
    console.log(`  • Fail Recipient ID: none`);
    console.log(`  • Fail 1st N Times:  0`);
    console.log(`  • Delay:             0ms`);
  } else {
    console.log(`\n${c.red}Failed to restore mock service:${c.reset} ${res.error || res.data?.error}`);
  }
}

// ─────────────────────────────────────────────────────────────
// OPTION 8: Demonstrate pending-job recovery after worker restart
// ─────────────────────────────────────────────────────────────
async function handleDemonstrateWorkerRecovery() {
  console.log(`\n${c.bold}${c.cyan}── Option 8: Pending-Job Worker Restart Recovery ──${c.reset}`);
  console.log(`This demonstration tests how outbox jobs survive worker downtime and recover after restart.\n`);
  console.log(`Select recovery mode:`);
  console.log(`  ${c.yellow}[1]${c.reset} Manual Walkthrough (register a member while your external worker is stopped)`);
  console.log(`  ${c.yellow}[2]${c.reset} Automated Simulation (programmatically demonstrates worker stop/start recovery)`);

  const choice = await rl.question(`Select [1-2, default: 2]: `);
  const opt = choice.trim() || '2';

  if (opt === '1') {
    console.log(`\n${c.bold}Manual Instructions:${c.reset}`);
    console.log(`1. Stop your background worker in its terminal (${c.bold}Ctrl+C${c.reset}).`);
    console.log(`2. Press Enter here to submit a registration while the worker is offline.`);
    await rl.question(`Press Enter when your worker is stopped... `);

    // Create a workshop
    const wsRes = await fetchJson(`${API_BASE}/workshops`, {
      method: 'POST',
      body: JSON.stringify({
        title: `Worker Recovery Demonstration (${new Date().toLocaleTimeString()})`,
        description: 'Testing persistence across worker restarts',
        organizerId: 'resilience_lead',
      }),
    });

    if (!wsRes.ok) {
      console.log(`${c.red}API request failed:${c.reset} ${wsRes.error}`);
      return;
    }

    const ws = wsRes.data.data;
    const testMember = `offline_member_${uuidv4().slice(0, 5)}`;
    const regRes = await fetchJson(`${API_BASE}/workshops/${ws.workshopId}/registrations`, {
      method: 'POST',
      body: JSON.stringify({ memberId: testMember, destination: `${testMember}@example.com` }),
    });

    if (!regRes.ok) {
      console.log(`${c.red}Registration failed:${c.reset} ${regRes.error}`);
      return;
    }

    // Query job
    const jobRes = await fetchJson(`${API_BASE}/notifications/jobs?workshopId=${ws.workshopId}&recipientId=${testMember}`);
    const job = jobRes.data?.data?.[0];

    console.log(`\n${c.green}✔ Member registered while worker was offline!${c.reset}`);
    console.log(`  • Job ID:     ${job?.jobId}`);
    console.log(`  • Job Status: ${c.bold}${job?.status}${c.reset} (persisted safely in MongoDB outbox)`);
    console.log(`  • Attempts:   ${job?.attemptCount}`);

    console.log(`\n${c.bold}Next Step:${c.reset} Start your worker in a terminal: ${c.bold}npm run worker${c.reset}`);
    console.log(`Observe the worker pick up this pending job and mark it delivered.`);
  } else {
    console.log(`\nRunning automated crash & restart recovery demonstration from scripts/demonstration.js (Stage 7)...`);
    // Run stage 7 logic directly via child process
    await new Promise((resolve) => {
      const child = fork('scripts/demonstration.js', [], {
        stdio: 'inherit',
      });
      child.on('exit', () => resolve());
    });
  }
}

// ─────────────────────────────────────────────────────────────
// OPTION 9: Run the complete automated demonstration
// ─────────────────────────────────────────────────────────────
async function handleRunFullDemonstration() {
  console.log(`\n${c.bold}${c.cyan}── Option 9: Complete 12-Stage Automated Demonstration ──${c.reset}`);
  console.log(`Spawning demonstration process (scripts/demonstration.js)...\n`);

  await new Promise((resolve) => {
    const child = fork('scripts/demonstration.js', [], {
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      console.log(`\n${c.dim}Demonstration process finished with exit code ${code}.${c.reset}`);
      resolve();
    });
  });
}

// ─────────────────────────────────────────────────────────────
// Main CLI Loop
// ─────────────────────────────────────────────────────────────
async function main() {
  rl = readline.createInterface({ input, output });

  // Handle Ctrl+C gracefully
  rl.on('SIGINT', () => {
    console.log(`\n\n${c.yellow}[Ctrl+C detected] Exiting CLI menu. Goodbye!${c.reset}\n`);
    rl.close();
    process.exit(0);
  });

  printBanner();

  let running = true;
  while (running) {
    const health = await checkServiceHealth();
    await printHealthStatus(health);
    printMenu();

    const answer = await rl.question(`\nEnter choice [0-9]: `);
    const choice = answer.trim();

    try {
      switch (choice) {
        case '1':
          await handleCreateWorkshop();
          break;
        case '2':
          await handleRegisterMember();
          break;
        case '3':
          await handleViewWorkshopsAndRegistrations();
          break;
        case '4':
          await handleCancelWorkshop();
          break;
        case '5':
          await handleViewJobsAndHistory();
          break;
        case '6':
          await handleSimulateFailure();
          break;
        case '7':
          await handleRestoreMockService();
          break;
        case '8':
          await handleDemonstrateWorkerRecovery();
          break;
        case '9':
          await handleRunFullDemonstration();
          break;
        case '0':
          running = false;
          console.log(`\n${c.green}Thank you for exploring the Workshop Registration & Notifications CLI! Goodbye.${c.reset}\n`);
          break;
        default:
          console.log(`\n${c.red}Invalid option "${choice}". Please select a number from 0 to 9.${c.reset}`);
          break;
      }
    } catch (err) {
      console.log(`\n${c.red}Error executing command:${c.reset} ${err.message}`);
    }

    if (running) {
      await rl.question(`\n${c.dim}Press Enter to return to the main menu...${c.reset}`);
    }
  }

  rl.close();
  process.exit(0);
}

main();
