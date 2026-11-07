# ADR-0329 — Swap: two inactive person-replacement offers

Status: accepted for inactive implementation under the frozen work order; activation and paid-billing verification pending.
Date: 2026-11-07.

## Decision

Add `swap-recast` (Swap · Pro, fal MiniMax H3 Max Recast) and `swap-quick`
(Swap · Quick, Crun Wan 2.2 Animate replace). Both are `video-to-video`,
`active=false`, `gated_flag=false`; migration 0449 is not applied by the builder.
Wan and H3 are different models, so ADR-0256 decision 2 forbids using one as
fallback for the other. No `model_routes` rows are needed: as with 0405,
`resolveRouteSet` in `lib/supplierRoutesDispatch.js` falls back to the catalog
provider when routes are absent, even with supplier routes enabled.

Use the existing web/mobile Create flow, source slots, ownership checks,
consent receipt, spend guards (ADR-0323), and failure refund paths. Both static
rows are staged and excluded from public fallbacks. No flag, deployment config,
ledger, RPC, webhook or refund change is part of this implementation.
Phase 2 templates remain deferred; no source clip, template or manifest ships.

## Evidence and provisional pricing

Evidence supplied in the frozen work order, read 2026-11-07:

- [fal Recast input and pricing text](https://fal.ai/models/fal-ai/minimax-h3-max-recast/llms.txt)
  and [model page](https://fal.ai/models/fal-ai/minimax-h3-max-recast).
  Required `video_url`, required ordered `reference_image_urls` (people matched
  left to right), optional `prompt`, `resolution`, seed and safety checker.
  Output is video plus seed, retaining source soundtrack. Queued hosted API.
  Documented source: 5–30 seconds, each shot at most 14.7 seconds.
- fal text quotes $0.08/s at 768P and $0.16/s at 1080P, per shot, including
  4,096 reference tokens per shot, then $0.02 per 1,000 tokens. Its worked
  example says **about $2.40 for 10 seconds at 768P with one person**. Other
  pages disagree ($0.30/s and $3.49 for a 1080P run). No paid charge is verified.
- [Crun Wan Animate contract](https://docs.crun.ai/models/wan/2-2-animate-replace.json):
  exactly one image and one video, resolution 480P (wan-std) or 720P (wan-pro),
  optional callback. Crun publishes **no price**. Poll only; no callback is sent.
- [fal Wan Animate replace](https://fal.ai/models/fal-ai/wan/v2.2-14b/animate/replace)
  supplies the work order's conservative proxy: $0.005/frame at 720p × 24 fps
  = $0.12/s. This is not a Crun quote. An owner Crun paid probe following
  `scripts/probe-crun.mjs` must replace it before activation.

The frozen work order notes the H3 open-weight licence excludes US/UK/EU/KR.
There is no self-hosting. Hosted provider territory, licence and platform-use
permission still require owner verification; a hosted listing is not proof.
No provider call or fresh price verification was made in this implementation.

## Whole-job billing (SWAP-001)

Copy the source-following LatentSync row in migration 0090: `cost_unit` is
`per_generation`, `billing_seconds` is NULL, and `provider_cost_per_unit` is the
cost of the **entire accepted job**, not a per-second rate. `lengths: null`
means one nominal 5-second catalog unit, with no provider duration field.
The input video cap is 10 seconds for both offers:

| Offer | Provisional whole-job cost | Credits: ceil(cost / 0.01796) |
| --- | --- | --- |
| Swap · Pro | 10 × $0.24 = $2.40 | 134 |
| Swap · Quick | 10 × $0.12 = $1.20 | 67 |

Shorter accepted clips cost the same unit. Omitted `duration_seconds` and `5`
both debit that whole-job price. An explicit `10` is refused with
`duration_not_supported` before debit, as existing `lengths: null` models do.
`generationEstimate` returns the same price for omitted/5 and null for 10.
This interprets the work order's “or refused” alternative using the existing
contract; it does not make 10 a selectable billing duration. No 2-unit
multiplier or app-layer price rule is introduced. Clip Editor was inspected
but is not the precedent: it prices resolved edit units and has a special
per-second margin rule. Later repricing must use a new migration.

## Admission, safety and privacy

Pro pins `resolution: '768P'` and `enable_safety_checker: true`; neither is
user-settable. Its optional string prompt is capped at 1,000 characters.
One photo is allowed while `MULTI_REFERENCE_ENABLED` is absent/off, two when
on, never three. The image slot has dated schema and price evidence fields
for `verifiedReferenceLimit`; these do **not** mean paid billing was verified.
Quick pins `model: 'wan/2-2-animate-replace'`, `resolution: '720P'`, one photo,
one video, HTTPS URLs and a strict input allowlist. It accepts no prompt.

Both video pickers say MP4 only. Server admission requires proven visual
duration: Pro 5–10 seconds, Quick 2–10 seconds. Quick video sides are 200–2048
pixels; photo sides 200–4096. Pro has no invented dimension bounds. Unknown
length/size and out-of-range inputs fail before debit via existing errors.
QuickTime cannot prove visual duration and is refused. All 11 locales now use
bound-agnostic `source_too_short` and `source_resolution_out_of_range` copy,
including non-video dimensions; mobile shared translations are regenerated.
Existing mobile pre-checks reject known short/out-of-range metadata; unknown
metadata is left to authoritative server inspection.

The existing slot schema cannot express Crun's 5 MB photo limit, 1:3–3:1
aspect limits, or “one person facing camera”. These remain provider-side
refusals using the existing submit/provider-failure refund path. The global
100 MB video upload cap is stricter than Crun's 200 MB. JPEG/PNG/WebP are
accepted locally; BMP/AVI are outside the existing upload types. fal's
14.7-second shot limit has no new shot detector, but every accepted whole
source is at most 10 seconds. Unexpected provider refusals still refund.
Do not infer any guarantee of visual quality, consent or legal compliance.

A short notice on these two models alone says “Only use photos of people who
agreed.” It is translated in all 11 locales on web and mobile and supplements
existing source-rights confirmation. Machine translations need native review.
The new video plus face-photo categories are recorded in
[the Swap privacy entry](../compliance/swap-privacy-register.md) and the existing
[sub-processor register](../compliance/sub-processors.md), following ADR-0317.

## Activation checklist

Swap · Pro (`swap-recast`) activation and any repricing are **BLOCKED** until
one billed staging fal run is recorded; at fal's other quoted rate of $0.30/s,
a 10 s job costs $3.00, above what 134 credits cover at the 50% floor, so the
price must be re-derived from the billed amount first. Swap · Quick is likewise
blocked until a Crun paid probe replaces its provisional cost.

- Owner approves one staging fal run and reads the actual billed amount,
  including shots/reference tokens; verify one/two photos, order and soundtrack.
- Owner runs a paid Crun probe, records its real cost, output host and contract.
- Reconcile prices and 50% margin against those bills in a **later migration**.
- Prove valid submissions and controlled failure → existing full refund for
  each provider, with no second debit. Verify admission/spend policies.
- Review consent/AUP, hosted rights/territories, privacy categories, processors
  and translations with the owner and appropriate reviewers.
- Explicitly decide the existing multi-reference flag; do not silently enable it.
- Apply migration through the approved workflow, replay twice on scratch
  Postgres, and run schema, margin, capability and repository proof checks.
- Activate only by a separate guarded migration and remove staged markers
  after proof. No activation or flag change is authorized by this work order.

## Implementation constraints and numbering

GitHub main directories and all four open PR file lists checked 2026-11-07:
main ends at migration 0445 / ADR-0328; PR #1964 owns 0446, #1965 owns 0447.
Use 0449 / ADR-0329 (0448 is taken by PR #1964, renumbered 2026-11-07). Recheck before integration. GitHub CLI network access
failed; the connected GitHub read API supplied the numbering evidence.
The historical README index and its baseline remain unchanged; the standalone
ADR-0329 title and Status line make it discoverable through
`node scripts/adr-index.mjs` (host disposition SWAP-R1).

No migration is applied: the work order's operational prohibition on applying
migrations to **any** database prevents its requested scratch replay here.
Mobile typecheck/device tests are not run and no mobile dependencies installed.
Root tests exercise the existing pure mobile source/translation helpers.
No production build is required with the shared node_modules symlink.
