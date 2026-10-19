# ADR-0156: Mobile chat image attachments and Studio skills (parity plan P3, slice 3)

**Status:** Proposed 2026-10-19. Third slice of the Chat lane, after ADR-0154 and ADR-0155.

## Context

The web chat takes up to four images per reply (ADR-0068) and starts Studio skills (ADR-0073): instructions copied onto
a new chat that end in a draft the person opens in Create. The phone had neither.

## Decision

**Attachments**
- Up to four images (`max_attachments` from the models route), from the Library (by the id of the job that made it,
  already in storage, nothing uploaded) or from the phone. Sent as `attachments: [{ source_key } | { source_asset }]`.
- The model's `options.images.extra_credits` is added once when any image is attached, and shown on the attach strip and
  the Send button before sending. A model that does not offer it hides the strip.
- Phone photos are uploaded before any charge (`/api/v1/uploads`), so a failed upload costs nothing.
- The attachment list is part of the idempotency key's identity: the same text with different images is a new send.
- **Resize is not built.** The web redraws every image on a canvas: scaled to a 2048 px long edge (the server refuses
  more) and re-encoded, which also drops the EXIF block (camera, time, GPS). On the phone that needs
  `expo-image-manipulator`, which is **not installed** and was not added. `ImageResizer` is the one seam; the default
  refuses (`resize_unavailable`), so **a phone photo is never sent unprepared** and the screen says an app update is
  needed. Library images are unaffected.

**Studio skills**
- The eight Studio skills (Prompt writer, Bring it to life, Fix my prompt, Fix this photo, Edit with words, Add sound,
  Model picker, Storyboard) are listed on the New chat screen, grouped Make / Edit / Plan. Film skills are not built.
- Choosing one creates a chat on `chat-gpt-6-luna` (or the first open model), sets its instructions with
  `PATCH chat/threads/:id { system_prompt }`, with the live model list appended, and opens it with the skill's starter
  as the placeholder.
- A reply's ```studio blocks become **Open in Create** cards, checked against the live catalog (known open model that
  takes a prompt, non-empty prompt) with the price read from the catalog, never the text. The card opens
  `/create/[modelId]?prompt=`. Nothing is made or charged until Create is pressed, where its price shows first.
- Skill names and blurbs are English data from the web file, not new catalog strings.

## What the resize needs (owner decision)

Add `expo-image-manipulator` (Expo SDK 58 build, `npx expo install expo-image-manipulator`). It is a native module, so
it needs a new native build, not an OTA update. Then implement `ImageResizer.prepare` with
`manipulateAsync(uri, [{ resize }], { compress: 0.9, format: JPEG })` (the re-encode drops EXIF) and pass it to
`pickPhotos`. Real-phone checks S5 and S6 in `docs/mobile/PARITY-2026-10-19.md` section 7 cover it.

## Not proved

- Mock server and unit tests only. No simulator, device, VoiceOver or TalkBack. Library thumbnails fetch one asset link
  per tile (15-minute links) and were not load-tested.
- The Library tile list reads the first page of jobs only.

## Consequences

No new routes, flags, dependencies or server changes.
