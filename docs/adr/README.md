# Architecture Decision Records

Phase-0 decision-support documents for the target architecture at `/Users/aljobson/Downloads/architecture.md` (external, not committed — sensitive). Each ADR is **Proposed** until the product owner signs off; nothing in Phase 1+ can start until the load-bearing ADRs are Accepted.

## Index

| ADR | Status | Summary | Blocks |
|-----|--------|---------|--------|
| [ADR-0000 — Product strategy: Replacer vs Reseller](0000-product-strategy.md) | **Accepted 2026-09-10 — Option A (Replacer)** | The meta-decision. Product owner picked full-stack rebuild over MuAPI reseller. Timeline 20-24 wk to first paying customer. | — |
| [ADR-0001 — Authentication provider](0001-auth-provider.md) | Superseded by 0004 | Original single-vendor auth ADR. Circular with 0002. | — |
| [ADR-0002 — Postgres host & serverless driver](0002-postgres-host.md) | Superseded by 0004 | Original single-vendor DB ADR. Circular with 0001. | — |
| [ADR-0003 — Billing / merchant-of-record](0003-billing-provider.md) | **Accepted 2026-09-10 — LemonSqueezy at launch** | Migrate to Stripe Direct at ~$20k MRR sustained 3 months. | — |
| [ADR-0004 — Auth + Postgres bundle](0004-auth-and-db-bundle.md) | Amended by 0006 | Original: Clerk + Neon. Superseded by 0006 on EU-residency grounds. | — |
| [ADR-0005 — Phase-0 business preconditions](0005-phase-0-business-preconditions.md) | **Accepted 2026-09-10** | UK Ltd, UK tax, EU-only data, 50-credit free tier, C2PA+ToS Article 50, registered-agent DMCA. | (unblocks Phase 1 Slice 3) |
| [ADR-0006 — Auth + DB amendment for EU residency](0006-auth-and-db-amendment-eu-residency.md) | **Accepted 2026-09-10 — Supabase Auth + Supabase Postgres (Frankfurt)** | Clerk EU-tier at ~$250–400/mo forced re-evaluation; Supabase EU on $25/mo Pro. MFA becomes a Phase-4 deliverable. | Slice 3+ |
| [ADR-0018 — Credit Pack Top-ups before Subscriptions](0018-credit-pack-top-ups.md) | **Accepted 2026-09-13** (pending LemonSqueezy eligibility; wording approved #99) | Web Credit Packs 100/$10 · 300/$25 · 1,000/$75 via LemonSqueezy; net ≥ $0.033 and ≥ $0.075/credit floors; refunds claw back pro-rata; inferred chargebacks Freeze. Subscriptions next. | Top-ups slice |
| [ADR-0019 — Dispute webhooks Freeze the account](0019-dispute-webhooks-freeze.md) | **Accepted 2026-09-13** | Amends ADR-0018 decision 8: LemonSqueezy `dispute_created` Freezes the owning user (order re-fetched, payload user never trusted); `dispute_resolved` is logged only, Operator unfreezes; refund-after-spend inference stays as backstop. | #97 |
| [ADR-0021 — Generated media moves to the EU-jurisdiction R2 bucket](0021-media-in-eu-jurisdiction-r2.md) | **Accepted 2026-09-13** (cut over 2026-09-13; runbook complete) | `R2_JURISDICTION=eu` selects the EU S3 endpoint. Production's media is in `veyrnox-staging-media`; cutover copies live assets to the new EU `veyrnox-ai-media` and sets `R2_BUCKET` and `R2_JURISDICTION` together. Meets ADR-0005 §3 for media. | — |
| [ADR-0022 — Manual credit grant for provider live tests](0022-manual-test-credit-grant.md) | **Accepted 2026-09-13** | 100 paid-equivalent credits to the test account via `ledger_grant`, reason "grant:manual Al Jobson testing", for provider live tests (Seedance on OpenRouter). | — |
| [ADR-0023 — Production migrations are applied by one workflow](0023-migrations-applied-by-workflow.md) | Proposed 2026-09-13 (effective once the `production-database` environment and token are set) | `apply-migrations` applies main's unapplied files one at a time behind the owner's environment approval, byte for byte with an idempotency key, re-reading the ledger per file; MCP `apply_migration` on production only in an owner-authorised emergency. | — |
| [ADR-0024 — Manual credit grants for the concierge sprint test](0024-concierge-sprint-credit-grant.md) | **Accepted 2026-09-13** | Founder-owned account gets 500 credits for a practice sprint, then 500 per paid sprint invoice, via `ledger_grant` with per-invoice reasons; 3,500 ceiling. A Top-up can't be used while production LemonSqueezy is in test mode (#101). | — |
| [ADR-0025 — Media authenticity: provider, or no product](0025-media-authenticity-provider.md) | Proposed 2026-09-18 (revised; **legal section incomplete**) | Four detection vendors are self-serve and cheap, so the barrier is not cost — it is that no commercial detector reaches 90% in independent tests, 13.3% of genuine press photos get called AI-generated, and the errors fall 1.5-3x harder on women and darker-skinned faces. Veyrnox is the generator, so `jobs` already gives exact provenance for our own assets; detection only concerns third-party uploads. Recommends publishing our own provenance, C2PA+IPTC reading second, a vendor only for a named customer and never as an unqualified verdict. | Track B of the face-filters PRD |
| [ADR-0026 — Turnstile CAPTCHA on sign-up and sign-in](0026-turnstile-captcha-on-auth.md) | **Accepted 2026-09-21** | With the signup faucet closed, the remaining risk is volume: looped `/signup` calls burn the 200/day Email Sending quota and sending reputation. Supabase CAPTCHA via Cloudflare Turnstile; CSP widened by `challenges.cloudflare.com` in script-src and frame-src only; the public site key is the switch, so every rollout step is safe on its own. Never empty the site key while dashboard CAPTCHA is on. | — |
| [ADR-0027 — The gateway builds provider requests from a capability registry](0027-model-capability-registry.md) | **Accepted 2026-09-22** | Pricing leaks (Wan 1080p at a loss, Kling audio, Hailuo 6s) came from forwarding any parameter no table mentioned. One record per endpoint in `lib/modelCapabilities.js` now decides inputs, lengths and pins; no record means 501 before the debit; undeclared keys are dropped from the check, price, `jobs.inputs` and the provider request; `/api/catalog` publishes `capabilities` without provider field names. | Registry spec |
| [ADR-0028 — The browser uploads start images straight to R2](0028-browser-upload-to-r2.md) | **Accepted 2026-09-22**, amended 2026-09-22 (sizes, lengths, audio, two uploads) | Image-input models were live but unusable: no client called `/api/v1/uploads`, `connect-src` blocked R2 and the bucket had no CORS. Direct PUT on the gateway-signed URL (no Worker proxy); `connect-src` widened by our own R2 endpoint only; bucket CORS `https://veyrnox.ai`, PUT, Content-Type; the create page shows the picker from `capabilities.media`. | ADR-0027 |
| [ADR-0029 — Auto Short: one priced job that orchestrates several provider calls](0029-auto-short-composite-jobs.md) | **Accepted 2026-09-22** | A "topic in, finished short out" product (modelled on MoneyPrinterTurbo, MIT) needs several provider calls sold as one purchase. Rebuild on our stack rather than host the Python app; one catalog row and one debit; a parent `jobs` row plus a service-role `job_steps` table advanced by the existing signed webhooks and sweep; all-or-nothing refund; AI clips only in v1; the fal ffmpeg stitch step must be verified first. Blocked for launch on a billing provider. | Auto Short spec, ADR-0027 |
| [ADR-0030 — Sign in with Apple as a first-time onboarding provider](0030-sign-in-with-apple.md) | **Accepted 2026-09-22**, live 2026-09-23 | `AuthGate` had shipped a "Continue with Apple" button all along, gated on `external.apple`, which the live project reported as `false` — the block was console config, not code. Apple is a sign-up provider on the same footing as Google, through the same triggers and the same grant. Configured on team `R54268MWFV`: App ID `ai.veyrnox.app`, Services ID `ai.veyrnox.web`, key `LP7U6TPVNV`, registered against the *Supabase* host so no CSP or `public/` change. A separate App ID from the wallet's `com.veyrnox.app`, on the hard wall. The OAuth client secret expires **2027-03-24** and no probe here can catch a missed rotation. | ADR-0026 |
| [ADR-0031 — Stripe replaces LemonSqueezy as the payment provider](0031-stripe-replaces-lemonsqueezy.md) | **Accepted 2026-09-23 — amended 2026-09-23** | LemonSqueezy refused the account on 2026-09-22 — AI media generation is a category exclusion, not an appeal we can win — which blocks #169/#172. Shortlist was Stripe / Dodo / Creem; Stripe wins on category acceptance and docs. **Amendment 2026-09-23: Managed Payments is approved and enabled on both accounts, so Stripe, Inc. is the Merchant of Record, VAT/sales tax are Stripe's not ours, and automatic tax is mandatory — it is ON unless a caller explicitly disables it.** Checkout Sessions priced inline from the catalog; the ±5 min signature window fixes ADR-0018's unbounded replay; `top_ups.order_id` now holds the PaymentIntent id and `variant_id` is unused. Supersedes the provider choice in ADR-0003 and ADR-0018 §provider, keeps their credit/refund/dispute rules. **A migration to accept `pi_…` order ids is still required before any payment can be credited.** | #169, #172 |
| [ADR-0032 — Passkeys, hand-rolled against the GoTrue REST API](0032-passkeys.md) | Proposed 2026-09-23 | A passkey binds to the account, so Google and Apple users can enrol one and then sign in with it alone. `@supabase/supabase-js` is the documented path and is banned from the SSR graph, so the two-step REST endpoints are called with plain fetch — no new dependency. RP ID `veyrnox.ai` is effectively permanent. The hard wall banned the bare word `passkey`; that one entry was narrowed away (the wallet phrase still trips `wallet`). Upstream calls the feature experimental, and the verify request bodies are inferred until the project setting is on. | ADR-0030 |
| [ADR-0033 — Recovering a paid Top-up when the Stripe webhook never lands](0033-stripe-top-up-recovery.md) | Proposed 2026-09-24 | ADR-0031 §Consequences deferred the return-URL backfill; the round-3 audit (finding 08) found it is worse than "two guards need widening" — under Stripe **no part of the recovery runs**, and no reconcile branch covers "money taken, credits not given". `success_url` gains `{CHECKOUT_SESSION_ID}`; the return body becomes `{session_id}` alone, because a `cs_…` is unguessable and `metadata[top_up_sig]` already binds it; the backfill re-fetches the session and credits with `order_id = payment_intent`, keeping ADR-0031 decision 5. A `returned_not_credited` reconcile branch is the alarm — gated on `returned_at` so abandoned carts do not make the cron permanently red. A third guard the audit missed, the `top_ups_return_order_id_format` CHECK, must be replaced too. Stripe's Search API is rejected as primary: its index is eventually consistent. | #169, #172 |

| [ADR-0034 — Generation attempt rate limit](0034-generation-attempt-rate-limit.md) | Proposed 2026-09-24 | Bound pre-debit source work at 20 attempts per account per fixed minute; preserve the ten-job limit and money idempotency. Activates when approved migration 0113 is applied. | Audit finding 06 |
| [ADR-0035 — Upload request rate limit](0035-upload-request-rate-limit.md) | Accepted 2026-09-24 | Bound upload URL issuance to 60 requests per account per minute before R2 work. Migration 0116 applied; activation prepared for deployment. | Audit API rate limits |
| [ADR-0036 — Account read rate limit](0036-account-read-rate-limit.md) | Accepted 2026-09-24 | Shared 120/minute quota for account and balance reads. Migration 0117 applied; activation prepared for deployment. | Audit API rate limits |
| [ADR-0038 — Stripe checkout attempt limit](0038-top-up-checkout-attempt-limit.md) | Accepted 2026-09-24 | Bound checkout requests, including replayed keys, at 20/account/minute before Top-up creation and Stripe. Migration 0120 applied; activation prepared. | Audit API rate limits |
| [ADR-0039 — Admin edge rate limit](0039-admin-edge-rate-limit.md) | Proposed 2026-09-24 | Screen external admin paths before app processing with a Cloudflare rate-limit binding; preserve internal cron recovery. | Audit admin rate limits |
| [ADR-0040 — Top-up read rate limit](0040-top-up-read-rate-limit.md) | Accepted 2026-09-24 | Share an account quota across Top-up history and status, independently of payment recovery. | Audit API rate limits |
| [ADR-0041 — Top-up return rate limit](0041-top-up-return-rate-limit.md) | Accepted 2026-09-24 | Independently bound Stripe return recording and retry temporary denials in memory. | Audit API rate limits |

| [ADR-0037 — Higgsfield credit parity](0037-higgsfield-credit-parity.md) | Prepared 2026-09-24 | Monthly-price equivalent one-off packs with a 50% contribution-margin target; exact generation-credit parity is secondary. | Full parity and production rollout |

| [ADR-0048 — Social Cinema foundation](0048-social-cinema-foundation.md) | Proposed 2026-09-25 | Additive private membership and public profile projections; preserve existing identity and billing. | #320 |
| [ADR-0058 — BytePlus ModelArk as the provider for Seedance video](0058-byteplus-modelark-provider.md) | Proposed 2026-09-26 | Cheapest verified Seedance source once resource packs are used (2.0 Fast $0.35 vs $0.454 on OpenRouter; 2.0 Mini, 2.0, 2.5 and 1.0 Pro Fast newly sellable at the 50% floor). Poll-first adapter, unsigned callback ignored, R2 host verified before activation, pack-exhaustion reconcile check. Gated on BytePlus's four Platform Customer controls, a written answer on the US exclusion, and enterprise verification. | Wholesale survey, byteplus-cost-levers |

## Decision graph

```
ADR-0000 (strategy) ── outcome shapes everything below
   │
   ├── If Reseller/Hybrid → ADR-0004 recommends Clerk + Cloudflare D1
   ├── If Replacer        → ADR-0004 recommends Clerk + Neon
   └── If Status Quo      → no other ADR applies
   │
   └── ADR-0003 (billing) ── independent, needed for any paying-user path
```

## Status lifecycle

`Proposed` → `Accepted` (signed off by product owner) → `Superseded` (only via a follow-up ADR that cites the predecessor). ADRs are append-only after Accepted — never edit in place. Before Accepted, edits are fine; supersession is the honest path once the direction changes.

## Format

Each ADR follows:

1. **Context** — the problem, grounded in specific target-architecture section numbers.
2. **Options considered** — 2–4 real candidates.
3. **Decision drivers** — the criteria that matter, ranked.
4. **Trade-off table** — one row per option, one column per driver.
5. **Recommendation** — engineering's pick and why, in plain terms.
6. **Consequences** — what changes downstream if this option is taken.
7. **Open questions** — anything the recommendation is contingent on.

## Business decision, not engineering

Every ADR here has cost, contract, and vendor-lock-in implications the product owner must weigh. Engineering can execute any of the options; the recommendation is engineering's opinion, not the decision.

## Cross-cutting concerns not yet in any ADR

Flagged for later or standalone treatment:

- **Legal entity** (sole-prop / LLC / Ltd / GmbH) is a precondition to every vendor contract. Ownership decision, not engineering — but every ADR here assumes it exists.
- **Data residency** (GDPR / UK-GDPR / regional laws) drives region and vendor eligibility. Called out in each ADR's open questions; may warrant its own ADR if EU-only data storage is a hard requirement.
- **EU AI Act — Article 50 transparency** applies to AI-generated content regardless of whether Veyrnox holds the model or MuAPI does. Legal input required before Phase 4 moderation work.
- **DMCA / abuse takedown workflow** requires a designated agent and a documented process. Paperwork, not engineering, but blocks public launch.
- **Transactional-layer choice** (Postgres locking vs Durable Object per `user_id` with async persist) may warrant its own ADR-0005 if ledger latency measurements show that Postgres row-locks are the bottleneck under concurrent debit.
| [ADR-0057 — Social Cinema viewer paywall, modelled on ReelShort](0057-cinema-viewer-paywall.md) | **Accepted 2026-09-26** (Phases 1 to 3 built on #344) | First five episodes free; Episode Unlock 6 credits through `ledger_debit`, permanent; Cinema Pass $14.99/wk ($11.99 first week), $49.99/mo, $199.99/yr via Stripe subscription mode, unlimited viewing, never touches the ledger; takedown reverses Unlocks; disputes Freeze. ReelShort's coin prices and unlimited generation are ruled out. Plan in `docs/cinema/paywall-plan.md`. | Publication slice, Stripe acceptance |
| [ADR-0059 — Social Cinema publication: review queue, public catalogue, player](0059-cinema-publication.md) | **Accepted 2026-09-26** | A title is submitted with a versioned Rights Declaration once every video is uploaded; it waits UNDER_REVIEW behind the creator-application gate; approval publishes the whole title, rejection returns it to draft with a note; withdrawal and suspension take it down and reverse its Unlocks. Public catalogue and title reads outside `/api/v1`, cached, identity-free; the player embeds Stream's iframe, the one new CSP frame host. | ADR-0057 launch |
