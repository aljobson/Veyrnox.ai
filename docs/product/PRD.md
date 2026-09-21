# PRD — Veyrnox.ai

**Status:** Current · 2026-09-21
**Scope:** the whole product as shipped. Feature-level specs live beside it
(e.g. [docs/face-filters/](../face-filters/README.md)).
**Language:** every term here is defined in [CONTEXT.md](../../CONTEXT.md).
**Precedence:** [CLAUDE.md](../../CLAUDE.md) and [docs/adr/](../adr/README.md)
win over this document wherever they disagree.

## 1. What it is

A credit-metered AI generation platform. A user holds one balance of
**Credits** and spends it on image, video, music, sound-effect and speech
models from several providers, behind one interface. Every generation is
priced up front from the catalog, debited before it runs, and refunded
automatically if it fails.

The business is the margin between what a Credit sells for and what the
provider charges, held above the ADR-0014 floor on every row.

## 2. Who it is for

Creators who want several frontier models without an account, a plan and a
dashboard at each vendor. They buy Credits once and switch models freely.
They are cost-sensitive — every price is visible before submit — and they
expect a failed generation to cost nothing.

## 3. What is shipped

### Accounts
- Email + password, magic link, and Google sign-in (Supabase Auth).
- **Confirm email is on** — an account is usable only after its inbox
  confirms; the 50 Free Credits land at that moment, not at sign-up (0071).
- **Turnstile CAPTCHA is enforced** on password sign-in, sign-up and magic
  link (ADR-0026). Google sign-in is not challenged.
- **Leaked passwords are refused** (HaveIBeenPwned); the sign-up form warns
  about this before the first attempt.
- Admin second factor via TOTP; the `aal2` gate ships off until enrolled.

### Models — 14 active in the catalog
| kind | models |
|---|---|
| image | Nano Banana, Flux.2 [pro], Seedream v4 |
| video | Veo 3.1, Veo 3.1 Fast, Kling 2.6 Pro, Kling 3.0 (image-to-video), MiniMax Hailuo 02, Seedance 2.0 Fast, Wan 2.5/2.6 |
| audio | ACE-Step, ACE-Step 1.5, ElevenLabs Sound Effects v2 |
| speech | Inworld TTS |

Served through three providers — fal.ai (breadth), kie.ai (price lane:
Nano Banana today, Veo pending #201), OpenRouter (Seedance). The provider is
an internal routing detail and is never shown to the user.

### Generating
- **Studio** (`/app/create`): pick a model, write a prompt, see the cost in
  Credits, submit. Poll to completion; the result plays or displays inline.
- **Library** (`/app/library`): every past generation and its asset.
- **Presets**: curated starting points that open the Studio pre-filled.
- **Provenance**: `/api/v1/jobs/:id/provenance` returns the exact record of
  how an asset was made, and since 0077 a SHA-256 of the stored bytes that a
  holder of the file can check themselves (ADR-0025 option E).

### Paying
- **Credit Packs**: 100 for $10, 300 for $25, 1,000 for $75, plus tax, via
  LemonSqueezy. Credits never expire. No subscription.
- **Free Credits**: 50 on confirmed sign-up, spent first, expiring per
  ADR-0013.
- **Refunds**: any failed generation refunds its exact debit. A refunded or
  disputed purchase claws back and may Freeze the account (ADR-0018/0019).

## 4. Deliberately not built

| not built | why |
|---|---|
| Subscriptions / tiers | removed (#79); one balance, pay as you go |
| C2PA signing claims | withdrawn until real (ADR-0017) |
| Media authenticity verdicts | no defensible product without a named customer (ADR-0025) |
| Any wallet, crypto or on-chain feature | separate company, enforced hard wall (CLAUDE.md) |
| Real-time / live filters | every model is queued and webhook-completed |

## 5. In flight

| work | state |
|---|---|
| Face Filters (Track A) | upload spine shipped; Slice 0 blocked on fal costs; see [face-filters](../face-filters/README.md) |
| Upload safety | CSAM hash-matching required before any public upload UI (ADR-0025 §8.1) |
| Veo on kie | #201, held until a kie job reaches STORED in production |
| Veo 3.1 Lite | #199, catalogued inactive |
| Credit Packs live mode | #172 / #169, merge at launch with live LemonSqueezy ids |

## 6. How we know it works

- `reconcile_balances()`, `reconcile_free_credits()`, `reconcile_top_ups()`
  return zero rows — nightly, and after every money-spine change.
- Every active catalog row has returned real output from its live endpoint
  before activation (ADR-0011).
- Every debit path has a tested refund path.
- The signup gate check (`npm run check:signup-gate`) reports "Gate closed".

## 7. Open questions

1. Veo 3.1 Lite price — 23 Credits proposed in #199; owner's call.
2. Does Track B have a named customer (ADR-0025 §9.1)?
3. The Cloudflare Email Sending quota starts at 200/day — raise before any
   launch that widens sign-up.
