# ADR-0068 — Chat image attachments: transient, owner-keyed, priced as an option

- **Status**: **Accepted 2026-10-05** with the repository's own defaults. The owner answered the questions below with "go with what Syntx does"; Syntx's limits and retention are not public, so the defaults here stand and are what was built. Change them in a new ADR.
- **Related**: ADR-0067 (chat), ADR-0028 (browser upload to R2), ADR-0035 (upload rate limit), ADR-0044 (upload budgets, proposed), CLAUDE.md "Object storage (R2)"

## Context

Syntx's LLM Studio lets a user attach images to a chat (public description). Veyrnox.ai already has the hard parts of
getting an image from a browser to a model safely:

- `POST /api/v1/uploads` signs a 15-minute PUT for one key under `uploads/{auth_id}/` and one Content-Type, behind a
  rate limit; the generations route later checks ownership and the magic number against the declared type.
- ADR-0044 bounds what an account can hold (10 pending uploads, 200 MiB), and its sweeper deletes a consumed upload
  once its job is at least 16 minutes old.

So an upload today is a **transient source file for one job**, not durable storage. A chat attachment is the same
shape: one reply (one job) uses it, then it is swept.

## Decision (proposed)

1. **Images only in v1**: PNG, JPEG, WebP. At most 4 per reply. The size limit is the upload route's existing 20 MiB per image, and
   the **long edge is capped at 2,048 px**, because cost follows pixel size (one provider read 4,929 input tokens at 2,048 px and
   19,674 at 4,096 px). The browser scales a bigger picture down before upload; the server refuses one that is still over.
2. **Reuse the upload path.** The browser uploads on Send, before the debit (ADR-0028), so a failed upload charges nothing.
   The turn body gains `attachments: [{ source_key }]`. The server accepts only keys under the caller's own prefix, checks
   the object exists, its size and its magic number against the declared type, and never accepts a URL from the client.
3. **The model sees a short-lived link, not our bucket.** For each attachment the server mints a presigned GET with a
   TTL of 15 minutes or less (the repository ceiling) and sends it as an `image_url` content part. The key is never
   sent to the provider.
4. **A priced option, like Thinking and Web search.** A row offers `Images` only when `chat_images_extra_credits` is set, with
   its recorded worst-case `chat_images_extra_cost` under the same margin-floor CHECK (migration 0198). The extra is flat per
   reply with at least one image, sized for 4 images at the 2,048 px edge from a live measurement per model (about 20% added,
   rounded up): Claude Sonnet 5.5 3 Credits, Claude Opus 5.5 6, GPT-6.1 Sol 3, Grok 4.7 3, and 1 Credit for GPT-6 Luna,
   Gemini 3.8 Flash, DeepSeek V4.1 Flash, Llama 4 Maverick, Mistral Small and Ministral 14B. All ten rows were measured.
5. **Transient in the chat.** The job records the keys under `inputs.source_keys`, so the existing upload sweeper deletes the
   files soon after the reply (and by age within 24 hours at the latest). The thread keeps only the type and pixel size of each
   image, returned on the user message by `chat_get_thread`, never a file name or a key. Durable storage is a separate decision.
6. **Disclosure.** An image can carry personal data (faces, documents, EXIF location). While images are attached the composer
   says: "Images are sent to the model provider to answer, and are deleted from our storage within a day." Veyrnox.ai does not
   scan content, and does not strip EXIF.
7. **No other types.** PDFs and documents need text extraction and their own cost model; audio and video are out of scope.

## Amendment 2 (2026-10-06): the person's own Library images

An attachment may now be one of the caller's own finished Library images, named by the id of the job that made it:
`attachments: [{ source_asset: <job id> }]` beside `{ source_key }`, four images in all. Chat is built around what the person
already made, so asking about or working from a Library image must not mean downloading and re-uploading it.

1. **Same checks as an upload, and the same pattern as the studio's From library.** `resolveAssetSource` runs `get_user_asset`
   (the caller's own, state `STORED`, not past `asset_expires_at`; another person's job reads exactly like one that does not exist),
   then the bytes pass the same Gate 2 as an upload: really an image, within the 2,048 px edge. Images only. No new access path,
   no new signing code, no migration.
2. **Never recorded where the sweeper looks.** An upload key goes under `inputs.source_keys`, which the upload sweeper deletes. A
   Library asset goes under `inputs.source_assets` and **never** under `source_keys`: the sweeper must not be able to delete a
   file the person still owns. A test pins this.
3. **Priced and refunded like any image.** One `Images` extra per reply with at least one image, however many, from either source.
4. **The size cap is said up front.** The server cannot shrink a stored asset the way the browser shrinks a chosen file, so the
   picker reads the image's size and, over the cap, says so and suggests a smaller image or a resized download.
5. **Disclosure.** The image goes to the model provider to answer, as with an upload, but it stays in the Library. The composer and
   the privacy notice say so: uploads are deleted within a day, Library images stay in the Library.
6. **Out of scope.** Video and audio (chat reads images only); saving a chat reply to the Library; creating from a chat reply.

## Amendment 3 (2026-10-06): a video as a few frames

Chat still reads images only. A video the person chooses with the paperclip is attached as up to four still frames taken in their own browser
(`videoFrames.js`: the middle of each of N equal parts of the clip, drawn no larger than 1,280 px on the long edge, as JPEG), and from there each
frame is an ordinary upload: the same checks, the same 2,048 px cap, the same one Images extra however many, and the same deletion within a day.

1. **The video is never uploaded.** Only frames leave the device. MP4, WebM and MOV by declared type; whether the browser can decode it decides the rest, and
   an unreadable clip says so and costs nothing.
2. **Frames use the same four slots.** A clip needs room for at least two images; it takes as many of the four as are free, up to four. One clip per pick.
3. **It cannot judge motion, timing or sound**, and the composer says only that a few frames are used. Real video input is a separate decision that needs its own
   measured price per model (a video is many times the input tokens of an image) and its own limits.
4. **Disclosure.** The composer adds "Your video is not uploaded: only a few frames from it, taken on your device, are", and the privacy notice says the same.

## Consequences

- No new bucket, no new signing code: the work is the turn body, one resolver, one adapter change (content parts),
  one catalog migration and one composer control.
- A thread cannot be re-sent with its old images after the sweep. Regenerate on an old thread loses them, by design.
- Free Credits apply like any Credit.

## Questions that were open (answered by deferring to Syntx; defaults applied)

1. Which models get image input first (it needs a live per-model price check)?
2. Limits: 4 images and 5 MB each, or different?
3. Is "transient, shown as no longer stored" acceptable for v1, or must attachments persist (which means a retention
   policy, deletion on thread delete, and a moderation decision first)?
4. The disclosure wording, and whether it needs a privacy-policy change.
5. ADR-0044's budgets are still "Proposed, activation pending". Chat attachments lean on them; should they be
   activated first?
