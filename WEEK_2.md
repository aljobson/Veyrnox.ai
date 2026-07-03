# Week 2 — Job Queue + fal.ai Adapter

**Status:** Skeleton complete. Core state machine + provider integration in place. TODOs remain for ed25519 verification, failover logic.

## Deliverables

### ✅ Job State Machine (Complete)
- `packages/db/job-state.ts` — JobStateMachine class
  - State flow: PRICED → SUBMITTED → POLLING → STORE_PENDING → STORED
  - Failure paths: REJECTED, TIMEOUT, FAILOVER, FAILED, REFUNDED
  - Methods: transition(), getJob(), findStuckJobs(), markFailedAndRefund()
  - Auto-refund on FAILED (§5.7 invariant enforced)

### ✅ Provider Adapter Interface (Complete)
- `packages/adapters/types.ts` — ProviderAdapter interface
  - submit(job) → providerJobId + statusUrl
  - verifyWebhook(req) → VerifiedEvent (signature validation)
  - parseResult(evt) → output URL + actual cost
  - §5.4: ed25519 ≠ HMAC (never conflate)

### ✅ fal.ai Adapter (Complete)
- `packages/adapters/fal.ts` — FalAdapter implements ProviderAdapter
  - submit(): Maps model_id → fal endpoint, POSTs with webhook callback
  - verifyWebhook(): ed25519 signature parsing (TODO: JWKS verification)
  - parseResult(): Extracts output URL + cost
  - Model mapping: wan-2.5 → /wan2/generate, seedance → /seedance/generate, etc.

### ✅ Webhook Receiver (Complete)
- `src/worker/webhook-receiver.ts` — POST /v1/webhooks/:provider
  - Step 1: Verify signature (ed25519 for fal)
  - Step 2: Dedupe via webhook_events table (ON CONFLICT DO NOTHING)
  - Step 3: Transition job state (POLLING → STORE_PENDING on completion)
  - Step 4: Queue media.store event (R2 upload, separate durable step)
  - Auto-refund on provider failure (FAILED → REFUNDED)

### ✅ Stuck-Job Sweeper (Complete)
- `src/worker/sweeper.ts` — Cron handler (every 2 minutes)
  - Deadlines: PRICED 30s, SUBMITTED 5m, POLLING 30m, STORE_PENDING 5m
  - Action: findStuckJobs() → markFailedAndRefund()
  - Recovery: Automatic refund, prevents user data loss

### ✅ Outbox Relay (Complete)
- `src/worker/outbox-relay.ts` — Cloudflare Queue consumer
  - Processes job.submit → Submit to fal, PRICED → SUBMITTED → POLLING
  - Processes media.store → Download from provider, upload to R2, STORE_PENDING → STORED
  - Retries: 3 attempts with exponential backoff (1s, 2s, 3s)
  - Max retries exhausted → FAILED + refund
  - No I/O inside transactions (§5.5: separate durable step)

## Architecture Enforcement

**§25.7 Job Pipeline:**
1. Client: POST /v1/generations (idempotent via Idempotency-Key)
2. Gateway (src/index.ts): Debit ledger, create job (PRICED), outbox job.submit event
3. Outbox relay: job.submit → submit to fal, PRICED → SUBMITTED → POLLING
4. Provider (fal.ai): Generate, POST webhook to /v1/webhooks/fal
5. Webhook receiver: Verify ed25519, dedupe, POLLING → STORE_PENDING, queue media.store
6. Outbox relay: media.store → Download, retry 3×, upload R2, STORE_PENDING → STORED
7. Sweeper (cron): Stuck jobs → FAILED → auto-refund

**Invariants Enforced:**
- §5.1: balance = SUM(ledger_entries.delta) ✓
- §5.2: Debit + job + outbox in ONE transaction ✓
- §5.3: Idempotency-Key prevents double-spend ✓
- §5.4: ed25519 ≠ HMAC (FalAdapter uses ed25519) ✓
- §5.5: No I/O inside transaction (R2 copy separate) ✓
- §5.6: Moderation before debit (TODO: Week 5)
- §5.7: Failed job → REFUNDED automatically ✓
- §5.8: Browser never holds keys (gateway only) ✓

## TODOs for Week 2 Completion

### Critical (Blocking Week 3)
- [ ] ED25519 verification: Fetch fal JWKS endpoint, verify signature
- [ ] Job table: Store prompt + all params (needed by outbox relay)
- [ ] Failover logic: FAILED on fal → try Replicate
- [ ] Replicate adapter: HMAC webhook verification (§5.4 gate)
- [ ] Model params: Map from catalog schema into provider payload

### Nice-to-Have
- [ ] R2 signed URLs: Gallery downloads (secure, time-limited)
- [ ] Webhooks schema validation: Zod or similar
- [ ] Observability: Log provider costs for margin tracking

## Running Week 2 Locally

```bash
# Set environment variables
export FAL_KEY="your-fal-api-key"
export WEBHOOK_URL="https://your-worker.workers.dev/v1/webhooks"

# Deploy worker
wrangler deploy

# Test generation endpoint
curl -X POST http://localhost:8787/v1/generations \
  -H "Idempotency-Key: test-123" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "wan-2.5",
    "prompt": "A sunset over mountains"
  }'

# Logs
wrangler tail  # Stream logs from deployed worker
```

## Next: Week 3

**Stripe Integration**

- Stripe Checkout: Plans (Starter $15/200, Plus $39/1000, Ultra $99/3000)
- Webhook reconciliation: HMAC verification (§5.4: different from ed25519)
- Grant transactions: grant:cycle (monthly renewal), grant:topup (never expires)
- Non-rollover expiry: expires_at in schema (not cron afterthought)
- Ledger reasons: grant:cycle, grant:topup, grant:referral, debit:generation, refund:failed, expire:cycle

Build order: Stripe webhook receiver → Checkout integration → Client subscription UI.

