# Backend Engineering Interview Preparation: Deep Dive Q&A

This document provides senior-level engineering answers to fundamental architectural, reliability, and distributed systems questions arising from this project.

---

### 1. Why is an outbox needed?
In a microservices or distributed environment, persisting business state (e.g. creating a registration) and publishing an event (e.g. sending a notification) involves two separate systems: a database and an external network/message broker. This presents the **dual-write problem**:
- If you write to the database first and the notification network call fails, your database has committed state that the external world was never told about.
- If you make the network call first and the database write fails (e.g., constraint violation or timeout), an external party received a confirmation for an entity that never existed.

The **Transactional Outbox Pattern** solves this by converting the remote call into a local database row inserted *within the exact same ACID database transaction* as the entity. Because database transactions are atomic, either both the registration and its notification job are committed, or neither is. The outbox decouples durability from delivery.

---

### 2. Why not send notifications directly in the API handler?
Sending notifications directly in the HTTP request handler introduces critical architectural failure modes:
1. **Unpredictable Latency & Cascading Stalls**: Downstream notification services, email providers, or cellular gateways experience unpredictable latency, slow TLS handshakes, or network congestion. Tying the client's HTTP response to a third-party call degrades p99 latency and exhausts API server connection pools.
2. **Loss of In-Flight Work on Server Restart**: If the API server crashes or is restarted mid-request, any in-memory retry loops or promises vanish instantly.
3. **Breach of Atomic Boundary**: If the database commits but the network call drops, the user cannot easily recover without manual support tickets.
4. **Denial of Service**: A spike in registrations directly thrashes downstream notification providers with burst traffic instead of smoothly draining via controlled worker polling.

---

### 3. How does the system recover after a crash?
Recovery is achieved through persistent database state and deterministic status transitions:
- **API Server Crash**: Because jobs are stored in MongoDB (a persistent replica set), pending jobs remain safely on disk. When the API or worker resumes, the worker queries `{ status: 'pending', nextAttemptAt: { $lte: now } }` and resumes delivery seamlessly.
- **Worker Process Crash**: If a worker crashes while processing a job, the job is not lost because jobs are claimed with a time-limited lease (`leaseExpiresAt`). Once that lease timestamp lapses, the job becomes eligible for reclamation by any surviving worker.

---

### 4. What happens if a worker crashes after claiming a job?
When a worker claims a job, it executes an atomic `findOneAndUpdate`:
```javascript
{
  $set: {
    status: 'processing',
    lockedBy: workerId,
    leaseExpiresAt: new Date(Date.now() + leaseDurationMs) // e.g. 15 seconds
  }
}
```
If the worker process dies midway through execution:
1. The job remains in `'processing'` status temporarily.
2. The lease timer runs down.
3. The next worker polling cycle looks for `{ status: 'processing', leaseExpiresAt: { $lte: now } }`.
4. A healthy worker claims the orphaned job, assigns a new `workerId` and fresh lease, and retries delivery.
5. If the crashed worker revives later and attempts to update the database, its write is rejected via **fencing**: `updateOne({ jobId, lockedBy: myOldWorkerId })` will match 0 documents because the lock was already reassigned.

---

### 5. What happens if the service accepts a notification but the worker times out?
This is a classic distributed systems ambiguity:
1. The worker sends an HTTP request to the notification service.
2. The notification service accepts and processes the notification.
3. Before the HTTP 200 response reaches the worker, a network hiccup or client-side timeout occurs.
4. The worker records a failure and schedules a retry (or its lease expires).
5. On the subsequent attempt, the worker resends the payload with the **same stable `x-idempotency-key`**.
6. The downstream notification service checks its persistent store for that idempotency key, detects that the request was previously accepted, and returns HTTP 200 without duplicating the email/SMS to the end-user.

---

### 6. How are duplicate requests prevented?
Duplicate prevention is enforced at two distinct layers:
1. **Registration Duplication**:
   - The `Registration` collection has a database-level compound unique index: `{ workshopId: 1, memberId: 1 }`.
   - Concurrent requests for the same member and workshop are serialized by MongoDB: one transaction succeeds, and all concurrent attempts fail with MongoDB error code `11000` (Duplicate Key), cleanly mapped to `HTTP 409 Conflict`.
2. **Notification Delivery Duplication**:
   - Each notification job is assigned a deterministic, immutable `idempotencyKey`:
     - Registration Confirmation: `reg_conf:<registrationId>`
     - Workshop Cancellation: `cancel:<workshopId>:<memberId>`
   - The downstream service deduplicates incoming deliveries based on this key.

---

### 7. Why are retries not equivalent to exactly-once delivery?
In distributed systems, the **Two Generals' Problem** and FLP impossibility prove that pure **exactly-once delivery** across an unreliable network is physically impossible without shared atomic state:
- You cannot differentiate between "the remote server never received my packet" and "the remote server received my packet, processed it, but the ACK was lost on the wire."
- Therefore, retry mechanisms guarantee **at-least-once delivery**.
- To achieve **effectively exactly-once processing**, at-least-once delivery *must be combined with downstream receiver idempotency*. The sender guarantees the message arrives at least once, and the receiver uses an idempotency key to ensure side-effects execute exactly once.

---

### 8. How are concurrent workers coordinated?
Instead of heavy distributed locks (e.g. ZooKeeper or Redlock), workers are coordinated via **optimistic concurrency and database-level atomic document updates**:
- MongoDB `findOneAndUpdate` is atomic at the document level.
- When $N$ workers poll simultaneously, MongoDB locks the document during the update and evaluates the query conditions `{ status: 'pending', nextAttemptAt: { $lte: now } }`.
- Only *one* worker matches and claims the document, transitioning its status to `'processing'` and stamping it with `lockedBy: workerId`.
- Other workers skip that document and claim subsequent matching records, preventing duplicate processing without distributed deadlocks.

---

### 9. How are registration/cancellation races handled?
A subtle race condition occurs if an organizer cancels a workshop at the exact millisecond a member submits a registration:
- **Naïve approach**: Read `status === 'active'` in the registration handler. If cancellation runs immediately after the read, the registration commits to a cancelled workshop.
- **Our Robust Approach**:
  1. Both operations run inside multi-document ACID transactions with `Read-Committed` isolation.
  2. The registration transaction conditionally touches the workshop document:
     ```javascript
     const activeLock = await Workshop.findOneAndUpdate(
       { workshopId, status: 'active' },
       { $inc: { __v: 1 } },
       { session, returnDocument: 'after' }
     );
     ```
  3. If cancellation commits first, `status` is already `'cancelled'`. The registration condition fails, returning `activeLock === null`, and the transaction aborts with `HTTP 400`.
  4. If both transactions attempt to modify the workshop document simultaneously, MongoDB detects a **WriteConflict**. The losing transaction is automatically aborted and retried. Upon retry, it reads the committed `'cancelled'` status and aborts cleanly.
  5. Result: A registration can **never** commit after cancellation has won.

---

### 10. Why use exponential backoff and dead-lettering?
- **Exponential Backoff**: If an external service experiences an outage or overload, retrying immediately at fixed intervals creates a **thundering herd / retry storm**, driving the struggling service deeper into failure. Exponential backoff ($T = \text{base} \times \text{factor}^{\text{attempt}-1}$) spreads out retries, allowing the downstream system time to recover. Adding random **jitter** desynchronizes concurrent workers so they do not retry in lockstep waves.
- **Dead-Lettering (DLQ)**: Without a retry threshold, permanently invalid requests (e.g., malformed recipient address, deleted mailbox, non-existent domain) would cycle through worker polling forever, consuming database I/O, worker threads, and memory. Moving a job to `'dead_lettered'` after a configurable threshold (e.g. 5 attempts) removes it from active polling while keeping the failure audit trail intact for operator inspection and alerts.
