# Architecture & System Design

This document describes the high-level architecture, transactional outbox pattern, lease-based worker scheduling, and concurrency control implemented in the Workshop Registration and Notifications system.

---

## 1. System Overview

The system is partitioned into three decoupled execution components:

1. **API Server (`src/server.js`)**: An Express HTTP server handling client requests for workshops, registrations, and cancellations. It performs transactional database writes using MongoDB multi-document transactions.
2. **Transactional Outbox (`NotificationJob` collection)**: A persistent MongoDB queue storing events (`registration_confirmation`, `workshop_cancellation`) atomically with domain state changes.
3. **Background Worker (`src/workers/workerRunner.js`)**: An autonomous, poll-based daemon that claims jobs via atomic lease acquisition, manages exponential backoff retries, and forwards notifications to downstream delivery targets.
4. **Mock HTTP Notification Service (`src/notification-mock/mockServer.js`)**: An external delivery endpoint providing configurable failure simulations and deduplication via stable idempotency keys.

```mermaid
flowchart TD
    Client(["HTTP Client / Front-End"])
    
    subgraph API_Tier ["API Tier"]
        API["Express API Server (port 3000)"]
    end
    
    subgraph Storage ["MongoDB Storage (Replica Set)"]
        WS[("Workshops Collection")]
        REG[("Registrations Collection")]
        OUTBOX[("NotificationJobs (Outbox)")]
    end
    
    subgraph Worker_Tier ["Worker Tier"]
        WORKER["Background Worker Daemon"]
    end
    
    subgraph External_Service ["Downstream Delivery"]
        MOCK["Mock Notification Service (port 4000)"]
    end

    Client -->|"POST /workshops/:id/registrations"| API
    Client -->|"POST /workshops/:id/cancel"| API
    
    API -->|"Atomic Session Transaction<br/>(Write Reg + Outbox Job)"| Storage
    API -->|"HTTP 201 Response (Immediate)"| Client
    
    WORKER -->|"Atomic Claim (Status + Lease Lock)"| OUTBOX
    WORKER -->|"POST /notifications<br/>(Header: x-idempotency-key)"| MOCK
    MOCK -->|"200 OK / 500 / 503 / Timeout"| WORKER
    WORKER -->|"Status Update (Delivered / Backoff Retry / DLQ)"| OUTBOX
```

---

## 2. Sequence Diagram: Member Registration & Transactional Outbox

This diagram illustrates how member registration achieves zero data loss and immediate HTTP responses without blocking on network latency.

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant API as Express API Handler
    participant Mongo as MongoDB (Replica Set)
    participant Worker as Background Worker
    participant Mock as Mock Delivery Service

    Client->>API: POST /api/workshops/:id/registrations { memberId, destination }
    activate API
    Note over API,Mongo: Start MongoDB Session & Transaction
    API->>Mongo: Find workshop where workshopId = :id AND status = 'active'
    Mongo-->>API: Workshop document
    API->>Mongo: Touch workshop document ($inc: { __v: 1 }) [Concurrency Guard]
    API->>Mongo: Insert Registration { registrationId, workshopId, memberId, destination }
    API->>Mongo: Insert NotificationJob { jobId, eventType: 'registration_confirmation', status: 'pending', idempotencyKey }
    Note over API,Mongo: Commit Transaction (Atomically commits both records)
    API-->>Client: HTTP 201 Created { registrationId, workshopId, memberId }
    deactivate API
    Note over Client: Client receives success response immediately (latency < 50ms)

    Note over Worker,Mongo: Asynchronous Polling Interval
    Worker->>Mongo: findOneAndUpdate({ status: 'pending', nextAttemptAt <= now }, { status: 'processing', lockedBy: workerId, leaseExpiresAt })
    Mongo-->>Worker: Claimed NotificationJob
    activate Worker
    Worker->>Mock: POST /notifications (Header: x-idempotency-key)
    Mock-->>Worker: HTTP 200 OK { status: 'accepted', deliveryId }
    Worker->>Mongo: updateOne({ jobId, lockedBy: workerId }, { status: 'delivered', deliveredAt: now, lockedBy: null, leaseExpiresAt: null })
    deactivate Worker
```

---

## 3. Sequence Diagram: Workshop Cancellation & Failure Isolation

When a workshop is cancelled, all existing registrations are converted into independent cancellation notification jobs in a single transaction. If one recipient's destination fails, other recipients are delivered without stalling.

```mermaid
sequenceDiagram
    autonumber
    actor Organizer
    participant API as Express API Handler
    participant Mongo as MongoDB
    participant Worker as Background Worker
    participant Mock as Mock Delivery Service

    Organizer->>API: POST /api/workshops/:id/cancel
    activate API
    Note over API,Mongo: Start Session & Transaction
    API->>Mongo: findOneAndUpdate({ workshopId: :id, status: 'active' }, { status: 'cancelled' })
    Mongo-->>API: Updated workshop
    API->>Mongo: Find all registrations for workshopId
    Mongo-->>API: [Reg A (Alice), Reg B (Bob), Reg C (Charlie)]
    API->>Mongo: insertMany([Job Alice, Job Bob, Job Charlie]) with unique idempotency keys
    Note over API,Mongo: Commit Transaction
    API-->>Organizer: HTTP 200 OK { status: 'cancelled', meta: { jobsCreated: 3 } }
    deactivate API

    Note over Worker: Worker claims jobs concurrently
    par Process Alice
        Worker->>Mock: POST /notifications (Alice)
        Mock-->>Worker: HTTP 200 OK
        Worker->>Mongo: updateOne(Alice -> delivered)
    and Process Bob (Failing destination)
        Worker->>Mock: POST /notifications (Bob)
        Mock-->>Worker: HTTP 500 Internal Server Error
        Worker->>Mongo: updateOne(Bob -> pending, nextAttemptAt = now + backoff, attemptCount = 1)
        Note over Worker: Bob is rescheduled for retry; does not block Alice or Charlie!
    and Process Charlie
        Worker->>Mock: POST /notifications (Charlie)
        Mock-->>Worker: HTTP 200 OK
        Worker->>Mongo: updateOne(Charlie -> delivered)
    end
```

---

## 4. Sequence Diagram: Worker Crash Recovery & Mock Idempotency

This diagram details the lease recovery mechanism when a worker crashes after claiming a job or after downstream delivery acceptance.

```mermaid
sequenceDiagram
    autonumber
    participant W1 as Worker 1 (Crashes)
    participant Mongo as MongoDB (Outbox)
    participant W2 as Worker 2 (Surviving)
    participant Mock as Mock Delivery Service

    W1->>Mongo: findOneAndUpdate(status: 'pending') -> status: 'processing', lockedBy: 'W1', leaseExpiresAt: T + 15s
    Mongo-->>W1: Claimed Job
    W1->>Mock: POST /notifications (x-idempotency-key: "reg_conf:123")
    Mock-->>W1: HTTP 200 OK { status: 'accepted' } (Recorded in Mock persistent store)
    
    Note over W1: Worker 1 crashes before updating MongoDB! (Job remains 'processing', lease expires at T+15s)
    
    Note over Mongo: Time advances past T + 15s (Lease Expires)
    
    W2->>Mongo: findOneAndUpdate({ status: 'processing', leaseExpiresAt <= now })
    Note over W2,Mongo: W2 reclaims expired lease atomically!
    Mongo-->>W2: Claimed Job (lockedBy: 'W2', leaseExpiresAt: now + 15s)
    
    W2->>Mock: POST /notifications (x-idempotency-key: "reg_conf:123")
    Note over Mock: Mock checks persistent store for idempotencyKey "reg_conf:123"
    Mock-->>W2: HTTP 200 OK { status: 'deduplicated', message: 'Notification previously accepted' }
    
    W2->>Mongo: updateOne({ jobId, lockedBy: 'W2' }, { status: 'delivered', lockedBy: null, leaseExpiresAt: null })
    Note over W2: Job successfully delivered with zero duplicate deliveries!
```

---

## 5. Database Schema & Index Specifications

### 5.1 Workshops Collection
- `workshopId` (String, Unique Index)
- `title` (String, Trimmed, Required)
- `description` (String, Trimmed, Required)
- `organizerId` (String, Required)
- `status` (`'active'` | `'cancelled'`, Indexed)
- `createdAt`, `updatedAt` (Timestamps)

### 5.2 Registrations Collection
- `registrationId` (String, Unique Index)
- `workshopId` (String, Indexed)
- `memberId` (String, Indexed)
- `destination` (String, Trimmed, Required)
- `createdAt` (Date, default `Date.now`)
- **Compound Unique Index**: `{ workshopId: 1, memberId: 1 }` (unique constraint prevents duplicate registrations)

### 5.3 NotificationJobs Collection (Outbox)
- `jobId` (String, Unique Index)
- `eventType` (`'registration_confirmation'` | `'workshop_cancellation'`, Indexed)
- `workshopId` (String, Indexed)
- `registrationId` (String, Nullable, Indexed)
- `recipientId` (String, Indexed)
- `destination` (String, Required)
- `status` (`'pending'` | `'processing'` | `'delivered'` | `'dead_lettered'`, Indexed)
- `attemptCount` (Number, default 0)
- `maxAttempts` (Number, default 5)
- `nextAttemptAt` (Date, Indexed)
- `lastError` (Mixed: `{ message, status, timestamp }`)
- `idempotencyKey` (String, Unique Index)
- `payload` (Mixed)
- `leaseExpiresAt` (Date, Nullable, Indexed)
- `lockedBy` (String, Nullable)
- `deliveredAt` (Date, Nullable)
- **Compound Polling Index**: `{ status: 1, nextAttemptAt: 1 }`
- **Compound Lease Index**: `{ status: 1, leaseExpiresAt: 1 }`
- **Workshop Multi-Event Index**: `{ workshopId: 1, eventType: 1, recipientId: 1 }`
