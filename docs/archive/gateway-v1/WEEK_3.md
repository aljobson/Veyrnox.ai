# Week 3 — Stripe Integration & Grant Management

**Status:** Skeleton complete. Payment processing + billing system in place. TODOs remain for Clerk auth, webhook setup, referral system.

## Deliverables

### ✅ Stripe Adapter (Complete)
- `packages/adapters/stripe.ts` — StripeAdapter class
  - verifyWebhook(): HMAC-SHA256 signature verification (§5.4: never ed25519)
  - createCheckoutSession(): Create payment session for plans
  - Plans: Starter (200cr/$15), Plus (1000cr/$39), Ultra (3000cr/$99)
  - parseEvent(): Extract charge metadata (plan, credits, user_id)
  - Constant-time comparison: Prevent timing attacks on HMAC

### ✅ Grant Manager (Complete)
- `packages/db/grants.ts` — GrantManager class
  - grant(): Atomic credit grant with optional expiry (§25.3 invariant)
  - grantPlanCycle(): Monthly renewal (30-day expiry)
  - grantTopup(): One-time top-up (never expires)
  - expireCredits(): Mark expired grants with compensating -delta entries
  - getActiveBalance(): Sum of non-expired credits (for debit check)
  - **Non-rollover expiry:** expires_at in schema, not cron afterthought

### ✅ Stripe Webhook Receiver (Complete)
- `src/worker/stripe-webhook.ts` — POST /v1/webhooks/stripe
  - Verify HMAC-SHA256 signature (different from fal.ai ed25519)
  - Dedupe via webhook_events table (ON CONFLICT DO NOTHING)
  - charge.succeeded → grantPlanCycle() or grantTopup()
  - charge.failed → Alert (no debit; payment already failed at Stripe)
  - Idempotent: Stripe retries automatically handled

### ✅ Checkout API (Complete)
- `src/worker/checkout.ts` — POST /v1/checkout
  - Body: { plan: 'starter' | 'plus' | 'ultra' }
  - Response: { sessionId, url } (redirect to Stripe Checkout)
  - Auth: Extract user_id from Clerk JWT (TODO: wire up)
  - Validation: Plan exists, user authenticated

### ✅ Grants Expiry Sweeper (Complete)
- `src/worker/grants-expiry-sweeper.ts` — Cron handler (daily 3 AM UTC)
  - Find grants where expires_at < now()
  - Append compensating -delta entries (reason: expire:cycle)
  - Update balances atomically
  - Max 1000 per run (prevents load spike)

## Ledger Reasons (Complete Set)

| Reason | Flow | Expiry |
|--------|------|--------|
| grant:cycle | Stripe payment succeeded | 30 days |
| grant:topup | One-time purchase | Never |
| grant:referral | Invite bonus | 30 days |
| debit:generation | Job debited from balance | N/A |
| refund:failed | Auto-refund on provider failure | N/A |
| expire:cycle | Compensating entry (grant expired) | N/A |

## Architecture Enforcement

**§25 Money Path (Complete):**
- §25.1: balance = SUM(ledger_entries.delta) where delta ≠ 0 ✓
  - Includes all grant types, debits, refunds, expirations
- §25.2: Debit + job + outbox atomic ✓
- §25.3: Grant + balance update atomic ✓
- §25.4: HMAC (Stripe) ≠ ed25519 (fal) ✓
- Non-rollover expiry: expires_at enforced in DDL ✓
- Idempotency: webhook_events dedup ✓

**Grant Flow:**
1. Client: POST /v1/checkout with plan
2. Checkout API: Create Stripe Checkout session
3. Browser: Redirect to Stripe Checkout
4. Stripe: Charge card, POST webhook (charge.succeeded)
5. Webhook receiver: Verify HMAC, dedupe, grant credits
6. Grant manager: Append ledger entry, update balance
7. Expiry sweeper (daily): Mark expired, append compensating entry

## TODOs for Week 3 Completion

### Critical (Blocking Week 4)
- [ ] Clerk JWT auth: Middleware to extract user_id from token
- [ ] Stripe webhook setup: Configure endpoint in Stripe dashboard
- [ ] Test Stripe payments: End-to-end flow with test cards
- [ ] Payment failure handling: Alert on declined/failed charges

### Nice-to-Have
- [ ] Topup Checkout sessions: Support one-time topup purchases
- [ ] Referral system: grant:referral on invite code usage
- [ ] Payment receipts: Email on successful charge
- [ ] Plan management: UI to upgrade/downgrade plans

## Running Week 3 Locally

```bash
# Set Stripe environment variables
export STRIPE_SECRET_KEY="sk_test_..."
export STRIPE_WEBHOOK_SECRET="whsec_..."

# Deploy worker
wrangler deploy

# Test checkout endpoint
curl -X POST http://localhost:8787/v1/checkout \
  -H "Content-Type: application/json" \
  -d '{ "plan": "starter" }'

# Expected response:
# { "sessionId": "cs_test_...", "url": "https://checkout.stripe.com/..." }

# Test Stripe webhook (use Stripe CLI locally)
stripe listen --forward-to localhost:8787/v1/webhooks/stripe
stripe trigger charge.succeeded
```

## Next: Week 4

**Adapter Batch 1 + Failover**

Build remaining adapters:
- Seedance 2.0 Fast (fal.ai endpoint)
- Kling 2.6 Pro (fal.ai endpoint)
- Flux.2 [pro] (fal.ai endpoint)
- Seedream 4.5 (fal.ai endpoint)

Failover logic:
- Job submission fails → FAILOVER state
- Retry with Replicate as secondary
- Both fail → FAILED → auto-REFUNDED

Model pricing from catalog (platform_model_v2.xlsx):
- All models now have margin_floor (§5.10 gate)
- Update margin engine to check: actual_cost × (1 + margin_floor) ≥ catalog_price

Build order: Define remaining model endpoints → Failover state transitions → Margin floor validation.

