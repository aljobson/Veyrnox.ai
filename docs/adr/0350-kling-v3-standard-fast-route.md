# ADR-0350: Kling 3.0 Standard as the faster image-to-video choice

Date: 2026-11-17.
Status: accepted for inactive implementation; activation pending the fal bill.

## Context

The owner measured 475 s of fal render time for a 10 s Kling 3.0 Pro image-to-video clip and asked
for a 720p or 1080p choice. fal's endpoint `fal-ai/kling-video/v3/pro/image-to-video` has no resolution
or quality field (API schema read 2026-11-17: start/end image, prompt, multi_prompt, negative_prompt,
duration 3-15, generate_audio, elements, shot_type, cfg_scale, safety checker). Resolution is chosen by
the endpoint, so the choice is Pro or Standard, not a request field.

## Decision

Add `kling-3.0-standard-i2v` (**Kling 3.0 Standard · I2V**), endpoint
`fal-ai/kling-video/v3/standard/image-to-video`, as its own catalog model beside `kling-3.0-i2v`.
It takes the same fields as Pro, so it shares one capability record (5 or 10 s, start and optional end
frame, audio pinned off). It is listed in Photo to video next to Pro. Pro stays the default and its price
is unchanged; no existing user sees a difference.

Measured on staging, 2026-11-17, same 10 s clip, audio off, 4.6 s queue or less:

| | Render | Output |
|---|---|---|
| Standard | 113 s, 136 s | 1172x784 |
| Pro | 260 s | 1760x1176 |

Standard is about 2.3 times faster and its output is the 720p class. Pro is the 1080p class.

## Price

The catalog is normative. fal's page, read 2026-11-17, gives $0.084 per second audio off, so a 5 s unit
costs $0.42 and the standing floor gives `ceil(0.42 / 0.01796) = 24` credits; 10 s costs 48 through the
existing duration multiplier. No price is computed in the app layer. Migration 0556 inserts the row
**inactive**: the figure is from the page, not from fal's bill. Activation is a later one-line migration
after the owner confirms the bill for the two Standard probe requests. The weekly fal price watch records
the endpoint's base price (0.14, the same figure fal lists for Pro) in `scripts/lib/fal-unit-rates.mjs`.

## Not done

Wan 2.5 and Veo 3.1 already carry a `tiers` field for a real resolution parameter; Kling has none, so it
does not use it. Other Kling routes (kie, Crun, Higgsfield) were not changed.
