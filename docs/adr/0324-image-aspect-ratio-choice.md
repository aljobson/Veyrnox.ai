# ADR-0324 — Aspect-ratio choice on image models (Sana now; Seedream and FLUX gated)

Status: Sana implemented; Seedream 4 and FLUX 2 Pro not changed, waiting on the checks below.
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
