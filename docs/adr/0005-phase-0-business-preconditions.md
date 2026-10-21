# ADR-0005 — Phase-0 business preconditions resolved

- **Status**: Accepted (2026-09-10)
- **Deciders**: Product owner
- **Blocks**: (none — this unblocks Phase 1 slice 3 vendor onboarding)
- **Related**: ADR-0000 (open questions), ADR-0003, ADR-0004, docs/PHASE-1.md

## Context

ADR-0000 (product strategy) surfaced six business preconditions that had to be resolved before engineering could onboard vendors for Phase 1. Recording them here as a single ADR rather than six one-liners — they are all "settings" of the same weight, and grouping keeps the ADR series readable.

## The six resolutions

### 1. Legal entity — **UK Limited company**

Signs every vendor contract (Clerk / Neon / LemonSqueezy / Cloudflare). Corporation-tax jurisdiction; VAT registration required when annual UK turnover crosses £90k.

### 2. Product-owner tax residency — **United Kingdom**

LemonSqueezy and Paddle both onboard UK entities. Stripe UK is standard. VAT (UK 20%) plus MoR-handled VAT on EU sales via LemonSqueezy — no separate EU registration needed at launch.

### 3. Data residency — **EU-only for user data**

Users' data (`users`, `credit_balances`, `ledger_entries`, `jobs`, `assets`, PII) must sit in the EU. Drives:

- Neon region: **Frankfurt** (`eu-central-1`).
- Auth provider: **needs re-evaluation** — Clerk's data-residency add-on is enterprise-tier only (≈$100/mo starting). Supabase Auth allows EU region on the standard $25/mo Pro tier. See ADR-0007 (follow-up) which amends ADR-0004 accordingly.
- Media store: R2 EU jurisdiction (bucket configured with `location_hint = "weur"`).

### 4. Free-tier credit allocation — **50 credits/month**

Not on the xlsx Assumptions sheet — filled in here. ~2 videos or ~12 images per month. Conversion-oriented: enough to prove the product works, tight enough to drive upgrades. Real cost exposure per free user ≤ $1/month at LAUNCH-model prices. Trivial one-line change to raise if activation lags.

### 5. EU AI Act (Article 50) transparency — **Watermark + metadata + ToS notice**

Standard responsible-AI approach:

- **C2PA content credentials** embedded in every image/video/audio output at the media-pipeline layer (Slice 7 hook).
- **UI badge** — a small "AI-generated" chip on every gallery item and download.
- **ToS disclosure** — Article 50 wording added to Terms of Service before the first paying user.

Meets Article 50's "machine-readable marking that persists through download". Implementation is a Phase-4 deliverable; the ToS text is written now (see §10 below).

### 6. DMCA designated agent — **Registered-agent / virtual-mailbox service (US)**

The UK product owner registers a DMCA designated agent via a virtual-mailbox / registered-agent service holding a US address, then files with the US Copyright Office ($6 registration, $6 renewal every 3 years). Direct personal registration is rejected because the owner's home address would appear in the public directory. Budget: $100–300/year for the mailbox service.

Filed before public launch; safe-harbor protection is null without it.

## Consequences

| Precondition | Downstream effect |
|---|---|
| UK Ltd | Vendor contracts and invoices settled |
| UK tax residency | LemonSqueezy MoR onboarding paperwork proceeds; UK VAT handling clear |
| EU data residency | Neon Frankfurt region + auth-provider reconsideration → follow-up ADR-0007 |
| 50-credit free tier | model_catalog seed is correct; grant handler emits 50-credit `grant:signup` on Clerk `user.created` |
| Article 50 approach | C2PA library added to Phase-4 task list; ToS wording drafted this ADR |
| DMCA agent | Owner starts the registered-agent process out-of-band; agent live before Phase-5 public launch |

## ToS wording (Article 50 disclosure — draft)

To be added to Veyrnox Terms of Service before the first paying user:

> **AI-Generated Content Notice.** Every image, video, and audio file generated through Veyrnox is produced by a third-party AI model routed on your behalf. Under Article 50 of the EU AI Act, we mark each output as AI-generated using C2PA content credentials embedded in the file and a visible "AI-generated" badge in the interface. This marking is machine-readable and survives download; do not remove it if you republish the content elsewhere. You are responsible for compliance with local laws when publishing AI-generated content.

Legal counsel should review before enforcement; this is a starting point.

## Follow-up

- ADR-0007 (planned): amend ADR-0004 auth+DB bundle recommendation given EU data residency (Clerk EU-tier cost changes the math).
- PHASE-1.md: check off all six preconditions.
- Phase 4: schedule C2PA content-credentials integration.
- Out-of-tree: start the DMCA registered-agent onboarding process.

## Open questions still

- **Company number**: the UK Ltd registration itself is out-of-tree; when incorporated, add company number + registered address to vendor sign-ups.
- **VAT number**: only relevant once UK turnover >£90k. Not blocking Phase 1.
- **Legal counsel review of ToS**: recommended before Phase-4 launch; not blocking Phase 1 code.
