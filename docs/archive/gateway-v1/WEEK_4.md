# Week 4 — Adapter Batch 1 + Replicate Failover + Margin Validation

**Status:** Skeleton complete. Multi-provider failover + pricing safeguards in place. TODOs remain for provider rate fetching and alert integration.

## Deliverables

### ✅ Replicate Adapter (Complete)
- `packages/adapters/replicate.ts` — ReplicateAdapter class
  - verifyWebhook(): HMAC-SHA256 signature verification (§5.4: never ed25519)
  - submit(): Submit to Replicate API with webhook callback
  - parseResult(): Extract output URL + cost from Replicate response
  - Model mapping: Fallback versions for fal.ai models
  - Constant-time signature comparison (prevent timing attacks)

### ✅ Margin Floor Validator (Complete)
- `packages/db/margin-validator.ts` — MarginValidator class
  - validate(): Check actual_cost × (1 + margin_floor) ≤ catalog_price
  - validateBatch(): Bulk validation across all models
  - Calculates achieved margin % (for revenue tracking)
  - §5.10 Invariant: DPA gate + margin floor enforcement
  - Catches pricing errors & provider cost changes

### ✅ Failover Manager (Complete)
- `packages/db/failover.ts` — FailoverManager class
  - handleFalSubmitFailure(): SUBMITTED → FAILOVER (queue job.failover event)
  - handleReplicateSubmitFailure(): Both failed → FAILED → auto-REFUNDED
  - Idempotent: Failover is a state, no infinite retries
  - Preserves error context for debugging

### ✅ Failover Handler (Complete)
- `src/worker/failover-handler.ts` — Outbox consumer
  - Processes job.failover events (when fal.ai submission fails)
  - Submits to Replicate as secondary provider
  - On Replicate success: FAILOVER → SUBMITTED → POLLING
  - On Replicate failure: auto-refund (FailoverManager.handleReplicateSubmitFailure)

### ✅ Price-Drift Sentinel (Complete)
- `src/worker/price-drift-sentinel.ts` — Cron handler (daily 6 AM UTC)
  - Fetch current fal.ai + Replicate rates (TODO: APIs)
  - Compare against catalog margin floors
  - Alert on breach: margin below floor = revenue loss
  - Architecture §16.9 backstop (prevent silent margin erosion)

## State Machine (Updated for Failover)

```
PRICED
  ↓
SUBMITTED (fal.ai)
  ├─→ POLLING → STORE_PENDING → STORED ✓
  └─→ [ERROR] → FAILOVER
           ↓
        SUBMITTED (Replicate)
           ├─→ POLLING → STORE_PENDING → STORED ✓
           └─→ [ERROR] → FAILED → REFUNDED 🔄
```

**Idempotency:** Failover is a state, not an action. Job can fail fal → succeed Replicate or fail both → auto-refund. No infinite retries.

## Provider Ecosystem (Batch 1)

**fal.ai (Primary):**
- Wan 2.5 (15 credits) — Week 2, ready
- Seedance 2.0 Fast (5 credits) — Week 4
- Kling 2.6 Pro (23 credits) — Week 4
- Flux.2 [pro] (3 credits) — Week 4
- Seedream 4.5 (3 credits) — Week 4

**Replicate (Failover):**
- Seedance 1.0 Lite (8 credits) — Cheaper alternative
- Kling 2.6 Pro (23 credits) — Backup
- Generic SD3 — Fallback for any model

**Margin Floors (§5.10):**
- fal.ai: 50% minimum markup
- Replicate: 45% minimum markup
- All models require signed DPA before adding to live service

## Architecture Enforcement

**§5 + §16 Gates:**
- §5.1: balance = SUM(delta) ✓
- §5.4: ed25519 (fal) ≠ HMAC (Replicate) ✓
- §5.10: DPA gate + margin_floor enforced ✓
- §16.9: Price-drift sentinel (daily cron) ✓

**Failover Flow:**
1. Client: POST /v1/generations
2. Gateway: Debit ledger, create job (PRICED)
3. Outbox relay: job.submit → submit to fal
4. fal.ai: Process → succeed or fail
5. **[fal fails]** → transition FAILED → FAILOVER → queue job.failover
6. Failover handler: Submit to Replicate
7. Replicate: Process → succeed (STORED) or fail (auto-REFUNDED)

## TODOs for Week 4 Completion

### Critical (Blocking Week 5)
- [ ] Expand fal adapter: Add endpoints for Seedance, Kling, Flux, Seedream models
- [ ] Expand Replicate adapter: All failover model version URIs
- [ ] Provider rate fetching: APIs to fetch current fal.ai + Replicate pricing
- [ ] Margin floor CI check: Validate catalog prices at build/deploy time
- [ ] Alert integration: Slack/Sentry on price-drift breach (currently logs only)

### Nice-to-Have
- [ ] Dynamic failover: Per-model failover rules (some models primary on Replicate)
- [ ] Cost tracking: Log actual_cost from each provider (for margin validation)
- [ ] Failover metrics: Track fal vs Replicate success rates (for provider eval)

## Running Week 4 Locally

```bash
# Set Replicate environment variables
export REPLICATE_KEY="your-replicate-api-token"
export REPLICATE_WEBHOOK_SECRET="your-webhook-secret"

# Deploy worker
wrangler deploy

# Test failover (manual):
# 1. Submit job to fal (succeeds or fails)
# 2. If fails, check job state: should be FAILOVER
# 3. Wait for failover handler to submit to Replicate
# 4. Check final state: STORED (success) or REFUNDED (both failed)

# View logs
wrangler tail --format json | jq '.stdout' | grep -i failover
```

## Next: Weeks 5-8

**Surface (UI Integration + Moderation)**

- UI: Rewire studio components to POST /v1/generations
- Presets: Model + params templates (curated 15-20 presets)
- Gallery: Library backed by R2 signed URLs
- Moderation: DeepSeek classifier (pre-debit, reject = free)
- Premium gating: Veo 3.1 (125cr) only for Plus/Ultra users
- Daily cap: Per-user generation limits

Build order: Moderation pipeline → Replicate completeness → Presets → UI integration.

