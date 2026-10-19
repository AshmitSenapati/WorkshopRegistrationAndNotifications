# Workshop Registration & Notifications Backend

A production-grade, reliable backend implementing workshop registrations, asynchronous notifications via the **MongoDB Transactional Outbox Pattern**, background worker polling with atomic lease claims, idempotent cancellation fan-out, and failure isolation.

---

## 1. Project Overview

This backend decouples client-facing registration requests from asynchronous notification delivery side effects:
- **Transactional Outbox**: Workshop registrations and notification jobs are written atomically in a single MongoDB multi-document ACID transaction. The client receives an immediate `201 Created` response without waiting for downstream HTTP notification delivery.
- **Persistent Background Worker**: A dedicated worker daemon polls due outbox jobs, claims jobs using time-bounded atomic leases, executes exponential backoff with jitter on failures, and fences against stale workers.
- **Idempotent Cancellation**: Cancelling a workshop atomically updates workshop status to `cancelled` and schedules individual cancellation jobs for all registered members. Repeated cancellations are strictly idempotent.
- **Mock HTTP Notification Service**: Simulates realistic delivery with configurable failure modes (HTTP 500, HTTP 503, timeouts, latency), tracks delivery records, and prevents duplicate deliveries using stable idempotency keys.

---

## 2. Tech Stack

- **Runtime & Framework**: Node.js (ES modules), Express 5
- **Database & ODM**: MongoDB with Mongoose (requires replica set for multi-document transactions)
- **Validation & Docs**: Zod, Swagger UI Express (OpenAPI 3.0)
- **Testing**: Vitest, Supertest, `@vitest/coverage-v8`, `mongodb-memory-server`
- **Utilities**: `dotenv`, `cors`, `uuid`

---

## 3. Project Structure

```text
├── src/
│   ├── config/             # Environment validation and config loading (Zod)
│   ├── controllers/        # Express route request handlers
│   ├── docs/               # OpenAPI/Swagger 3.0 specification (swagger.json)
│   ├── middleware/         # Zod validation, centralized error handling, request logging
│   ├── models/             # Mongoose schemas (Workshop, Registration, NotificationJob, MockDelivery)
│   ├── notification-mock/  # Mock HTTP delivery service (mockServer, mockRoutes, mockStore)
│   ├── routes/             # API route definitions (workshops, registrations, notifications, health)
│   ├── services/           # Business logic and database transaction management
│   ├── utils/              # MongoDB transaction helpers, logger, error types, port probers
│   ├── workers/            # Persistent outbox worker daemon (notificationWorker, workerRunner)
│   ├── app.js              # Express application assembly
│   └── server.js           # API server entrypoint with graceful shutdown
├── scripts/
│   ├── demonstration.js    # Self-contained 12-stage automated CLI verification
│   └── interactiveMenu.js  # Terminal control panel (Node.js readline)
├── tests/                  # Integration test suites (46 tests across 7 suites)
├── docs/                   # Requirements audit, architecture diagrams, interview Q&A
├── .env.example            # Sample environment variables
└── package.json            # Scripts and dependencies
```

---

## 4. Setup

### Prerequisites
- **Node.js**: `v18.0.0` or higher (tested on `v22.19.0`)
- **npm**: `v9.0.0` or higher
- **MongoDB Replica Set**: A MongoDB deployment supporting multi-document transactions (e.g., MongoDB Atlas or local replica set `rs0`). *Note: Automated tests and `npm run demo` automatically start an embedded in-memory replica set and require no external database.*

### Installation & Environment Configuration
In Windows PowerShell:

```powershell
# 1. Clone or navigate to the repository
cd Workshop-rRegistration-and-Notifications

# 2. Install dependencies
npm install

# 3. Create your local .env configuration file
Copy-Item .env.example .env
```

Review `.env` and configure `MONGODB_URI` if running services manually against an external MongoDB replica set (e.g. `mongodb://127.0.0.1:27017/workshop_db?replicaSet=rs0` or MongoDB Atlas).

---

## 5. Run Commands (Manual Multi-Service Mode)

To run the full backend stack manually, start each component in **separate terminals** in the following startup order:

### Step 1: Start Mock Notification Service (Terminal 1)
```powershell
npm run mock
```
*Runs on `http://localhost:4000` (configurable via `MOCK_PORT`).*

### Step 2: Start API Server (Terminal 2)
```powershell
npm start
```
*Runs on `http://localhost:3000` (configurable via `PORT`). Interactive API documentation is available at `http://localhost:3000/api/docs`.*

### Step 3: Start Persistent Notification Worker (Terminal 3)
```powershell
npm run worker
```
*Polls due outbox jobs from MongoDB and delivers notifications asynchronously to the mock service.*

### Optional: Interactive Terminal Control Panel (Terminal 4)
```powershell
npm run menu
```
*Provides a numbered CLI menu to create workshops, register members, trigger cancellations, inject mock faults, and test worker restart recovery.*

---

## 6. API Endpoints

Interactive Swagger UI documentation is available at `http://localhost:3000/api/docs`.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Application health check and MongoDB connection status |
| `POST` | `/api/workshops` | Create a new workshop (`title`, `description`, `organizerId`) |
| `GET` | `/api/workshops` | List workshops (optional query filters: `status`, `organizerId`) |
| `GET` | `/api/workshops/:id` | Get workshop details by ID |
| `POST` | `/api/workshops/:id/registrations` | Register a member (`memberId`, `destination`); non-blocking outbox pattern |
| `GET` | `/api/workshops/:id/registrations` | List registered members for a workshop |
| `POST` | `/api/workshops/:id/cancel` | Cancel a workshop and atomically schedule member cancellation notifications |
| `GET` | `/api/notifications/jobs` | Inspect outbox jobs (query filters: `workshopId`, `status`, `eventType`, `recipientId`, `limit`, `skip`) |
| `GET` | `/api/notifications/jobs/:id` | Get a specific notification job by ID |

### Mock Notification Service Endpoints (`http://localhost:4000`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/notifications` | Notification ingestion endpoint (requires header `x-idempotency-key`) |
| `GET` | `/mock/health` | Mock service health check |
| `GET` / `POST` | `/mock/config` | Inspect or configure simulated errors (`500`, `503`, `timeout`, `delayMs`, `failRecipientId`) |
| `GET` | `/mock/deliveries` | Inspect delivery history, received counts, and deduplication records |
| `POST` | `/mock/deliveries/clear` | Clear mock delivery history and retry attempt counters |

---

## 7. Testing and Demonstration

> [!IMPORTANT]
> **Standalone Demo vs. Manual Services**:
> `npm run demo` is completely self-contained. It automatically spawns an embedded replica set (`MongoMemoryReplSet`), a dedicated API server on port `3050` (`DEMO_PORT`), a dedicated mock server on port `4050` (`DEMO_MOCK_PORT`), and a worker daemon. **You do not need to start any services before running `npm run demo`.**

### Run Automated Tests (46 Tests across 7 Suites)
```powershell
npm test
```

### Run Test Suite with Code Coverage Analysis
```powershell
npm run test:coverage
```

### Run Standalone 12-Stage Automated Demonstration
```powershell
npm run demo
```
Verifies all 12 operational scenarios:
1. Workshop creation
2. Registration response latency measurement ($<220\text{ms}$)
3. Non-blocking outbox proof (API responds in ~215ms despite 2000ms mock delay)
4. Persisted outbox job eventual delivery
5. Duplicate registration rejection (`HTTP 409 Conflict`)
6. HTTP 503 failures, bounded exponential backoff, and recovery
7. Pending outbox jobs surviving worker restart
8. Workshop cancellation fan-out
9. Independent cancellation jobs per member
10. Recipient failure isolation (failing recipient does not stall others)
11. Downstream idempotency and deduplication (`status: 'deduplicated'`)
12. Final database state verification table

---

## 8. Core Functionality

- **Transactional Outbox**: Registration and cancellation operations write business entities and outbox jobs (`NotificationJob`) inside the exact same MongoDB multi-document transaction. If the transaction aborts, neither record persists.
- **Asynchronous & Non-Blocking**: Clients receive `201 Created` immediately. HTTP calls to external delivery providers never happen on the critical API path.
- **Persistence Across Restarts**: Outbox jobs remain stored in MongoDB in `'pending'` state. When API servers or background workers crash or restart, jobs resume automatically.
- **Worker Leases & Fencing**: Workers claim due jobs using atomic `findOneAndUpdate` with a time-bounded lease (`leaseExpiresAt`, `lockedBy`). If a worker hangs past its lease, other workers recover the job safely. Stale workers attempting to complete an expired job fail conditional update fencing (`matchedCount === 0`) and discard split-brain writes.
- **Exponential Backoff & Dead-Lettering**: Transient failures (HTTP 500/503, timeouts, network disconnects) trigger bounded exponential backoff with jitter. Jobs exceeding `WORKER_MAX_ATTEMPTS` transition to `'dead_lettered'`.
- **Recipient Failure Isolation**: In multi-recipient events (cancellations), every recipient has a distinct notification job. A failure or timeout for one member does not block or delay delivery to other members.
- **Downstream Idempotency**: Every job contains a stable `idempotencyKey`. The mock delivery service records accepted keys; repeated requests return `HTTP 200 { status: 'deduplicated' }` without creating duplicate deliveries.

---

## 9. Troubleshooting

### 1. Database Connection Issues (`MongoServerError: This server does not support multi-document transactions`)
- **Cause**: Multi-document transactions require a MongoDB replica set. Standalone MongoDB instances do not support transactions.
- **Fix**: Connect to MongoDB Atlas or run a local replica set:
  ```powershell
  # Using Docker to spin up a local replica set:
  docker run -d --name mongo-rs -p 27017:27017 mongo:7.0 --replSet rs0
  docker exec -it mongo-rs mongosh --eval "rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27017' }] })"
  ```
  Set `MONGODB_URI=mongodb://127.0.0.1:27017/workshop_db?replicaSet=rs0` in `.env`.
  *(Note: `npm test` and `npm run demo` handle this automatically with an embedded in-memory replica set.)*

### 2. Missing Environment Variables (`Invalid environment configuration`)
- **Cause**: The application validates environment variables on startup using Zod in `src/config/index.js`.
- **Fix**: Ensure `.env` exists by running `Copy-Item .env.example .env`. Verify numeric values (`PORT`, `MOCK_PORT`, `WORKER_POLL_INTERVAL_MS`) are positive integers.

### 3. Port Conflicts (`EADDRINUSE: address already in use`)
- **Cause**: Port 3000 (API Server) or 4000 (Mock Service) is already bound by another process.
- **Fix**:
  - Stop any existing background node processes.
  - Or configure custom ports in `.env` (e.g. `PORT=3001` and `MOCK_PORT=4001`).
  - Note: `npm run demo` uses dedicated ports 3050 (`DEMO_PORT`) and 4050 (`DEMO_MOCK_PORT`) with automatic sequential fallback to prevent port collisions.

---

## 10. Additional Documentation

- [`docs/requirements-audit.md`](docs/requirements-audit.md) — Comprehensive 23-point requirement traceability matrix, defect resolutions, and coverage report.
- [`docs/architecture.md`](docs/architecture.md) — Architectural diagrams, data flows, and schema design.
- [`docs/interview-preparation.md`](docs/interview-preparation.md) — 10 deep-dive engineering interview Q&As on outbox patterns, distributed recovery, and idempotency.
