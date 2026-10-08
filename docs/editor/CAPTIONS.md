# PRD addendum — Clip Editor captions

**Status:** Live behind `CLIP_EDIT_CAPTIONS_ENABLED` (production flag on 2026-10-08 at the owner's request) · 0225 applied on production and staging · edit sheet still hidden behind `localStorage.veyrnox_editor_captions` · fal's invoice for the probe and staging runs not yet checked
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
- **Run 4, 15.17 s landscape clip (speech)** (request
  `01a11872-c976-7332-bdf5-7e3ee5bd0036`): succeeded in 31 s, the same time
  as the 5 s clip, so run time doesn't scale with length at these sizes.
  Duration preserved (15.17 s), 1280x720, AAC audio kept. Output frame rate
  came back as a clean 24/1 from an input of 2178/91 (about 23.93, an
  artifact of looping the test clip), so the step re-encodes and normalises
  the frame rate; it does not copy streams.
- Probe `--video-file` upload to fal storage works (files land on
  `v3b.fal.media/files/...`).
- **Webhook (run 5, `scripts/probe-fal-webhook.mjs`)** (request
  `01a11880-df99-7a62-95b2-240e877c245f`): `veed/subtitles` delivers a normal
  fal queue callback when submitted with `?fal_webhook=`. All four signature
  headers were present and the delivery **verified with the Worker's own
  `verifyWebhookSignature`** (Ed25519 via JWKS), so the existing
  `/api/webhook/fal` path can take it with no new verifier. Body keys: `error`,
  `gateway_request_id`, `payload`, `request_id`, `status` (`OK`); `request_id`
  matched and `payload.video.url` was present. The probe took the expected
  user id from the header itself, so it proved the signature, not the tenant;
  the Worker's `FAL_WEBHOOK_USER_ID` check still applies as usual.
- Not tested: what the callback looks like for a **failed** job (the
  no-speech case). Expect `status: ERROR` with the 422 detail in the body, but
  the handler must be checked against a real failure before it is trusted to
  refund.
- Still unmeasured: **billed cost** (usage page, for the five request ids; in
  particular whether the failed no-speech run was billed, which decides whether
  a captions step can burn money on a refund). Four runs with placeholder links
  were rejected by fal and should not have been billed.

## Staging results (2026-10-08)

Flag on in staging (version `b5d0d1fd`), 0225 and 0226 applied there; driven in
the staging Library with the edit sheet's Add captions switch.

- **No audio track** (Hailuo 02 clip, 5.88 s; job `5011ee8d-972f-4957-aa47-6c29c97f83df`):
  debited 7, the captions step submitted to `veed/subtitles`, fal failed it,
  and the handler failed the step (`provider_failed`, 1 attempt, no retry),
  failed the parent (`captions_failed`) and refunded once. Ledger: 2 rows, net
  0; balance restored. The Library shows it as Failed, Refunded, +7 cr. This is
  the first real failure callback through the handler, and it behaved as
  designed. It settled in under a minute, so it came by webhook, not the sweep.
  A clip with an audio track but no speech (run 3 on fal) is the other flavour
  and was not run through the Worker.
- **Speech** (Veo 3.1 Lite clip, 8 s; job `4b9d2fe0-c58d-4d15-a8dd-9a3332c6401b`):
  debited 7, one captions step, STORED at `edits/<job>/captions-0.mp4` in 50 s,
  1280x720, 8 s, with the speech burned in as captions ("Today we are making
  fresh"). Ledger net -7.
- The price shown in the sheet matched the debit in both runs (7 credits for a
  single clip with captions only).

Still open before production: fal's invoice for the probe and staging runs, and
the 24 h reconcile check.

## Production runs (2026-10-08)

Flag on in production; driven in the pane signed in as the owner, on the
5.04 s octopus clip (speech):

- Job `3b3bf427-19e6-4986-9c4c-b00bfa26fa89`: failed in 8 s, refunded once. fal's
  reason, read with the production key from the request, was
  `host_unreachable` ("Could not reach the host that serves your video URL").
  The handler had kept only "fail", so the reason was invisible.
- Job `b1cd758e-467e-4168-a30b-9f0418899a92`: same clip, same path, succeeded in
  51 s; captioned, 1280x720, ledger -7. Reconcile checks clean afterwards.
- So `host_unreachable` is transient. The webhook and the sweep now keep that
  reason, and a captions step retries once on it (nothing else is retried).

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

## Built (2026-10-07)

- `lib/clipEdit.js`: `captions` step (`veed/subtitles`), `CAPTION_PRESETS`,
  `CAPTIONS_UNITS = 7` in `editUnits`, no retry on a failed captions step.
- `lib/clipEditSources.js`, `additionalModelCapabilities.js`, the gateway:
  `captions: { preset }` input, checked at the boundary; refused with
  `captions_unavailable` while `CLIP_EDIT_CAPTIONS_ENABLED` is not "true".
- Migration `0225_clip_edit_captions_step.sql`: adds the step kind. Tested on a
  real Postgres in four cases (from 0092's list, after 0224's list, rerun,
  missing constraint).
- Edit sheet: "Add captions" and a style pick, behind
  `localStorage.veyrnox_editor_captions = "1"`.
- ADR-0029 addendum records the pricing rule and the flags.

### Before the flag goes on
1. Check fal's invoice for the probe runs. If the 5 s run billed more than
   about $0.12, or the failed no-speech run was billed, revisit
   `CAPTIONS_UNITS` and the refund cost.
2. Apply 0225 (owner approves the `apply-migrations` run). If PR #618's 0224
   is still open, apply it first or renumber: both rewrite
   `job_steps_step_check`, and 0224 restates a fixed list that would drop
   `captions` if it applied after this one.
3. ~~Look at a real failed-callback payload against the handler~~ Done on
   staging 2026-10-08 (see Staging results).
4. Reconcile jobs clean for 24 h, then flip on staging, then production.

## Open questions

- Can the app tell before submit that a clip has no speech? (a failed run may still be billed)
- Caption language: auto-detect only, or a picker?
