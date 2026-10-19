# ADR-0157: Mobile sound under video and stem splitting (parity plan P2, slice 3)

**Status:** Proposed 2026-10-19. Renumber if it collides with another open mobile ADR.

## Context

ADR-0134 left two follow-ups: "stem splitting ... need their own routes confirmed". Both exist on the server.

## Decision

- **Sound under the video.** `POST /api/v1/generations` for `clip-edit` already takes
  `inputs.audio = { asset_id, offset_s }` (`lib/clipEditSources.js`: the asset must be a stored `audio/*` file of the
  caller, else `audio_not_audio`; the offset must be inside the video, else `audio_invalid`). Quick edit gets an "Add
  sound under the video" step: pick one of your audio creations (kind from the cached catalog), set where it starts
  (0.5 s steps, always before the end), remove it. The quote, review line and send carry it; the price still comes
  from the server's quote. A whole clip with sound is an edit, not "nothing to do".
- **Stem splitting.** The model (`demucs-stems`, `capabilities.outputStems`) was hidden from the phone. The server
  gates it in the public catalog and answers `audio_stems_unavailable` (503) before any charge while
  `EDITOR_AUDIO_STEMS_ENABLED` is off, so the phone now lists it like any model that needs an audio file (the audio
  slot and price flow are the existing ones). The result screen reads `output_stems` from
  `GET /api/v1/jobs/:id/asset` and shows six tracks (vocals, drums, bass, other, guitar, piano), each with Play and
  Share, fetching `?stem=<label>` when used. Only the six known labels are shown or put in a file name.

## Not in this slice

Slow motion (server flag `CLIP_EDIT_SLOW_ENABLED` is off in production; it also needs a soundtrack), saving stems
to Files, and mixing stems back.

## Not proved

`tsc` and Jest only (no Metro, simulator or mock server, per the owner disk rule). Not run against a real server:
the live state of `EDITOR_AUDIO_STEMS_ENABLED` was read from `wrangler.jsonc` only. Playing a stem opens the system
browser on the link, as audio results already do. VoiceOver and TalkBack unchecked.
