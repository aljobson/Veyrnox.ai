# ADR-0153: Mobile Create options (parity plan P2, slice 1)

**Status:** Proposed 2026-10-19. The number follows 0148; three open PRs also took 0149, so this one skips ahead.
Renumber if it collides again.

## Context

The web Create page is one screen: a goal (image, video, audio, all), a price tier, a live price list with a free
option, an aspect ratio, one to four images, Settings (seed, "Leave out") and a restored draft. The phone had a
kind tab and a model list, then a form with a prompt, files and a clip length.

## Decision

All of it comes from data the public catalog already returns. `GET /api/catalog` carries `capabilities.inputs`
for every model: `seed`, `negative_prompt` (with `max`) and `aspect_ratio` (with `values`). The phone reads the
same record the web does (`app/veyrnox/_lib/useCatalog.js`); a control appears only for an option the model
declares. **No server change is needed for this slice.**

- **List** (`(tabs)/create`): four goals (Make an image, video, audio, All models), then Any price / Low /
  Medium / High. Tiers are thirds of the goal's distinct prices, as on the web (`lib/createOptions.ts`, a port of
  `_lib/modelTiers.js`). A model with free runs left shows `FREE, N left` in place of its price.
- **Form** (`create/[modelId]`): aspect ratio and image count (1 to 4, image models only) as chips, and a
  Settings block with seed (digits, 0 to 2147483647, Roll) and Leave out (the model's own limit, 2000 by default).
- **Price before Generate, including the count.** One image: the existing "Costs N credits" line. Several: the
  catalog price times the count; the first free runs of a batch are taken off ("2 of 4 images are free today").
  The button says "Generate 4 images" and its accessibility label carries the price. When it is all free the line
  says so.
- **Several images are several generations**, as on the web: each has its own idempotency key, charge, refund and
  job, sent one at a time. Every request sends the catalog price as `confirmed_credits` (the server compares it
  with its own quote, not with the free-adjusted total). A set seed moves by one per image so the images differ.
  A failure stops the rest and says how many started. A retry reuses the same keys, so the ones already started
  are not charged again. After a batch the person lands in Library; a single image still opens its result.
- **Offline:** unchanged. `createGeneration` refuses to start without a connection and shows the offline message.
- **Draft:** the words, length, shape, count, seed and Leave out are saved 600 ms after a change under the cache
  prefix (`createDraft` policy, seven days, per account), so sign-out, account deletion and a change of user wipe
  them. One draft per account; a different model replaces it. No file, key or token is saved, so restoring never
  re-sends or re-charges anything. A template (which brings its own prompt) is not overlaid with an old draft.
  "Restored your unsent draft." appears with Clear draft; a successful send clears it.
- Free runs left come from `GET /api/v1/free-allowance` (ADR-0124), read once by `useFreeLeft` and shared by
  the "Free today" card and the rows. Off, signed out or a failure means catalog prices only.

## Not in this slice

- **Cinema camera** and Character panels (prompt builders on the web) and **voice description / audio length**
  for speech models. Their catalog fields (`voice_description`, `duration`) exist; they are a later slice.
- **Output resolution and audio on/off** (`output_resolution`, `audio_enabled` in the catalog).
- Ordering by anything but price.

## Not proved

- Checked with `tsc` and Jest only (owner disk rule: no Metro or simulator). **Not seen on a phone**, and not run
  against the mock server. Text size, VoiceOver and TalkBack on the new chips are unchecked.
- The free-allowance total is a prediction. The server decides, and a job it makes free reports `free_allowance`.
  The phone does not yet read that field, so a result may show a higher price than was taken.
