# Week 1 — Ledger & Debit Transaction

**Status:** Skeleton complete. Core logic in place. TODOs remain for integration.

## Deliverables

### ✅ Schema (Complete)
- `migrations/0001_ledger.sql` — Full schema with trigger enforcement
- Tables: users, credit_balances, ledger_entries (append-only), jobs, outbox, webhook_events
- Indexes: efficient sweeper + expiry queries

### ✅ Ledger Implementation (Complete)
- `packages/db/ledger.ts` — Ledger class
  - `debit(req)` — §25.3 transaction (idempotency guard, lock, append, outbox)
  - `refund(jobId, userId, credits)` — Compensating entry + balance restore
  - `getBalance(userId)` — Cache read
  - `reconcile()` — CI/nightly check (balance = SUM(delta))

### ✅ Acceptance Tests (Complete)
- `tests/ledger.acceptance.test.ts` — §6 gates
  - §6.1: 50 concurrent debits → N successes, zero negative, zero double-spend
  - §6.2: Duplicate idempotency_key → single transition, 200 on dup
  - §6.3: Insufficient balance → ROLLBACK + error
  - §6.4: Refund → compensating entry + balance restored
  - §6.5: Append-only trigger (schema enforcement)
  - §6.6: Reconciliation check

### ✅ Gateway Skeleton (Partial)
- `src/index.ts` — Cloudflare Worker entrypoint
  - Routes: POST /v1/generations, GET /v1/generations/:jobId
  - Idempotency-Key validation
  - Error handling (402 = insufficient credits)

- `src/worker/gateway.ts` — GatewayWorker class
  - `generateImage(req, userId)` — Validates, looks up price (TODO), debits, creates job
  - `getJob(jobId)` — Polls job status (TODO: implement)

## TODOs for Week 1 Completion

### Critical Path (Blocking Week 2)
- [ ] Wire job creation: INSERT INTO jobs before debit transaction
- [ ] Integrate catalog: import PRICES from packages/catalog, lookup per model
- [ ] Auth integration: extract user_id from Clerk JWT (src/index.ts)
- [ ] Set up test database: Postgres testcontainer or in-memory SQLite
- [ ] Run acceptance tests: `npm test -- ledger.acceptance.test.ts`
- [ ] Reconciliation CI gate: Add to GitHub Actions

### Nice-to-Have
- [ ] OpenAPI schema for /v1/generations (for client code generation)
- [ ] Request validation schema (zod or similar)
- [ ] Observability: Sentry error reporting, PostHog events

## Running Locally

```bash
# Install
npm install

# Schema setup (one-time)
# Set NEON_DB_URL environment variable, then:
psql "$NEON_DB_URL" -f migrations/0001_ledger.sql

# Run tests
npm test -- ledger.acceptance.test.ts

# Start dev server (Wrangler)
wrangler dev

# Production deploy
wrangler deploy
```

## Next: Week 2

**Week 2 — Queue + First Adapter**

- Implement job state machine: PRICED → DEBITED → SUBMITTED → POLLING → STORE_PENDING → STORED
- First provider adapter: Wan 2.5 on fal.ai (ed25519 webhook verification)
- Webhook receiver: dedupe → transition → outbox media.store
- R2 storage: copy with retries (never inside transaction)
- Stuck-job sweeper: PRICED/SUBMITTED/STORE_PENDING → deadline → FAILED → REFUNDED

Build order: Queue consumer → Provider adapter → Sweeper cron → Webhook receiver.
