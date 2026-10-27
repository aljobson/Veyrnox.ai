# ADR-0269: Motion-transfer templates from our own driving clips

Status: Accepted (2026-10-27, owner in chat: "Kling 3.0 Motion Control Std at 36 credits per 5 s, Wan Replace at 23 for phase 2, flags shipped off"; about $1.66 of STAGING fal probes allowed; after the billed probe: "motion-replace at 34 credits per 5 s, recorded cost $0.60"). Built behind both flags with migration 0402 staged inactive; probes done; clips and activation still to come.

Date: 2026-10-27

Related: [ADR-0027 capability registry](0027-model-capability-registry.md),
[ADR-0037 50% margin](0037-higgsfield-credit-parity.md) (amendment 2: per-row floor, migration 0366),
[ADR-0072 agents and trends](0072-agents-and-trends-scope.md) (template ranking),
[ADR-0243 job cancel](0243-job-cancel.md),
[ADR-0256 supplier routes](0256-supplier-routes.md),
[ADR-0263 generation reference limits](0263-generation-reference-limits.md).

## Context

Popular "viral preset" apps make a person in a photo perform a short movement
(a runway walk, a dance, a parkour run) by pairing the photo with a reference
("driving") video. There is no text prompt: the clip carries the motion and the
camera move. A second mode puts the person from the photo into the clip in
place of its performer.

Veyrnox templates today are prompts on Kling 3.0 image-to-video. A prompt can
describe a walk; it cannot reproduce a timed routine or a specific camera path.
That needs a motion-transfer model.

We must not copy any other service's reference clips, previews or wording.
The repository is public, so template data names no competitor.

## Models we can reach (read 2026-10-27)

Prices are fal `endpointBilling` objects on each model page, billed per output
second. Inputs are from fal's queue OpenAPI for each endpoint. kie rows are
from `docs/pricing/wholesale-survey-2026-09-26.json`.

| Model | Endpoint | Modes | Driving clip limit | Output | $/s | Licence on page |
|---|---|---|---|---|---|---|
| Kling 3.0 Motion Control, Standard | `fal-ai/kling-video/v3/standard/motion-control` | move | 10 s (`character_orientation: image`, follows camera), 30 s (`video`) | 720p, length of the clip | 0.126 | Commercial use |
| Kling 3.0 Motion Control, Pro | `fal-ai/kling-video/v3/pro/motion-control` | move | same | 1080p | 0.168 | Commercial use |
| Kling 2.6 Motion Control, Standard / Pro | `fal-ai/kling-video/v2.6/{standard,pro}/motion-control` | move | 30 s | 720p / 1080p | 0.07 / 0.112 | Commercial use |
| Wan 2.2 Animate Move | `fal-ai/wan/v2.2-14b/animate/move` | move | not stated | 480p, 580p, 720p | 0.08 (720p) | Commercial use (open weights) |
| Wan 2.2 Animate Replace | `fal-ai/wan/v2.2-14b/animate/replace` | replace | not stated | 480p, 580p, 720p | 0.08 (720p) | Commercial use (open weights) |
| DreamActor v2 (ByteDance) | `fal-ai/bytedance/dreamactor/v2` | move, face and body; people, pets, cartoons | 30 s, 200x200 to 2048x1440 | input size | 0.05 | Commercial use |
| Kling 3.0 Motion Control on kie | kie `kling-3-motion-control` | move | — | 720p / 1080p | 0.10 / 0.135 | kie terms |
| Wan 2.2 Animate on kie | kie `wan-animate` | move, replace | — | 480p to 720p | 0.0625 (720p) | kie terms |

Not reachable: Runway Act-Two (no fal page, Runway's own API only, $0.05/s) and
Wan 2.5 Animate (no fal page).

Notes that bear on the choice:

- Kling Motion Control wants a realistic performer with the whole body or upper
  body visible in the clip, and a subject over 5% of the photo. Pets and
  products are not mentioned and are unverified.
- Kling's `elements` input binds a face for identity, but only in `video`
  orientation.
- Kling keeps the clip's sound by default (`keep_original_sound: true`).
- Wan's input and output safety checkers default to off; ours must turn them on.
- DreamActor trims a 1-second transition from the start by default.

## Decision

1. **One model for v1: Kling 3.0 Motion Control, Standard, on fal.** It is the
   best motion and camera following of the hosted options, it is a partner API
   with a commercial licence, and it matches Kling 3.0, which our templates
   already use. Pro (1080p) is not offered in v1: 33% more cost for a vertical
   social clip. A kie route ($0.10/s) may be added later as priority 1 under
   ADR-0256 once it has a parity record.

2. **Replace mode is a second offer, phase 2: Wan 2.2 Animate Replace at
   720p.** It is the only hosted replace model. It ships behind its own flag
   after a staging probe, with both safety checkers on.

3. **The driving clip is never the caller's.** v1 has no driving-video upload.
   The request names a motion template id; the server looks it up in a
   server-side registry that holds the clip's R2 key, its exact length and its
   orientation. The client never sends a `video_url` and never sends a
   duration for these offers. This removes the consent question for the clip
   (we own every clip) and makes the price exact.

4. **Price from the catalog, per 5 seconds of output, as every video offer.**
   The floor is `cost <= credits_5s * 0.01796` (0366).

   | Offer id | Supplier cost per 5 s | Floor | `credits_5s` | 5 s clip | 10 s clip |
   |---|---|---|---|---|---|
   | `motion-transfer` (Kling 3.0 MC Std) | $0.63 | 35.08 | **36** | 36 | 72 |
   | `motion-replace` (Wan 2.2 Replace 720p, phase 2) | $0.60 billed (see probe results) | 33.41 | **34** | 34 | 68 |

   For comparison, `kling-3.0-i2v` is 32 per 5 s. Clips are cut to exactly
   5.0 s or 10.0 s so a template never rounds up into an extra unit; the probe
   confirms fal bills the clip length and not more. Ids carry no supplier name
   (ADR-0256 decision 9). Modality `image-to-video`, so `kindOf` and
   `priceFor` treat the offers as video without a new modality.

5. **Debit and refund use the existing path, unchanged.** The generation route
   debits `credits_5s * ceil(seconds / 5)` with the job's idempotency key; a
   submit refusal refunds through `refundRejectedSubmit`, a provider failure
   through the fal webhook, a cancel through ADR-0243. No new money RPC and no
   ledger change. The server-resolved length is what `priceFor` reads.

6. **Consent for the photo** uses the existing `SourceRightsConfirmation`
   statement (recorded against the job). The template screen adds one line:
   the person in the photo will be shown performing the movement.

7. **Fixed provider inputs.** Kling: `character_orientation` from the
   template (`image` for clips that carry a camera move, at most 10 s),
   `keep_original_sound: false` (our clips' audio is added in the template
   preview, never sent), `enable_safety_checker: true`, no prompt in v1. Wan:
   `resolution: 720p`, `enable_safety_checker: true`,
   `enable_output_safety_checker: true`.

8. **Maximum clip length: 10 s** in v1 (72 credits). Longer clips need the
   `video` orientation and a price review.

9. **Flags.** `MOTION_TRANSFER_ENABLED` and `MOTION_REPLACE_ENABLED`, server
   vars in `wrangler.jsonc`, shipped `"false"`. Absent means off. Off, the
   template rail does not show the motion templates and the generation route
   answers 400 `motion_transfer_unavailable` before any lookup or debit.

10. **Pets use Kling; products wait.** The 2026-10-27 probe showed Kling
    keeps a dog and walks it naturally, so pet templates use `motion-transfer`
    and DreamActor is not needed. Products are still unprobed.

## Probe results (STAGING, 2026-10-27)

Inputs were fictional and made by us on staging (`scripts/probe-fal-motion-transfer.mjs
--generate`): a woman and a golden retriever (Nano Banana) and a 5.0 s walking
clip (Kling 3.0 Std text-to-video, silent, trimmed to 5.0 s).

| Run | Request id | Output | Took | Seen |
|---|---|---|---|---|
| Kling MC, woman | `01a17da4-0a7e-7930-94f5-2d67d35e31fb` | 4.80 s, 720x1264, 30 fps, silent | 266 s | Same face and clothes; walks toward camera in the photo's own studio background |
| Kling MC, dog | `01a17da8-223b-74c2-ae22-bbcd59770ef5` | 4.80 s, 720x1264, silent | 255 s | Same dog, natural four-legged walk |
| Wan Replace 720p, woman | `01a17dac-0e6e-79a1-b79d-d0c003310d57` | 5.04 s, 720x1280, 24 fps, silent | 618 s | She replaces the walker in the clip's street; face and clothes kept |

All outputs were served directly (HTTP 200, no redirect) from `v3b.fal.media`,
which `packages/adapters/r2Copy.js` already allows.

Consequences for the templates:

- In motion mode the scene comes from the user's photo, not the clip. A
  template whose point is the clip's setting (`motion-world-shift-walk`) must
  be a replace template.
- Replace takes about 10 minutes; the template screen must say so.
- **Billed (fal usage export, staging key, 2026-10-27):** Kling MC 10 s for
  the two jobs = 5 s each at $0.126 = **$0.63 per job**, as recorded (fal
  bills the 5.0 s clip, not the 4.8 s output). Wan Replace **7.5 s** for one
  5.04 s clip at $0.08 = **$0.60**, 1.5 times the clip length and 50% above
  the $0.40 recorded in 0402. 23 credits covers at most $0.413, so
  `motion-replace` could not be activated at 23. At $0.60 per 5 s the floor is
  34 credits (60000 <= 34 x 1796 = 61064); the owner approved 34 and $0.60,
  and 0402 (unapplied) was edited in place.
  Inputs: Nano Banana 2 images $0.0796; Kling text-to-video billed 3 s, $0.42.
  Probe total $2.36.

## Build plan (after approval)

1. Probes, STAGING fal key, owner's word first: Kling 3.0 MC Std 5 s with one
   person photo and one pet photo, Wan Replace 5 s at 720p. About $1.66. Read
   the billed seconds on fal's usage page and the output host for the R2 copy
   allowlist.
2. Migration (next free number on main, 0402 today; open PRs checked): two
   `model_catalog` rows, inactive, with recorded cost, `cost_unit
   per_second`, capability pins, the 0111 row-count assertion pattern.
3. `lib/motionClips.js`: the server registry (id, mode, R2 key, seconds,
   orientation, provenance, `ready`). The cards in
   `app/veyrnox/_lib/motionTransferTemplates.js` carry a `drivingClip` field
   that names the registry entry, never a URL.
4. Generation route: for the two offers, refuse a client `video_url` or
   `duration_seconds`, resolve the clip, presign it for 15 minutes, set
   `duration_seconds` from the registry before `priceFor`.
5. fal adapter body for both endpoints from the capability records in
   `lib/motionCapabilities.js`; `scripts/probe-fal-motion-transfer.mjs` runs
   step 1.
6. Tests: flag off refuses before debit; a client clip or duration is
   refused; price is 36 / 72 and 34 / 68; unknown template refused; the
   adapter body pins the safety and sound fields; refund on submit failure.
7. Activation is a separate migration after the probes and 24 h of clean
   reconciliation, and the flag flip is the owner's.

## Consequences

- Motion templates reproduce timed routines and camera moves that prompts
  cannot, at 36 credits for 5 s.
- We must produce and own about twenty driving clips before launch
  (`docs/templates/motion-transfer-clips.md`).
- No user-uploaded driving video in v1. Allowing one later needs its own
  consent and moderation decision: it is the path by which someone else's
  footage or likeness would enter.
- Replace mode and pets depend on probes and may change model.
