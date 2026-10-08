# Architecture Decision Record

## Overview

This document records the key architectural decisions for the Distributed Wagering Processor, following the requirements in the technical challenge.

## 1. Technology Choices

### ORM: MikroORM
**Decision:** Use MikroORM with PostgreSQL driver.

**Rationale:**
- Explicit Unit of Work and Identity Map patterns
- `EntityManager.transactional()` for automatic transaction management with retry
- `LockMode.PESSIMISTIC_WRITE` for row-level locking (SELECT FOR UPDATE)
- Versioned, reversible migrations
- Entity references work naturally with domain model

### Runtime: Bun 1.x
**Decision:** Use Bun as runtime, package manager, and test runner.

**Rationale:** Required by challenge specification.

### Money: decimal.js + Value Object
**Decision:** Implement `Money` as immutable Value Object using `decimal.js` for arbitrary precision arithmetic.

**Rationale:**
- Floating point (`number`) cannot represent decimal monetary values exactly (e.g., 0.1 + 0.2 !== 0.3)
- `decimal.js` provides exact decimal arithmetic
- Value Object pattern ensures immutability and encapsulation of validation
- String-based storage (`numeric(18,2)` + `currency` column) avoids precision loss

### Messaging: AWS SQS via LocalStack
**Decision:** Use SQS FIFO queues with LocalStack for local development.

**Rationale:**
- Required by challenge specification
- FIFO queues provide ordering within message group
- Content-based deduplication as optimization (not primary guarantee)
- DLQ configured with `maxReceiveCount=5`

## 2. Domain Model

### Wallet (Aggregate Root)
- Private constructor + static factories (`open`, `rehydrate`)
- `version` field for optimistic locking (incremented only on balance change)
- `debit()`/`credit()` methods enforce currency match and non-negative balance
- Pessimistic locking via `LockMode.PESSIMISTIC_WRITE` for concurrency control

### WagerTransaction (State Machine)
States: `PENDING` → `PROCESSED` | `REJECTED` | `FAILED` | `PENDING_REFERENCE`

Transitions:
- `PENDING` → `PROCESSED` (successful application)
- `PENDING` → `REJECTED` (business rule violation)
- `PENDING` → `FAILED` (infrastructure error)
- `PENDING` → `PENDING_REFERENCE` (reference transaction not found)
- `PENDING_REFERENCE` → `PROCESSED` | `REJECTED` | `FAILED` (after reference resolution)

Idempotency: Unique constraint on `idempotency_key` + SHA-256 payload hash validation

### WalletLedgerEntry (Immutable)
- No mutable fields, no transition methods
- Factory `create()` validates: `balanceBefore ± money === balanceAfter`, currency consistency, positive amount
- Unique constraint on `transaction_id` ensures max one ledger entry per transaction per wallet

### InboxMessage (SQS Deduplication)
- Unique constraint on `(consumer_name, message_id)`
- `processed_at` timestamp for idempotent processing
- Ack only after transaction commit

### OutboxMessage (Transactional Outbox)
- `published_at` null = pending
- `next_attempt_at` for exponential backoff + jitter scheduling
- Worker uses `SELECT FOR UPDATE SKIP LOCKED` pattern for concurrent publishing
- Max 10 attempts before giving up (marked published to avoid infinite retry)

## 3. Concurrency Strategy

### Unit of Concurrency: `walletId`

**Strategy:** Pessimistic Locking (`SELECT FOR UPDATE`)

**Rationale:**
- Hot wallet scenario (many concurrent bets on same wallet) would cause excessive retries with optimistic locking
- Pessimistic locking serializes access to the wallet row, guaranteeing no lost updates
- Lock held only for duration of transaction (typically < 10ms)
- PostgreSQL row locks don't block reads, only concurrent writes

### Implementation:
```typescript
const wallet = await walletRepo.findOne(
  { id: walletId },
  { lockMode: LockMode.PESSIMISTIC_WRITE }
);
```

## 4. Idempotency

### HTTP Endpoint
- Required `Idempotency-Key` header (format: `providerId:externalTransactionId`)
- Payload hash = SHA-256 of canonical JSON (sorted keys, business fields only)
- Same key + same payload → replay (returns original result, `idempotentReplay: true`)
- Same key + different payload → 409 Conflict

### SQS Consumer
- Inbox table with unique `(consumer_name, message_id)`
- Check inbox before processing
- Mark processed only after successful commit

## 5. Transactional Outbox

### Atomicity Requirement
Wallet balance change + Ledger entry + Inbox record + Outbox events = **single SQL transaction**

### Event Types
1. `WagerTransactionProcessed` - any transaction applied (including LOSS)
2. `WagerTransactionRejected` - business rule rejection
3. `WalletBalanceChanged` - **only when balance actually changes**
4. `WagerTransactionPendingReference` - reference not found

### Publisher Worker
- Polls every 5 seconds
- Batches up to 10 messages
- Uses `LockMode.PESSIMISTIC_WRITE` for `SELECT FOR UPDATE SKIP LOCKED`
- Exponential backoff: 1s, 2s, 4s, 8s... max 60s + jitter
- Marks published after successful SQS send

## 6. Reference Resolution (Out-of-Order)

### Flow
1. REFUND/ROLLBACK arrives without reference → status `PENDING_REFERENCE`
2. Event `WagerTransactionPendingReference` published
3. Scheduled worker (`reprocessPendingReference`) runs periodically
4. Attempts to find reference by `(providerId, referenceExternalTransactionId)`
5. Validates reference belongs to same provider, player, wallet, currency, round
6. If found and valid → process normally
7. If not found after TTL (configurable, default 24h) → `REJECTED` with `REFERENCE_NOT_FOUND`

### Validation Rules
- REFUND only references BET
- ROLLBACK references BET, WIN, or REFUND
- Reference must be terminal (PROCESSED)
- Reference must match: provider, player, wallet, currency, round
- Amount must match exactly (no partial reversals)

## 7. Reconciliation

### Endpoint: `POST /wallets/:walletId/reconciliation`

**Implementation:**
1. Fetch all ledger entries for wallet (chronological order)
2. Recalculate balance: sum credits, subtract debits
3. Compare with materialized `wallet.balance`
4. Return: stored, calculated, difference, consistent flag, entry count

**Policy:** Never auto-correct. Log discrepancies, expose in response, emit metric.

## 8. Error Handling & Failure Codes

| Code | Scenario | HTTP Status | Retryable |
|------|----------|-------------|-----------|
| `INSUFFICIENT_BALANCE` | BET exceeds balance | 400 | No |
| `REFERENCE_NOT_FOUND` | Reference TTL expired | 400 | No |
| `REFERENCE_ALREADY_REVERSED` | Double refund/rollback | 400 | No |
| `REFERENCE_INCORRECT_AMOUNT` | Amount mismatch | 400 | No |
| `REFERENCE_INCORRECT_PLAYER` | Player mismatch | 400 | No |
| `REFERENCE_INCORRECT_CURRENCY` | Currency mismatch | 400 | No |
| `REFERENCE_INCORRECT_ROUND` | Round mismatch | 400 | No |
| `REFERENCE_INCORRECT_PROVIDER` | Provider mismatch | 400 | No |
| `REFERENCE_NOT_TERMINAL` | Reference not PROCESSED | 400 | No |
| `INVALID_PAYLOAD` | Validation failure | 400 | No |
| `CURRENCY_MISMATCH` | Wallet vs transaction currency | 400 | No |
| `NEGATIVE_AMOUNT` | Negative transaction amount | 400 | No |
| `INTERNAL_ERROR` | Infrastructure failure | 500 | Yes |

## 9. Observability

### Structured Logging (JSON)
Fields: `correlationId`, `messageId`, `transactionId`, `walletId`, `providerId`, `level`, `message`, `timestamp`

**No sensitive data** (full payloads, PII) in logs.

### Metrics (Prometheus)
- `wager_transactions_total{status}` - counter by status
- `wager_idempotent_replays_total` - counter
- `wager_retries_total` - counter
- `wager_dlq_messages_total` - counter
- `wager_lock_conflicts_total` - counter
- `wager_outbox_lag_seconds` - gauge
- `wager_processing_duration_seconds` - histogram

### Health Checks
- `GET /health/live` - process alive (always 200)
- `GET /health/ready` - PostgreSQL + SQS reachable

## 10. Testing Strategy

### Unit Tests (105 passing)
- Money: construction, validation, arithmetic, comparison, serialization
- Wallet: open, rehydrate, credit, debit, invariants
- WagerTransaction: state machine, transitions, queries
- WalletLedgerEntry: creation, validation, immutability, rehydration

### Integration Tests (Planned)
- Real PostgreSQL + LocalStack in containers
- Migrations and constraints verification
- Atomicity: wallet + ledger + inbox + outbox in single transaction
- Inbox deduplication and redelivery
- Concurrent outbox publishers
- Retry, DLQ, crash recovery

### Concurrency Tests (Planned)
- 50 parallel identical bets → single debit
- Hot wallet: concurrent BETs on same wallet
- Parallel wallets processed independently
- ≥3 app instances simultaneously
- Worker crash after commit, before ack
- Dual outbox publishers
- Out-of-order REFUND/ROLLBACK
- Service restart with consistency verification

## 11. Authentication (Not Implemented)

**Decision:** No-op `AuthGuard` with explicit extension point.

**Rationale:** Per challenge section 2, authentication doesn't score points. Documented decision in this file.

**Extension Point:** `ProviderIdentityPort` interface for future IdP integration (Keycloak/Zitadel).

## 12. Deployment

### Docker Compose
- PostgreSQL 16 with healthcheck
- LocalStack (SQS) with healthcheck
- `sqs-init` service creates FIFO queues + DLQ
- App runs migrations on startup, then starts server

### Environment Variables
```
DATABASE_HOST=postgres
DATABASE_PORT=5432
DATABASE_NAME=wagering
DATABASE_USER=wagering
DATABASE_PASSWORD=wagering
AWS_REGION=us-east-1
SQS_ENDPOINT=http://localstack:4566
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
SQS_QUEUE_URL=http://localstack:4566/000000000000/wager-transactions.fifo
SQS_OUTBOX_QUEUE_URL=http://localstack:4566/000000000000/wagering-events.fifo
PORT=3000
NODE_ENV=production
```

## 13. Trade-offs & Limitations

| Decision | Trade-off | Mitigation |
|----------|-----------|------------|
| Pessimistic locking | Lower throughput on hot wallet | Acceptable for correctness; horizontal scaling by wallet sharding |
| Inbox table | +1 write per message | Required for persistent idempotency |
| Outbox table + worker | Eventual consistency for events | Business-critical events also in response |
| `decimal.js` dependency | Bundle size | Minimal; required for correctness |
| No authentication | Security gap in production | Documented extension point |
| Single currency (BRL) | Simplified scope | Model supports multi-currency |

## 14. Future Improvements

1. **Authentication**: Integrate Keycloak/Zitadel via OIDC
2. **Metrics**: Add Prometheus exporter + Grafana dashboards
3. **Tracing**: OpenTelemetry distributed tracing
4. **Load Testing**: `bun run test:load` with k6 or artillery
5. **Partitioning**: Wallet sharding for horizontal scaling
6. **Audit Log**: Separate immutable audit table for compliance
7. **Admin API**: Manual reconciliation correction with audit trail