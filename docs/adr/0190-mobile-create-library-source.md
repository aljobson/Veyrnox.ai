# ADR-0190: Mobile: use a Library creation as a Create file (parity plan P2)

**Status:** Proposed 2026-10-19. Branched from main; independent of the Create camera/character PRs.

## Context

On the web a Create slot (image, last frame, video, audio) can take one of your own creations from the Library. The
phone only offered the phone's photo library and Files, so reusing something you had just made meant saving it and
uploading it again.

## Decision

No server change. `POST /api/v1/generations` already takes `source_assets: [{asset_id, slot}]` beside `source_keys`
(`lib/generationSources.js`: at most two files in all; ownership, kind, expiry and the model's slot are checked
there, and `consent: true` is required as for any file sent to a provider).

- Each file slot gets "Choose from Library" under the upload button. It opens a sheet of the person's finished,
  stored, unheld, unexpired creations of the kind the slot needs (kind from the cached catalog), newest first, with
  paging. Choosing one marks the slot ready ("From your Library: <name>").
- A slot has an upload or a Library file, never both: choosing one clears the other.
- The request sends `source_assets` with `consent` (the stored AI agreement, as for uploads). The idempotency
  signature includes the chosen creations, so a changed file is a new request.
- Library files are not copied or uploaded, so nothing goes through the 15-minute asset link.

## Notes

- `Job` gains optional `held` and `asset_expires_at` (the list already returns them), with the same text as the
  Library PR (#1344) so the two merge cleanly.
- The picker lists only what the first pages hold; "Show older creations" loads more.

## Not proved

`tsc` and Jest only (owner disk rule); not seen on a phone and not run against a real server. Whether a given model
accepts a Library file in a given slot is the server's answer, shown through the existing source errors.
