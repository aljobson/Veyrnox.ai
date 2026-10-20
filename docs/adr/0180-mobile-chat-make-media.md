# ADR-0180: Mobile: make an image, video or sound from a chat (parity plan P3)

**Status:** Proposed 2026-10-19. Phone version of the web chat's media composer (`useChatMediaGeneration.js`).

## Decision

- A **Make** button in the chat's toolbar opens a compact composer: kind (Image, Video, Audio), a model list with each
  model's price, a length for video, the words, and a **Make, N credits** button. The price is on the button before
  anything starts; a started creation opens its result screen, as Create does.
- Only models that can honestly start from words alone are offered: open, a kind the app can show, a plain prompt, no
  required file. The cheapest is first. Editors, image-to-video, several-image batches and the camera, character and
  settings controls stay in Create, and the panel says so in words.
- It uses the same call as Create (`mediaApi.createGeneration`): offline check, AI consent, `confirmed_credits` equal to
  the catalog price (the server refuses any other number), and an idempotency key kept per request so a retry after a
  dropped connection is charged once.
- A chat's own text is carried in as the starting prompt. Studio draft cards still open Create with the model and words.

## Not proved

Unit tests (model filter, price, length, retry key). No device, VoiceOver or TalkBack run, and no live start. The free
allowance (`useFreeLeft`) is not read here, so a free image is still shown at its catalog price and the server decides.

## Consequences

No new routes, flags, dependencies or server changes.
