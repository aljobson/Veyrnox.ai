# ADR-0068 — Chat image attachments: transient, owner-keyed, priced as an option

- **Status**: Proposed 2026-10-05. Needs the owner's answers to the questions at the end before any code.
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

1. **Images only in v1**: PNG, JPEG, WebP. At most 4 per reply, at most 5 MB each (the upload route allows more).
2. **Reuse the upload path.** The browser uploads on Send, before the debit (ADR-0028), so a failed upload charges nothing.
   The turn body gains `attachments: [{ source_key }]`. The server accepts only keys under the caller's own prefix, checks
   the object exists, its size and its magic number against the declared type, and never accepts a URL from the client.
3. **The model sees a short-lived link, not our bucket.** For each attachment the server mints a presigned GET with a
   TTL of 15 minutes or less (the repository ceiling) and sends it as an `image_url` content part. The key is never
   sent to the provider.
4. **A priced option, like Thinking and Web search.** A row offers `Images` only when `chat_accepts_images` is set and
   an extra is priced (`chat_images_extra_credits` with its recorded worst-case `chat_images_extra_cost`, under the same
   margin-floor CHECK). The extra is flat per reply with at least one image, sized for 4 images at a measured worst-case
   token count per model. Needs a live measurement per model before pricing; none is assumed here.
5. **Transient in the chat.** The message stores `attachments` as name, kind and size only. Once the sweeper deletes the
   file the thread shows "image attached (no longer stored)". Durable storage is a separate decision.
6. **Disclosure.** An image can carry personal data (faces, documents, EXIF location). The composer says once, next to
   the attach control, that images are sent to the model provider to answer. Veyrnox.ai does not scan content.
7. **No other types.** PDFs and documents need text extraction and their own cost model; audio and video are out of scope.

## Consequences

- No new bucket, no new signing code: the work is the turn body, one resolver, one adapter change (content parts),
  one catalog migration and one composer control.
- A thread cannot be re-sent with its old images after the sweep. Regenerate on an old thread loses them, by design.
- Free Credits apply like any Credit.

## Questions for the owner

1. Which models get image input first (it needs a live per-model price check)?
2. Limits: 4 images and 5 MB each, or different?
3. Is "transient, shown as no longer stored" acceptable for v1, or must attachments persist (which means a retention
   policy, deletion on thread delete, and a moderation decision first)?
4. The disclosure wording, and whether it needs a privacy-policy change.
5. ADR-0044's budgets are still "Proposed, activation pending". Chat attachments lean on them; should they be
   activated first?
