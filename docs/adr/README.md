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
| [ADR-0030 — Sign in with Apple as a first-time onboarding provider](0030-sign-in-with-apple.md) | Proposed 2026-09-22 | `AuthGate` has shipped a "Continue with Apple" button all along, gated on `external.apple`, which the live project reports as `false` — the block is console config, not code. Apple is a sign-up provider on the same footing as Google, through the same triggers and the same grant; the Services ID registers the *Supabase* host, so no CSP or `public/` change; the button stays hidden until the provider is really on. The OAuth client secret expires every six months and no probe here can catch a missed rotation. | ADR-0026 |

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
