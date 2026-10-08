# PRD — Face Filters & Media Authenticity

**Status:** Draft · 2026-09-18 · status lines updated 2026-10-08 against `main` at `42150476`. The upload spine (§5) is built; no Track A filter is in the catalog; A7/A8 and Track B are blocked.
**Owner:** product owner (Al Jobson)
**Predecessors:** [ADR-0000](../adr/0000-product-strategy.md) (Replacer), [ADR-0005](../adr/0005-phase-0-business-preconditions.md) (Phase-0 preconditions), [ADR-0007](../adr/0007-legacy-muapi-proxy-deprecation.md) (upload proxy retired), [ADR-0008](../adr/0008-asset-retention-policy-and-sweep.md) (retention), [ADR-0017](../adr/0017-c2pa-claims-withdrawn.md) (C2PA claims withdrawn)
**Language:** every term used here is defined in [CONTEXT.md](../../CONTEXT.md). This document adds none.

## 1. Overview

Veyrnox.ai is a credit-metered AI generation platform. Today a user types a prompt
and receives an image, video, or audio file. Every generation is one row in
`model_catalog`, priced in credits, debited through the ledger, and stored in R2.

This document covers two additions, which are **not** one feature:

- **Track A — Face Filters.** The user supplies their own photo or video and a
  model transforms it: retouching, relighting, makeup, style, age, face swap.
  Mechanically these are generations like any other. The novel part is not the
  models — it is that the *input* is a user-supplied file, which Veyrnox cannot
  accept today.
- **Track B — Media Authenticity.** The user supplies a photo, video, or audio
  clip and receives a judgement about whether it was AI-generated or manipulated.
  This is not a generation. It produces a verdict, not an asset, and no current
  provider integration offers it.

Track A is an extension of the existing money spine. Track B is a new product
surface with a new provider, a new data shape, and a different legal posture.
They ship separately. Track B does not start until Track A is live and an ADR
has settled the provider and the liability question.

## 2. Why

Competitors in this category (Higgsfield's Face & Identity modules, Kling) treat
identity-consistent face work as the headline feature, not an accessory. A user
who can only generate from text has to leave the product the moment they want to
put a real person in a shot. Every filter below is a generation that debits
credits, so the feature earns per use on the existing pricing model with no new
billing mechanics.

## 3. Out of scope

- Training per-user LoRA models. Single-reference identity endpoints cover the
  same need without the storage, compute, and deletion obligations of holding a
  trained model of someone's face.
- Real-time / live camera filters. Every model here is asynchronous, queued,
  and webhook-completed, matching the current job pipeline.
- Subscriptions or a new pricing unit. Filters are priced per output from
  `model_catalog.credits_5s` exactly like existing image models.
- C2PA provenance claims. Withdrawn in ADR-0017; nothing here reinstates them.

## 4. Features

### Track A

Each row is one `model_catalog` entry. Endpoints are fal endpoint IDs confirmed
present in fal's public model index on 2026-09-18. **As of 2026-10-08 none is in
`model_catalog`** (no migration through 0227 names one). Slice 0 submitted real
jobs for A1-A5 (and the `fal-ai/retoucher` alternative); the two video relight
endpoints were never run; no price has been measured. Verifying and pricing
happens per [ADR-0011](../adr/0011-model-catalog-gaps.md)'s rule before
`active = true`.

| # | Feature | User value | Candidate endpoint | Identity risk |
|---|---------|-----------|--------------------|---------------|
| A1 | Skin retouch | Remove blemishes and compression artefacts without the "wax museum" blur | `fal-ai/image-editing/retouch`, `fal-ai/retoucher` | none — edits the user's own photo |
| A2 | Face enhancement | Restore facial detail in a soft or low-resolution photo | `fal-ai/image-editing/face-enhancement` | none |
| A3 | Relight (image) | Match subject lighting to a described scene | `fal-ai/iclight-v2` | none |
| A4 | Digital makeup | Apply cosmetics that track the face | `fal-ai/image-apps-v2/makeup-application` | none |
| A5 | Age modify | Age or de-age a subject | `fal-ai/image-apps-v2/age-modify` | low |
| A6 | Relight (video) | Same as A3 across a clip | `fal-ai/id-v2v/relight`, `fal-ai/lightx/relight` | none |
| A7 | Identity reference | Generate a new image that keeps one reference face | `fal-ai/ip-adapter-face-id` | **high** |
| A8 | Face swap | Put a reference face onto another image | `fal-ai/hy-wu-edit` | **high** |

A1–A6 are the launch set. **A7 and A8 do not ship until §6 is satisfied.**

*Status 2026-10-08:* A1-A5 produced real output in Slice 0 (cost unread). A6 not run. A1-A8: no catalog row, nothing active, no Studio surface.

### Track B

| # | Feature | User value | Provider | Status |
|---|---------|-----------|----------|--------|
| B1 | Image authenticity check | Is this photo AI-generated or edited? | none selected | blocked on ADR |
| B2 | Video deepfake check | Is this face in this video swapped? | none selected | blocked on ADR |
| B3 | Voice clone check | Is this audio a synthetic voice? | none selected | blocked on ADR |

*Status 2026-10-08:* [ADR-0025](../adr/0025-media-authenticity-provider.md) is
*Proposed*, revised after research. Its engineering recommendation is E (publish
our own provenance) and D (read provenance), B only for a named customer, never
C; it is not the owner's decision. Nothing is built. The product PRD lists
"media authenticity verdicts" as deliberately not built (no named customer).

fal has no authenticity, detection, or classifier endpoint — searched
`deepfake`, `ai detector`, `classifier` on 2026-09-18, all empty. A new vendor
(Reality Defender, Hive, Sensity or similar) means a new API key, a new webhook
signature scheme, a new contract, and a new line item in the cost model.

## 5. The blocking gap: there is no upload path *(closed in #187, 2026-09-20)*

*Written 2026-09-18. As of 2026-10-08 the path exists:* `POST /api/v1/uploads`
mints a 15-minute presigned PUT under `uploads/{auth_id}/`, the gateway resolves
a `source_key` (ownership and magic-number check) and mints the GET the provider
fetches. The list below is the situation that was solved, kept for the record.

Every Track A feature and every Track B feature needs the user to send Veyrnox a
file. Veyrnox cannot currently receive one.

- `/api/v1/get_upload_url` returns **410 Gone** — retired in ADR-0007 when the
  MuAPI proxy was removed.
- `packages/adapters/r2.js` exposes `putObject`, `presignGetUrl` and
  `copyUrlToR2`. There is no presigned PUT for a browser.
- `copyUrlToR2` gates its source through `isAllowedSourceHost`, which allows
  provider hosts only. It cannot pull a user-supplied URL, by design.
- `/api/v1/generations` already accepts an `image_url` input and validates it as
  an HTTPS URL under 2048 characters — but nothing in the product can produce
  one for a user's own file.

Restoring uploads was the first deliverable, not a sub-task. See the TRD.

## 6. Identity, consent, and abuse — gate on A7/A8

A tool that takes an arbitrary photo of a person and puts their face somewhere
else is the highest-abuse-risk surface this codebase would carry. Under the UK
Online Safety Act 2023 and the offence of creating non-consensual intimate
images, "the user uploaded it" is not a defence for the platform that generated
the output.

A7 and A8 require all of the following before `active = true`:

1. An explicit per-upload attestation that the person depicted has consented,
   recorded against the job — not a one-time terms checkbox.
2. Output moderation on the generated result, not only on the input.
3. A takedown route that reaches a real human, wired to the ADR-0005 §6
   designated agent.
4. Retention for face-reference uploads that is materially shorter than the
   ADR-0008 asset default, and deletion on account closure.
5. A published statement of what Veyrnox will not do with an uploaded face.

*Status 2026-10-08 against the five conditions (no A7/A8 row exists, so none
is yet required to pass):* (1) a per-upload attestation exists in general form:
a job with a source must send `consent: true`, stored on the job
(`jobs.consent_attested_at`, 0096) and on the account (0146), wording version
`aup-2026-09-26`; whether it satisfies the "person depicted" wording for A7/A8
is a legal call, unverified. (2) output moderation: not built. (3) takedown
route: violation records and warnings/takedowns exist (0146, admin violations
page); the wiring to the ADR-0005 §6 designated agent is unverified, and the
DMCA agent filing is still a product launch blocker. (4) face-reference
retention: uploads are swept at 24 hours or within minutes of a finished job;
deletion on account closure is unverified. (5) published statement: not found.
Separately, **CSAM hash matching (ADR-0025 §8.1) has no code and no chosen
service**, and gates any public upload surface.

A1–A6 carry none of this weight — they modify the user's own photo and produce a
photo of the same person. That asymmetry is why the launch set stops at A6.

## 7. Success criteria

- A user can upload a photo, apply A1–A6, and see the result in Library.
- Every filter debits and, on provider failure, refunds — proven by the same
  acceptance tests that cover existing models.
- `reconcile_balances()`, `reconcile_free_credits()`, `reconcile_top_ups()` all
  return zero rows for 24 hours after launch.
- No filter is `active = true` whose endpoint has not returned a real output on
  a live call.
- Every filter's `credits_5s` clears the ADR-0014 floor against its measured
  `provider_cost_per_unit`.

## 8. Open questions

1. Retention for user uploads — inherit ADR-0008, or shorter? (Recommend shorter.)
   *Answered in code:* shorter. 24 hours for an abandoned upload, minutes after
   the job finishes (ADR-0028, `lib/uploadSweep.js`).
2. Does an upload count against a quota, or is it free until a filter runs?
   (Recommend free but rate-limited and size-capped; storage is the only cost.)
   *Answered in code, with a twist:* free of credits, rate limited (ADR-0035),
   capped at 10 unconsumed uploads, 20 MB per image and 100 MB per video, and
   refused to an account with a zero balance (`insufficient_credits`). The
   reserved byte budget (ADR-0044) is Proposed and off in production.
3. Track B: is Veyrnox willing to publish a probabilistic "this is fake" verdict
   about a named person's media? Detectors run 70–85% in the wild and worse on
   re-compressed social uploads. This is an ownership decision, not engineering.
4. Do A7/A8 belong in this product at all while Track B is also being sold?
   Selling the swap and the detector from one brand is a positioning call.
