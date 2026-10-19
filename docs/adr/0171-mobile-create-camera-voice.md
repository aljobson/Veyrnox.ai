# ADR-0171: Mobile Cinema camera, voice description and audio length (parity plan P2)

**Status:** Proposed 2026-10-19. Stacked on ADR-0153 (Create options, PR #1338): it extends the same form.

## Context

Three Create inputs from the web were missing on the phone. Speech models declare `voice_description` (required);
without it a phone request is refused by the server (`inputs_invalid`). Some audio models declare an integer
`duration` range. Image and video models get the web's Cinema camera panel, which only rewrites the prompt.

## Decision

All from the public catalog (`capabilities.inputs`); no server change.

- **Voice**: a required "Voice" field (up to 500 characters, words only, no recording) for models that declare
  `voice_description`. Generate waits until it is filled.
- **Audio length**: a whole-seconds field for models that declare `duration` as an int range; empty sends the
  model's default, a value outside the range is refused on the phone with the range shown.
- **Cinema camera**: a switch and four rows of choices (camera, lens, focal length, aperture) for image and video
  models that take `prompt`. On, the prompt sent is the person's words plus the web's camera sentence, cut from the
  words and never from the camera text so it fits 2000 characters. The model and price do not change.
  `lib/cinemaCamera.ts` is a copy of `app/veyrnox/_lib/cinema.js`; `__tests__/cinemaCamera.test.ts` reads that file
  and fails when the tables or default differ.
- The saved draft (ADR-0153) also keeps voice, length and the camera choice. A draft saved earlier reads back with
  the defaults.

## Not in this slice

- **Character panel.** The web builder is `_lib/character.js` (764 lines) plus `characterOptions.js` and Oddling
  data. Importing it is plan item S4 ("import shared web logic") and the Oddlings lane owns the same data; a copy
  here would drift. Needs a decision on one shared module.
- **Draw-on-image** (plan item S7, mask to PNG at source size) needs a drawing surface; the app has no canvas
  library, so it needs a dependency decision first.

## Not proved

`tsc` and Jest only (owner disk rule). Not seen on a phone or run against a real server. The voice and length
fields were checked against `lib/modelCapabilities.js` and the web's `generationSettings.js`, not against a live
speech model.
