# PRD — Veyrnox.ai

**Status:** Current · 2026-10-02 (audited against `main` at `2da81dc`)
**Scope:** the whole product. Feature-level specs live beside it
([face-filters](../face-filters/README.md), [editor](../editor/PRD.md),
[auto-short](../auto-short/SPEC.md), [cinema](../cinema/README.md),
[social-publisher](../social-publisher/)).
**Language:** every term is defined in [CONTEXT.md](../../CONTEXT.md).
**Precedence:** [CLAUDE.md](../../CLAUDE.md) and [docs/adr/](../adr/README.md)
win wherever they disagree.

> **What "shipped" means here.** The repo shows intent; it cannot prove what
> is applied in production. Catalog activations 0121/0127/0155/0162/0166 go
> through the owner-approved `apply-migrations` workflow. Before quoting a
> number externally, check `/api/catalog` and `/api/credit-packs` on
> production.

## 1. What it is

A credit-metered AI generation platform. A user holds one balance of
**Credits** and spends it on image, edit, video, lip-sync, music, sound and
speech models from several providers, behind one interface. Every generation
is priced up front from the catalog, debited before it runs, and refunded
exactly if it fails.

Around that core sit two products that share the account:

- **Veyrnox Publish** — schedule generated media to Instagram, LinkedIn, X,
  TikTok and YouTube.
- **Social Cinema** — creators publish short series; viewers unlock episodes
  with Credits or watch with a Cinema Pass. Built, **off in production**.

The business is the margin between what a Credit sells for and what the
provider charges, held at or above the ADR-0014 floor on every catalog row.

## 2. Who it is for

| user | wants | we give |
|---|---|---|
| Creator (primary) | several frontier models without an account at each vendor | one balance, exact price before submit, failed runs cost nothing |
| Social poster | generated clips on their channels on a schedule | Publish: connect accounts, compose, schedule |
| Cinema creator *(not launched)* | an audience and revenue for short series | upload, review, catalogue, paywall |
| Viewer *(not launched)* | binge short episodes | free episodes, 6-credit unlocks, Cinema Pass |

All are cost-sensitive. The price is the product's promise: "The price is on
the button."

## 3. Shipped (production)

### 3.1 Accounts
- Sign-in: email + password, magic link, **Google**, **Apple** (ADR-0030).
  Google/Apple buttons appear only when enabled in Supabase settings.
- Passkey sign-in button appears when Supabase reports passkeys enabled;
  there is **no enrolment UI** yet (ADR-0032, Proposed).
- **Confirm email is on.** The account is usable only after confirmation;
  **10 Free Credits** land at that moment (0071, 0127), expire after 90 days
  (ADR-0013), and are spent first.
- **Turnstile** on password, sign-up, magic link and passkey attempts
  (ADR-0026). OAuth is not challenged.
- Leaked passwords refused (HaveIBeenPwned); the form warns before the first
  attempt.
- `/app/account`: TOTP 2FA for every user, password change by emailed code,
  sign out other devices / everywhere, data export and deletion by email
  request.
- Admin: Cloudflare Access + `aal2`; Cinema admin additionally needs MFA
  within 5 minutes.

### 3.2 Generating
- **Studio** (`/app/create`): pick a model, prompt, optional uploads, see the
  cost in Credits, submit, poll to completion, result plays inline. 10 s video
  costs twice the 5 s unit. Default model `wan-2.5-kie`.
- **Explore** (`/app`) and **Presets** (`/presets`): curated starting points
  that open the Studio pre-filled.
- **Landing slip**: the hero `PriceSlip` prices a prompt live and hands it to
  the Studio.
- **Uploads**: presigned R2 PUT, 20 MB (100 MB video), require an Acceptable
  Use attestation (0146, `/legal/aup`).
- **Library** (`/app/library`): every past generation, 90-day asset retention
  notice.
- **Provenance**: `/api/v1/jobs/:id/provenance` returns how an asset was made
  and a SHA-256 of the stored bytes (ADR-0025 option E). No C2PA claim.

### 3.3 Catalog — 32 active rows (repo intent)

| kind | models |
|---|---|
| text-to-image | Nano Banana, Nano Banana Pro, Flux.2 [pro], Flux.2 Pro 1K, Seedream v4, Sana v1.5 |
| image edit | Nano Banana Pro Edit (×2 lanes), Bria Background Removal, Bria Expand, Topaz Upscale 2× |
| text-to-video | Veo 3.1 Fast, Veo 3.1 Lite, Wan 2.5, Kling 2.6 Pro, MiniMax Hailuo 02, Seedance 2.0 Fast; Veo 3.1 listed but **gated** (402) |
| image-to-video | Kling 3.0 (×2 lanes), Kling AI Avatar v2 |
| video-to-video | LatentSync lip sync |
| audio | ACE-Step, ACE-Step 1.5, MMAudio v2, ElevenLabs Sound Effects v2 |
| speech | Inworld TTS, ElevenLabs TTS Turbo 2.5, MiniMax Speech 2.6 HD, ElevenLabs Dialogue v3 |
| composite (flag-gated preview) | Auto Short 32 s (110 cr), Clip Editor (1 cr/s) |

Prices live in `model_catalog.credits_5s`; the app never computes a price.
Providers: fal.ai, kie.ai, OpenRouter, GrsAI (active), BytePlus (staged), plus
the internal `veyrnox` composite. **The provider is never shown to the user.**

### 3.4 Paying
- **Credit Packs** via **Stripe Checkout**, Stripe Managed Payments as
  Merchant of Record, automatic tax (ADR-0031): **100 for $10, 270 for $19,
  1,200 for $59, 3,000 for $129**, plus tax (0121, ADR-0037). Purchased
  Credits never expire. Supply-consent checkbox before purchase.
- Lost-webhook recovery: return URL + 5-minute backfill (ADR-0033).
- **Refunds**: any failed generation refunds its exact debit to the source it
  came from. A refunded or disputed purchase claws back and may **Freeze**
  the account (ADR-0018/0019); only an operator unfreezes.
- **Credit statement** on `/app/credits` (ADR-0045).

### 3.5 Veyrnox Publish (`/app/publish`) — built, off in production
- Connect Instagram, LinkedIn, X, TikTok, YouTube (OAuth, tokens encrypted).
- Compose one Library asset + text + accounts + time; cron publishes.
  TikTok lands as a draft in the creator's inbox.
- **Off in production.** `PUBLISH_ENABLED` hides the page, the menu link and
  `/api/v1/social/*` until the app reviews (Meta, TikTok, YouTube) and the
  Publish Plan land; it is on in staging. The cron sweep is not gated.
- **Free tier enforced:** one connected account per user (ADR-0063, 0169).
  Reconnecting that account is allowed; disconnecting frees the slot.

### 3.6 Admin
Metrics (`/app/admin`), user lookup and content violations (3rd takedown
Freezes), Cinema creator and submission review.

## 4. Built, not live

| feature | where it stands | gate |
|---|---|---|
| Social Cinema: profiles, creator applications, drafts, Stream uploads, review, catalogue, player | staging-verified 2026-09-28/29 | `CINEMA_*` flags off in prod; PR #369 is the activation |
| Cinema paywall: 5 free episodes, 6-credit unlocks, Cinema Pass weekly $14.99 (intro $11.99) / monthly $49.99 / yearly $199.99, 3,000-minute ceiling, 14-day cooling-off | built (0142–0144) | `CINEMA_SUBSCRIPTIONS_ENABLED` unset even on staging |
| Projects: workspaces, versioned project document, autosave, history, media quarantine | staging | `TENANT_PROJECTS_ENABLED` + `localStorage.veyrnox_projects` |
| Auto Short | catalog row active | `localStorage.veyrnox_auto_short` |
| Clip Editor | catalog row active | `localStorage.veyrnox_editor` |
| BytePlus Seedance (5 rows) | staged inactive, US blocked before debit | ADR-0058 Proposed |
| Jev provider-error classifier | built | `JEV_SUBMIT_ERRORS_MODE=off` |

## 5. Decided, not built

| feature | decision | blocker |
|---|---|---|
| **Core subscriptions** Starter $19/270, Plus $59/1,200, Ultra $129/3,000 monthly | ADR-0064 Accepted | ledger spend-order buckets, non-rollover expiry job, tax/consent wording |
| **Publish Plan** Free 1 account; $19/mo for 5 + $4/extra | ADR-0062/0063 Accepted | plan table, caps, Stripe product |
| Face Filters Transform (Slices 5–9) | upload spine shipped | fal cost data + CSAM hash matching |
| Passkey enrolment | code exists, no UI | ADR-0032 acceptance |

## 6. Deliberately not built

| not built | why |
|---|---|
| Auto-refill | not on the roadmap |
| C2PA signing claims | withdrawn until real (ADR-0017) |
| Media authenticity verdicts | no named customer (ADR-0025) |
| Voice cloning | off by policy |
| Real-time / live filters | every model is queued and completed asynchronously |
| Any wallet, crypto or on-chain feature | separate company; enforced hard wall |
| LemonSqueezy | refused us (2026-09-22); replaced by Stripe |

## 7. Launch blockers

Public text-to-media launch (#204, #101):
1. Stripe live evidence: real purchase + refund, dispute/freeze drills,
   lost-webhook drill, 24 h clean reconciliation.
2. Cloudflare email quota raised (2,000/day requested 2026-09-21) or a
   bounded launch plan.
3. HaveIBeenPwned protection verified on production.
4. Production admin AAL2 journey and recovery-health alert delivery verified.
5. DMCA designated agent filed (ADR-0005).

Any public **upload** surface (Face Filters, Cinema creators, project media):
CSAM hash matching chosen and live (ADR-0025 §8.1).

Cinema: rights/age/territory policy, creator agreement, cooling-off wording,
Stripe acceptance for recurring video subscriptions, Stream webhook repointed
from staging to production.

Publish: platform app reviews, TikTok DNS verification, PR #399 (YouTube
upload fix), token-key rotation runbook.

## 8. How we know it works

- `reconcile_balances()`, `reconcile_free_credits()`, `reconcile_top_ups()`
  return zero rows — every 15 min snapshot, hourly watch, and after every
  money-spine change.
- Every active catalog row returned real output from its live endpoint
  before activation (ADR-0011); catalog UPDATE migrations assert row counts.
- Every debit path has a tested refund path; every state-changing RPC has an
  idempotency test.
- `npm run check:signup-gate` reports the gate closed (hourly workflow).

## 9. Open questions

1. Does Publish ship to the public before its plan exists, or behind a flag?
2. Subscription Credits spend order and expiry (ADR-0064) — confirm before
   ledger work starts.
3. Which CSAM hash-matching service?
4. Does Track B (media authenticity) have a named customer (ADR-0025 §9.1)?
