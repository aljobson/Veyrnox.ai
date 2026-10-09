# PRD addendum — Clip Editor slow motion

**Status:** Draft · 2026-10-09 · Slice 0 (live probe) not run
**Extends:** [PRD.md](PRD.md), [CAPTIONS.md](CAPTIONS.md). Where they disagree, CLAUDE.md and the ADRs win.

## Decision log

- **Asked for:** speed changes in the editor (2026-10-09).
- **What fal has.** A search of fal's public catalog found no plain speed or
  retime endpoint. `fal-ai/ffmpeg-api` offers compose, merge, extract-frame,
  loudnorm, metadata and waveform, and `fal-ai/workflow-utilities` offers
  trim, scale, reverse, blend and auto-subtitle. The frame-interpolation models
  (RIFE, FILM, AMT, `topaz/interpolate/video`) add frames; only the Topaz one
  has a `slowdown_factor`.
- **Chosen by the owner: slow motion through `topaz/interpolate/video`.**
  Whole-number slow motion, 2x to 8x, with interpolated frames. **No speed-up**
  (fast-forward): nothing on fal does it, and `compose` was rejected in the
  editor's Slice 0 for ignoring durations (PRD section 9).
- Rejected for now: exact speed up and down on our own ffmpeg (for example the
  video agent's Fly runner). It is cheaper and covers speed-up and audio, but
  is a bigger build on another product's infrastructure.

## Candidate step (unverified)

`topaz/interpolate/video`, input `video_url`, `slowdown_factor` (integer
1..8), `target_fps` (16..120, default 60), `model` (Apollo, Chronos, Aion),
`H264_output` (default false, so H265). Output a single `video`.

Things the schema already tells us:
- **Always send `H264_output: true`.** The default is H265, which most browsers
  will not play in the Library.
- **Keep `target_fps` low** (the source's own rate, 24 to 30) unless there is a
  reason: fal bills the generated frames, so a 60 fps default costs more.
- fal's page lists `$0.30` at 1080p / `$0.60` at 4K for Apollo and `$0.50` /
  `$1.70` for Aion, with the unit unclear, and says extra frames are billed like
  interpolated frames. **None of this is trusted until the usage page says what
  a run billed.** For comparison, trim costs about $0.005 and captions about
  $0.10.

## Slice 0 (owner-run paid probe, before any code)

`scripts/probe-fal-slowmo.mjs` (`--schema` is free, default is a dry run,
`--submit` is paid and capped at 2 clips). Questions:

1. Does the output run `slowdown_factor` times longer (5 s at 2x gives 10 s)?
2. **Audio:** kept and stretched, silent, or dropped? A silent slow-mo clip is
   a product decision, and dropping audio changes how captions and the audio
   step compose with it.
3. Output size and frame rate against the input, and is it H264 with
   `H264_output: true`?
4. Time to finish, and whether the output serves directly (200, no redirect)
   from a host `copyUrlToR2` allows.
5. **Billed cost** per run for a 5 s clip at factor 2 and at factor 4, and
   whether a failed run bills.
6. Does a failed run (bad URL, host unreachable) arrive as a normal fal
   failure callback, and does the webhook verify as for captions.

## Shape, pending the probe

An optional per-clip `slow: 2..8` (or one edit-wide factor, to decide) on the
`clip-edit` input, run as a step between trim and merge, so a trimmed clip is
slowed before joining. One debit, refund on any failure, flag-gated like
captions. Pricing as units of its own in `editUnits` once the cost is known.
Output length grows by the factor, so the 60 s output cap and the price must be
checked against the slowed length.
