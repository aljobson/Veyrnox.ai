# PRD addendum — Clip Editor slow motion

**Status:** Built behind `CLIP_EDIT_SLOW_ENABLED` (off in production; on in staging from 2026-10-09) · 0237 applied on production and staging · placeholder price, fal's invoice not read · not yet run end to end
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

## Slice 0 results (2026-10-09)

`scripts/probe-fal-slowmo.mjs` on the 5.04 s landscape clip (1280x720, 24 fps,
H264, AAC audio with a voice), factor 2, `target_fps` 24, Apollo, `H264_output`
true. The same command was run three times by mistake (the second and third
re-ran a stale copy of the script after a failed `cp`), so **three runs were
billed**: `01a121b7-797d-7b72-acb0-352dd2c8f50a`,
`01a121ba-9e31-7c51-9989-0e5e14692743`, `01a121be-f451-7b30-ab96-270f73fc00b5`.
The probe's cap of two clips is per invocation, not across invocations.

- **Length:** 5.04 s in, 10.04 s out (expected 10.08). Factor 2 does double the
  length.
- **Audio is not stretched.** The output file is 10.04 s but its AAC stream is
  still 5.04 s. The voice stays at normal speed and then stops, so the sound is
  out of step with the slowed picture for the second half. A slow-motion
  clip with its own sound would be wrong in the product as it stands.
- **Format:** 1280x720, 24 fps (the requested `target_fps`), H264: it plays in
  the Library. Resolution and codec are preserved.
- **Time:** 30 s, 55 s, 53 s for a 5 s clip, so allow about a minute, longer than
  captions (about 30 s).
- **Delivery:** `video/mp4`, served directly (200, no redirect) from
  `v3b.fal.media`, which `copyUrlToR2` allows. 7.4 to 7.5 MB for 10 s.
- **Not seen:** billed cost (usage page, three request ids), a failure callback,
  a longer clip, a portrait clip, factors above 2, and the other models.

### Audio step on a slowed clip (2026-10-09, `scripts/probe-fal-audio-merge.mjs`)

Stand-in clip with Topaz's exact shape (10.04 s of picture, 5.04 s of voice,
made locally with ffmpeg `setpts=2*PTS`), plus a steady 440 Hz tone, through
`fal-ai/ffmpeg-api/merge-audio-video`. Two runs were billed (the command was run
twice): `01a121ce-8079-7e33-a62f-3d6910388714` (13 s) and
`01a121d2-7e70-7851-8900-3e2698b9863a` (17 s).

- **The soundtrack replaces the clip's own sound.** Loudness of the output was
  -21 dB in every second, the tone's level, with no voice in the first 5 s
  (a mix would have been about 10 dB louder there; checked against a locally
  simulated mix and replacement). Output: 10.08 s picture, 9.98 s audio, 1280x720.
- Served directly (200) from `v3b.fal.media`; 13 to 17 s.
- So the unstretched audio from Topaz is **overwritten, not mixed**, once a
  soundtrack is laid over a slowed clip. The out-of-step sound only survives
  when a slowed clip has no soundtrack step after it.

### What it means for the build

1. **Slow motion works with what we have if a soundtrack is always laid over it.**
   Chain: trim, slow (Topaz), merge, audio (replaces the sound), captions. Two
   ways to avoid the broken sound when the user picks no soundtrack:
   - **v1 (recommended): require a soundtrack with slow motion.** The edit sheet
     says slowed clips cannot keep their own sound and asks for one. No new probe.
   - later: a silent track laid with the same step to mute it (not probed, but
     the result above says it would replace).
   Captions need speech in the final audio, so slow motion plus captions only
   makes sense when the soundtrack has speech (a music bed fails the captions
   step with `transcription_error`); the sheet must say so.
2. **Price is still unknown and could be high.** fal's page lists $0.30 to $0.60
   for Apollo and more for Aion, unit unclear, and the usage API needs an admin
   key (the key tried on 2026-10-09 was refused). Do not set a catalog price from
   the page. If built before the bill is read, use a deliberately high
   placeholder behind a flag, as the owner may choose.

## Shape, pending the probe

An optional per-clip `slow: 2..8` (or one edit-wide factor, to decide) on the
`clip-edit` input, run as a step between trim and merge, so a trimmed clip is
slowed before joining. One debit, refund on any failure, flag-gated like
captions. Pricing as units of its own in `editUnits` once the cost is known.
Output length grows by the factor, so the 60 s output cap and the price must be
checked against the slowed length.
