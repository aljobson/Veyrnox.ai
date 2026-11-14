# ADR-0238: Stage four inactive kie supplier SKUs

Status: Accepted for inactive staging only; live verification NOT RUN.
Date: 2026-10-20

## Decision

Migration `0358_kie_cheap_skus_staged.sql` inserts four separate kie catalog
identities with `active=false` and `gated_flag=false`. Nothing is applied to a
database by this work. Existing models, customer prices and routing stay intact.
Activation requires a later reviewed migration after the staging checklist passes.

Supplier documentation and rates below were verified by the coordinator on
2026-10-20 and supplied in the frozen work order. The builder used that evidence
offline; it did not fetch documentation, call a provider or verify billed cost.
All submissions use `POST /api/v1/jobs/createTask`.

## Contracts and priced units

- `kling-3.0-i2v-720p-kie`: internal endpoint
  `market:kling-3.0/video-std` maps to supplier model `kling-3.0/video`,
  `mode:'std'` (720p), `sound:false`, `multi_shots:false`, `multi_prompt:[]`,
  one first-frame `image_urls` entry and `duration:'5'`. Optional aspect ratios
  are 16:9, 9:16 and 1:1; when omitted the first frame determines the ratio.
  The supplier allows a 2,500-character prompt and string durations 3–15;
  this row exposes at most 2,000 characters and exactly 5 seconds. No negative
  prompt, elements or multi-shot controls are exposed. The existing endpoint
  `market:kling-3.0/video` retains its Pro/1080p branch and 5/10-second contract.
  [Kling 3.0 contract](https://docs.kie.ai/market/kling/kling-3-0.md).
- `seedance-2.0-mini-kie`: endpoint `market:bytedance/seedance-2-mini`,
  text-to-video only, `resolution:'720p'`, integer `duration:5`,
  `generate_audio:false`, `nsfw_checker:true`. Prompt length 3–2,000, aspect
  ratios 1:1, 4:3, 3:4, 16:9 (default), 9:16 and 21:9. The supplier allows up
  to 20,000 characters, durations 4–15 or -1, 480p and adaptive ratio; none of
  those wider options is exposed. First/last frames, reference images, videos,
  audio and web search are refused. Supplier first-frame, first+last-frame and
  reference modes are mutually exclusive; this row uses none of them.
  [Seedance Mini contract](https://docs.kie.ai/market/bytedance/seedance-2-mini.md).
- `wan-2.6-flash-i2v-kie`: endpoint `market:wan/2-6-flash-image-to-video`,
  one required `image_urls` entry, `duration:'5'`, `resolution:'720p'`,
  `audio:false`, `multi_shots:false`, `nsfw_checker:true`. Prompt length 2–1,500;
  no aspect-ratio control. The supplier's 10/15-second and 1080p options are
  refused. Uploaded and Library sources must have readable dimensions at least
  256×256 and an inspected size at most 10,000,000 bytes (conservative decimal
  interpretation of 10 MB). Existing source handling admits JPEG, PNG and WebP.
  [Wan Flash contract](https://docs.kie.ai/market/wan/2-6-flash-image-to-video.md).
- `seedream-5-flash-kie`: endpoint `market:seedream/5-flash-text-to-image`,
  one image, `size:'1K'`, `output_format:'png'`, `nsfw_checker:true`. Prompt
  length 4–2,000, aspect ratios 1:1 (default), 4:3, 3:4, 16:9, 9:16 and 21:9.
  The adapter always sends the supplier-required aspect ratio. Supplier prompt
  maximum 5,000, 2:3/3:2 ratios, JPEG and 1.5K/2K sizes are not exposed.
  [Seedream Flash contract](https://docs.kie.ai/market/seedream/5-flash-text-to-image.md).

Every new registry record opts into strict input validation before the legacy
undeclared-input filter. Caller tier/audio/negative-prompt controls fail before
debit. Source URLs come from owned, inspected uploads or Library assets, never
from direct caller URLs. No existing capability record opts into this behavior.
Wan's minimum dimensions and byte ceiling are record-specific; retaining the
inspected `sizeBytes` metadata does not narrow other models' source checks.

The gateway retains its 2,000-character prompt and 8,192-character serialized
input limits and existing aspect-ratio allowlist. Registry metadata and adapter
validation expose only the intersection with supplier contracts. Wan's supplier
maximum is lower, so its positive boundary proof is 1,500 characters, not 2,000;
1,501 and 2,001 characters are rejected. Other new rows accept 2,000 and reject
2,001. Tests exercise every advertised aspect through the real route.

## Price arithmetic and replay

Using the [50% margin policy](../pricing/50-percent-margin.md), floor credits
are `ceil(total generation cost / 0.01796)`:

- Kling Standard: $0.07/s × 5s = **$0.3500 total**; floor 20, staged price
  **22 credits**. `cost_unit='per_second'`, `billing_seconds=5`.
- Seedance Mini: $0.041/s × 5s = **$0.2050 total**; floor 12, staged price
  **13 credits**. `cost_unit='per_second'`, `billing_seconds=5`.
- Wan Flash: **$0.1000 per generation**; floor 6, staged price **7 credits**.
  `cost_unit='per_generation'`, `billing_seconds=NULL`.
- Seedream Flash: **$0.0162 per generation**; floor 1, staged price **1 credit**.
  The quoted price is the same for 1K/1.5K/2K; this row pins 1K.
  `cost_unit='per_generation'`, `billing_seconds=NULL`.

As migrations 0029 and 0327 specify, `provider_cost_per_unit` stores the full
unit cost. Spend reservations multiply that total by purchased units, never by
`billing_seconds` again. Migration assertions and database acceptance check the
stored totals and a one-unit spend calculation; a full-replay acceptance database
also checks `private.provider_spend_model_cost` against those amounts.

`INSERT ... ON CONFLICT (id) DO NOTHING` records what this execution inserted.
Only inserted rows have staging state, price, cost and billing assertions.
Existing rows are checked only for id/provider/endpoint/modality identity.
Immediate replay is a no-op, as is replay after later activation or repricing.
Identity collisions raise and roll back the statement. No existing row is updated.

## Activation checklist and open questions

Complete every item in the [staging verification record](../operations/kie-cheap-skus-verification-2026-10.md)
before proposing activation: real gateway completion, billed supplier cost,
R2 copy, Library download, full refund on failure and matching ledger entries.
Use active fixtures only in an isolated test/staging environment; keep these
migration rows inactive. Compare Seedance Mini billed credits with audio on and
off: the quoted row has no audio dimension and this remains unresolved. Confirm
Wan's `audio:false` flag controls both output and billed tier. Confirm Kling
Standard first-frame behavior and its separation from existing Pro.

Production migrations run only through the owner-approved `apply-migrations`
workflow (ADR-0023). Re-check migration/ADR numbering against current main and
open PRs at integration time; the offline builder cannot check concurrent work.

## Non-goals and proof limits

No activation, production SQL, existing-price changes, model retirement, fal
Kling replacement, Seedream 4/FLUX re-route, Nano Banana Pro or Veo changes.
No competitor research or broader wholesale price tables are added.
Fake-network tests do not prove supplier billing or live output quality.
The existing generation route and main capability registry already exceed the
500-line guideline; this work keeps scoped edits there rather than restructuring
the existing gateway. Database replay and worker runtime proof remain subject to
the builder sandbox limits and must be independently completed before integration.
