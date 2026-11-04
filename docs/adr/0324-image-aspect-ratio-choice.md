# ADR-0324 — Aspect-ratio choice on image models (Sana now; Seedream and FLUX gated)

Status: Sana and FLUX 2 Pro implemented; Seedream 4 not changed, waiting on the checks below.
Date: 2026-11-04.

The owner asked that people can set an aspect ratio on every generation. The live catalog showed 27 of 41 models with no
`aspect_ratio` input. Most are tools that follow a source picture (upscale, background removal, face tools, image-to-video)
or audio models, where a ratio means nothing. The generation models without one were Sana, Seedream 4, FLUX 2 Pro and
Hailuo 02.

## Decision

**Sana (`fal-ai/sana/v1.5/4.8b`)** takes `aspect_ratio` of 1:1, 4:3, 3:4, 16:9 or 9:16. The record consumes the input and
derives fal's `image_size` from it. Every size is at most 1024 x 768 pixels and a multiple of 32, so the price pin that
keeps one credit under $0.01 (the reason the size was fixed) still holds. 4:3 (1024 x 768) stays the default, so a request
without a ratio is unchanged. The web and phone Create screens show the choice with no further change because both read
the catalog's declared inputs.

## Not changed, and why

- **Seedream 4.** Crun is its first route, then kie, then fal (0389). A chosen ratio must be honoured by every route a
  failover can reach, and the Crun record only allows 1:1 today. Crun's accepted ratios are not confirmed from its docs.
  Needs the owner's paid probe on Crun and kie (16:9 and 9:16) before the record declares a ratio.
- **FLUX 2 Pro.** `admit_fal_dispatch` (0243) rejects any payload field beyond prompt and seed and pins 1024 x 768.
  Offering a ratio needs a new migration with a new function signature (REVOKE/GRANT as in CLAUDE.md), sizes at or under
  one megapixel to hold the $0.03 price, and the owner's approval through the migration workflow.
- **Hailuo 02 (kie), Kling 3.0 image-to-video, Kling Avatar v2.** No documented size parameter, or the output follows the
  source picture. No picker.

## Rollback

Revert the Sana record change; requests without `aspect_ratio` behave as before.

## Preparation for Seedream 4 and FLUX 2 Pro (2026-11-04, nothing applied)

### Order matters: the database first, the catalog second
`admit_fal_dispatch` only admits `prompt` and `seed` and overwrites the size with 1024 x 768. If the FLUX record started
sending `image_size` before the function allows it, every FLUX request, even the default one, would be refused
(`MODEL_UNAVAILABLE`). So there are two changes in two pull requests:

1. **Migration 0439 (backward compatible; admits what the record does not send yet).** Patch the live definition of
   `admit_fal_dispatch` the way 0406 did (read `pg_get_functiondef`, `replace`, raise if the text is not found, then
   REVOKE ALL / GRANT service_role by full signature). The patch: (a) the allowed extra keys become `prompt`, `seed`,
   `image_size`; (b) when `image_size` is present it must be one of five sizes, otherwise `MODEL_UNAVAILABLE`; when it is
   absent the 1024 x 768 default is added, as today; (c) the idempotent-replay comparison uses the same rule. The five
   sizes stay under 1,000,000 pixels, so the first-megapixel price of $0.03 and the fixed 30,000 microdollar
   reservation hold: 960x960 (1:1), 1024x768 (4:3), 768x1024 (3:4), 1024x576 (16:9), 576x1024 (9:16).
   Extend `scripts/test-fal-pinned-payload.mjs` (replays 0243 and 0406; add 0439) with: each size admitted and stored;
   a sixth size, a string size and an extra key refused with no job, debit or reservation; replay conflict on a different
   size; privileges unchanged; the capacity policy row unchanged. The owner applies it with the apply-migrations workflow.
2. **Catalog change, only after 0439 is applied on production.** FLUX record: `aspect_ratio` input of the same five
   ratios, consumed (`rename: { aspect_ratio: null }`), `derive` to the same size table, `assumes` no longer lists the
   default size. Same tests as Sana plus a check that the derived size is in the migration's list.

### Seedream 4 (`seedream-4`): two routes, Crun first then fal
- fal `fal-ai/bytedance/seedream/v4/text-to-image`: `image_size` accepts named shapes or width x height; total pixels
  between 960 x 960 and 4096 x 4096. Sizes at about 2048 on the long side stay in range and the price is flat per image:
  2048x2048, 2048x1536, 1536x2048, 2048x1152, 1152x2048.
- Crun `bytedance/seedream-4`: the adapter allows only 1:1 today (`packages/adapters/crun.js`, `aspects`), and the
  record fixes `aspect_ratio: '1:1'`. Crun's accepted ratios are **not confirmed from its docs**. Needs the owner's probe
  (PROD CRUN key, `scripts/probe-crun.mjs seedream`, one image each at 16:9 and 9:16, about 3 Crun credits each) that
  proves the output shape and size. Until then the picker must not be offered, because a failover from Crun to fal must
  give the same shape the person chose.
- Change set once proven: Crun record `aspect_ratio` input and adapter `aspects` set; fal record `aspect_ratio` input,
  consumed, derived size table above; both records declare the same ratio list (1:1, 4:3, 3:4, 16:9, 9:16); tests for each
  route and for failover keeping the ratio. No migration: the routes already exist (0388, 0389).

### Not done here
No migration written or applied, no record changed, no provider called.

## FLUX 2 Pro implemented (2026-11-04, after migration 0439 was applied to production)

`fal-ai/flux-2-pro` takes `aspect_ratio` of 1:1, 4:3, 3:4, 16:9 or 9:16. The record consumes it and derives fal's
`image_size`: 960x960, 1024x768, 768x1024, 1024x576, 576x1024. These are exactly the five sizes `admit_fal_dispatch`
accepts since 0439, all under one megapixel, so the $0.03 price and the 30,000 microusd reservation hold. A request
without a ratio now sends 1024x768 explicitly, which is what the database stored before. The web and phone Create
screens show the choice because both read the catalog's declared inputs.

Rollback: revert the FLUX record change. Requests without a ratio then send no size and 0439 stores 1024x768 as before.
