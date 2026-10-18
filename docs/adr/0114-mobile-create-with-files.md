# ADR-0114 — Mobile: Create with files

**Status:** Proposed 2026-10-18
**Related:** [ADR-0106](0106-mobile-app.md) (the app), [ADR-0028](0028-browser-upload-to-r2.md) (uploads), [ADR-0094](0094-explicit-generation-source-slots.md) (source slots), [ADR-0110](0110-mobile-account-and-safety.md), roadmap slice M10a

## Context

Create offered only models that need a prompt. The catalog also holds image-to-image, image-to-video, lip sync, upscale and background removal, which need a file from the person. The web app already does this through `POST /api/v1/uploads` and `source_keys` on `POST /api/v1/generations`.

## Decisions

1. **No server change.** The app uses the routes as they are. Bytes go from the phone straight to storage on a 15-minute presigned URL, never through the Worker.
2. **Which models appear.** Every open model whose file slots are all ones the app can pick for (`image`, `endImage`, `video`, `audio`) and that has something to send: a prompt, or at least one required file. Stem splitting is left out because the server refuses it unless its flag is on.
3. **Slots come from the catalog.** A model's `capabilities.media` says which files it takes, which are required, a label and a length cap. The form shows one picker per slot and a prompt box only when the model has a prompt input. A prompt is required only when no file is required (text-to-X); for edit and file-driven models it is optional.
4. **Picking.** Images and video come from the photo library picker, asked for in the form the server accepts (JPEG, H.264 MP4). Audio comes from the file picker. The app checks type, size and, where the phone reports it, length before uploading, using the server's allowlist and caps (20 MB image and audio, 100 MB video). The server judges every claim again and inspects the bytes before any provider sees them.
5. **Upload flow.** `POST /api/v1/uploads` with the type and size, then a PUT of the file with progress and a cancel. Generate stays off while a file is still being sent, so an optional file is never silently dropped. The generation sends `source_keys` as `{key, slot}` and `consent: true`, and says in words that the file goes to the provider.
6. **Permissions.** The library picker needs none. Saving to photos asks for add-only access at the moment the person taps Save, never read access. No camera or microphone access is requested.
7. **Result.** The job screen shows the stage and time so far, lets the person leave, offers Try again on the same model after a failure, and for a finished creation offers Save to photos (image, video) and Share (all) from a file downloaded to the cache. The asset link lasts 15 minutes and is never stored.

## Not decided here

- **Cancel a running job.** There is no server route for it (owner decision 2026-10-18: none in the first release). The job screen offers "Stop waiting", which only stops watching and opens the Library, and says the creation keeps running and credits are not refunded. Nothing implies the provider job is cancelled.
- Aspect ratio, resolution and seed controls; every model runs at its defaults.
- Picking a file from the person's Library of past creations as a source (a server capability, ADR-0094).

## Consequences

- Five new native modules (image picker, document picker, file system, sharing, media library), so this needs a new store build, not an over-the-air update.
- A file that is uploaded but never used is swept by the server after a day.
