# PRD addendum — Clip Editor captions

**Status:** Draft · 2026-10-07 · Slice 0 (live probe) not run
**Extends:** [PRD.md](PRD.md). Where they disagree, CLAUDE.md and the ADRs win, then PRD.md.

## Decision log

- **OpenCut rejected again (2026-10-07).** `opencut-classic` is archived and
  `opencut-app/opencut` is a rewrite with no Editor API yet (see PRD.md,
  "Why not OpenCut"). The Clip Editor keeps growing on `job_steps`.
- **First new edit: captions.** Chosen over letterboxing, speed and
  transitions.

## Scope

Add one optional step to the existing chain: **captions**, burned into the
final video. Chain order becomes trim -> stitch -> audio -> **captions**, so
captions are transcribed from the audio the viewer actually hears.

Still out: uploaded media, a multi-track timeline, translation, hand-edited
caption text (v1 is auto-transcribed with a style preset only).

## Candidate provider step (unverified)

`veed/subtitles` on fal: video URL in, transcribed and styled MP4 out.
Reported price: $0.10/min input for basic styles, $0.20/min for dynamic
styles, x2 above 1080p, 1 minute minimum. Sources disagree on a translation
surcharge, so v1 doesn't offer translation.

Nothing here is verified. Per CLAUDE.md, a model is only `active = true` once
its `provider_endpoint` is checked live.

## Slice 0 (owner-run paid probe, before any code)

Following the existing probe-script pattern (silent `read -s` key prompt):

1. Endpoint id, input schema, and whether it is queue + webhook (needs a
   signed webhook, like the other steps) or poll-only.
2. Behaviour on a 5 s, 15 s and 60 s clip, portrait and landscape.
3. Does it keep aspect ratio, audio and frame rate? (merge-videos did not.)
4. Billed cost per run against the price above; the 1-minute minimum makes a
   5 s clip cost the same as a 60 s one.
5. Clip with no speech: error, empty captions, or charge?

## Slice 0 findings so far (2026-10-07)

- `veed/subtitles` takes `video_url` + required `preset` (30 values) on the
  queue API (`queue.fal.run/veed/subtitles`) and returns a request id.
- Input is validated when the result is fetched, not at submit: a bad URL
  submitted fine and failed with a 422 `url_parsing` on the result. The
  orchestrator must treat a 422 at result time as a failed step, and must
  validate URLs itself first.
- **Run 1, 5.04 s landscape clip, `simple` preset** (request
  `01a1185b-2e85-7311-b684-1f8a46b63940`): succeeded in 31 s. Output
  `video/mp4`, 3.1 MB, served directly from `v3b.fal.media` with a 200 and no
  redirect, so `copyUrlToR2` can take it. Input and output both 1280x720,
  24 fps, 5.04 s, AAC audio: size, frame rate, duration and audio are
  preserved.
- The result is a single `video` file. Nothing else came back (no transcript
  or SRT), so v1 can't offer caption text editing.
- **Run 2, 5.04 s portrait clip (720x1280, speech)** (request
  `01a11865-5325-7363-b212-cec4f66d3da2`): succeeded in 26 s. Output
  720x1280, 24 fps, 5.04 s, AAC audio: **no distortion**, unlike
  `merge-videos`. Portrait is fine.
- **Run 3, 5.04 s clip with a tone and no speech** (request
  `01a11865-c74a-7c40-8ee4-677a57cade1a`): the job was accepted, then failed
  at result time with a 422 `transcription_error`: "No speech detected in the
  video, or the audio was unintelligible to the transcriber... or provide
  srt_content directly." So a speechless clip is a hard failure, not an empty
  captions pass-through. Decision: it is a failed step and the whole edit is
  refunded (PRD section 5 step 7). The edit sheet should warn before submit
  when it can't tell there is speech; the error text above is not shown to the
  user verbatim.
- Probe `--video-file` upload to fal storage works (files land on
  `v3b.fal.media/files/...`).
- Still unmeasured: **billed cost** (check the usage page for the three
  request ids; in particular whether the failed no-speech run was billed, which
  decides whether a captions step can burn money on a refund), a 15 s clip, the
  webhook signature. Four runs with placeholder links were rejected by fal
  and should not have been billed.

## Pricing (proposal, pending Slice 0)

Same rule as PRD section 6: one `clip-edit` row, one debit, app never sums
step prices. Captions add a step, so they raise `editUnits` (step floor) and
must clear the ADR-0014 floor given the 1-minute minimum. Expect to need a
separate catalog row or a captions surcharge unit; decide after the measured
cost.

## Slices after Slice 0

1. Migration (next free number on `main`; check open PRs first): add the
   `captions` step kind to `job_steps`, with the DO-block row-count assertion
   for any catalog UPDATE.
2. Orchestrator + `lib/clipEdit.js` + `lib/clipEditSources.js`: new optional
   `captions: { style }` input, validated at the boundary.
3. Edit sheet: "Add captions" toggle and style picker, price updated live.
4. Behind a flag until the reconcile jobs run clean for 24 h.

## Open questions

- Can the app tell before submit that a clip has no speech? (a failed run may still be billed)
- Caption language: auto-detect only, or a picker?
