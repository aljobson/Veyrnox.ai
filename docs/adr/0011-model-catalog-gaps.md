# ADR-0011 — Model catalog gaps

- **Status**: Proposed (2026-09-11)
- **Date**: 2026-09-11
- **Deciders**: Product owner (sole)
- **Related**: [ADR-0000 — Product strategy](0000-product-strategy.md), `docs/PHASE-1.md`

## Context

Four model rows in the current catalog cannot be reactivated without a product-level call because the underlying provider (fal, currently our sole direct integration) does not expose the exact SKU we advertise. Left as-is they are visible on `/pricing`, generate a rejected request when a user picks them, and burn trust on their first attempt.

Each row has three shapes of answer — **drop**, **rename to the closest fal SKU**, or **swap provider** — and each has a different margin and voice-catalog implication.

For every row below: the framing lists all three options with trade-offs, and closes with a per-row recommendation grounded in one heuristic — **"a first-time visitor to /pricing today should never see a model that will reject their first prompt."** Product owner still owns the final call.

## Row 1 — `kling-3.0`

**Reality**: fal exposes Kling v3 as *image-to-video only* (`fal-ai/kling-video/v2.1/master/image-to-video` and similar). There is no text-to-video v3 endpoint on fal. Our catalog advertised text-to-video.

### Options

- **Drop**. Remove `kling-3.0` from the catalog until fal (or another provider) exposes a v3 text-to-video path.
  - Margin impact: neutral — we weren't earning on rejected requests.
  - Voice catalog: none (not a voice model).
  - First-visit UX: cleanest.
- **Rename to `kling-3.0-i2v`** and pin it to fal's image-to-video endpoint. Requires our request schema to accept an input image; UI must surface an image picker for this model row.
  - Margin impact: potentially positive — i2v is a distinct paid product; catch-up work on the UI to accept an input image.
  - Voice catalog: n/a.
  - First-visit UX: introduces a "some models need an image, some don't" fork that the UI may not be ready for.
- **Swap provider**. Route `kling-3.0` (text-to-video) to Kling's own API, Replicate, or another aggregator that exposes v3 t2v.
  - Margin impact: new billing relationship needed; adapter work. ADR-0000 rules this out for Phase-1 (single-provider now, Hybrid milestone later).
  - Voice catalog: n/a.
  - First-visit UX: fine, but the effort cost is disproportionate for one row.

**Row 1 recommendation**: **rename to `kling-3.0-i2v`** if the UI can surface an image input this milestone; otherwise **drop** and revisit when fal adds v3 t2v.

## Row 2 — `hailuo-02`

**Reality**: fal replaced Hailuo-02 with MiniMax's H3 family (`fal-ai/minimax/hailuo-02/*` was deprecated in favor of `fal-ai/minimax/video-01`, `hailuo-02` and `hailuo-02-fast` are being sunset by MiniMax themselves; fal now exposes `fal-ai/minimax/hailuo-02-standard` and the newer H-family). The exact naming shifts every few months.

### Options

- **Drop**. Remove `hailuo-02`.
  - Margin impact: minor negative — Hailuo is a recognizable brand for video.
  - Voice catalog: n/a.
  - First-visit UX: clean.
- **Rename to `minimax-h3`** (or whichever current fal SKU we verify at commit time) and update the pricing math.
  - Margin impact: neutral-to-positive — same-family successor; users who chose Hailuo for MiniMax's video style still get it.
  - Voice catalog: n/a.
  - First-visit UX: the pricing page shows a working row with a slightly different name; brand recognition partly preserved.
- **Swap provider**. Route to MiniMax's own API. Same objections as Row 1 (out of Phase-1 scope per ADR-0000).

**Row 2 recommendation**: **rename to the current fal MiniMax SKU** we verify at implementation time. Least-surprise for existing users while staying single-provider.

## Row 3 — `seedream-4.5`

**Reality**: fal exposes `fal-ai/bytedance/seedream/v4/text-to-image` — that is, Seedream **v4**, not the v4.5 or v5.0 we implied. There is no v4.5 on fal today (Seedream's own release cadence is faster than fal's exposure).

### Options

- **Drop**. Remove `seedream-4.5`.
  - Margin impact: negative — Seedream is a strong-preference model in some workflows.
  - Voice catalog: n/a.
  - First-visit UX: clean.
- **Rename to `seedream-v4`** and price against `fal-ai/bytedance/seedream/v4/text-to-image`.
  - Margin impact: neutral — v4 is a real product, just an older version number than we advertised.
  - Voice catalog: n/a.
  - First-visit UX: a slight version downgrade in the model name; may be noticed by the tiny fraction of users comparing Seedream releases.
- **Swap provider**. Route to ByteDance / Volcengine directly if they expose Seedream v4.5. Same objections as Rows 1 & 2 (out of Phase-1 scope).

**Row 3 recommendation**: **rename to `seedream-v4`**. This is the closest true SKU on fal today.

## Row 4 — `cosyvoice-2`

**Reality**: CosyVoice-2 (Alibaba/Tongyi's TTS) is not exposed by fal at all. Reactivating this row requires wiring a *new provider* — either Fish Audio, ElevenLabs, or Alibaba's own API — because fal does not have a TTS surface here.

This is the only row where all three options have a serious voice-catalog integrity implication.

### Options

- **Drop**. Remove `cosyvoice-2`.
  - Margin impact: potentially significant — TTS is often a distinct product line with different customers than image/video, and losing our only TTS row means no revenue from that segment.
  - Voice catalog: **losing the only voice row in the catalog**. If Veyrnox positions itself as full-stack (image + video + voice), this hurts positioning meaningfully. If Veyrnox is only image + video for Phase-1, dropping is fine.
  - First-visit UX: cleanest — no rejected first prompts.
- **Rename to a nearest fal TTS SKU**. There is no direct equivalent — fal's audio surface is different (music, TTS via a small number of models). Renaming would silently swap voice quality and language coverage, which is a much bigger surprise than the image-model renames above.
  - Margin impact: neutral; users who wanted CosyVoice specifically will churn on discovery.
  - Voice catalog: preserves one voice row but at the cost of "the row lies about what it is." Poor.
  - First-visit UX: bad — silent identity swap.
- **Swap provider**. Add a second provider adapter dedicated to voice (ElevenLabs is the safest, most-documented choice; Fish Audio is cheaper; Alibaba Cloud direct is closest to the original CosyVoice-2 but has a heavy onboarding cost).
  - Margin impact: variable — depends on the provider's wholesale terms; voice usually has healthy margins.
  - Voice catalog: preserved and strengthened.
  - First-visit UX: good — the row works.
  - Effort: real. This is an adapter build, not a config change; probably breaks the "single-provider Phase-1" premise of ADR-0000 unless voice is deferred to the Hybrid milestone.

**Row 4 recommendation**: **drop for Phase-1**, and mark voice as a distinct Phase-2 decision. Renaming to a mismatched fal SKU is worse than the drop; adding a whole provider is out of Phase-1 scope per ADR-0000. This is the row that most needs its own follow-up ADR.

## Aggregate recommendation

Apply to the catalog now (all row-level "drop" or "rename" actions require a config change only):

| Row | Recommendation |
|---|---|
| `kling-3.0` | Rename to `kling-3.0-i2v` if UI can accept image input this milestone; otherwise drop |
| `hailuo-02` | Rename to the currently-exposed fal MiniMax SKU (verify at commit time) |
| `seedream-4.5` | Rename to `seedream-v4` |
| `cosyvoice-2` | Drop; open a follow-up ADR for a voice/TTS provider decision |

One-line reason across the four: minimize the "your first prompt was rejected" moment on `/pricing`, keep single-provider (fal) discipline for Phase-1 per ADR-0000, and defer any provider-add decision (voice, Kling direct) to an explicit later call.

## Decision

Approved by Al 2026-09-11 — rename kling-3.0 -> kling-3.0-i2v (image-to-video), hailuo-02 -> minimax-h3, seedream-4.5 -> seedream-4. cosyvoice-2 dropped; TTS follow-up in ADR-0012. Applied via migration 0017.

## Consequences (if the aggregate is accepted)

- `/pricing` page copy needs an update — model names, descriptions, and any implied version numbers must match what the fal endpoint actually is.
- Migration for existing DB rows: any user history that references the old model IDs should keep working (immutable log). New generations use the renamed IDs. A small mapping (`old_id → new_id`) in the catalog module handles reads of historical rows.
- The voice/TTS ADR is now a known-known — put a stub in `docs/adr/` next.
- If any of Rows 1-3's fal SKUs change again in the next 3-6 months (they will), the mapping module absorbs the churn rather than the pricing page.

## Open questions

- Does the current UI code path support "this model requires an input image" as a per-model flag? Row 1's "rename to i2v" option depends on this.
- What is the historical usage split among the four rows? If `cosyvoice-2` had zero requests to date, dropping it is easy. If it was the #1 model, the voice-provider decision jumps to Phase-1 urgency.
- Any legal/contract implication of removing advertised models mid-cycle? For free-credit users the answer is almost certainly no; for anyone on a paid plan there may be a ToS/notice requirement.
