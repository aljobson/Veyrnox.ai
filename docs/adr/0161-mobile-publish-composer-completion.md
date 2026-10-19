# ADR-0161 — Mobile: Publish composer completion and disconnecting an account

**Status:** Proposed 2026-10-19
**Related:** [ADR-0122](0122-mobile-publish-composer.md) (the composer), [ADR-0140](0140-mobile-publish-connect.md) (connect), [ADR-0109](0109-mobile-publish-plan-and-store-catalog.md), parity phase P5 in `docs/mobile/PARITY-2026-10-19.md` section 4

## Context

ADR-0122 built a composer with one creation and one global text. The parity audit lists what the web composer has that the phone lacks: text per network, YouTube visibility, several media items, a queue choice, and disconnecting an account (ADR-0140 told people to use the web).

## Decisions

1. **Text per network.** Each chosen network gets an optional text box with its character limit. Empty means the main text is used. Only non-empty text for chosen networks is sent as `networkText`. A text over its network's limit is refused before sending. The server stays the authority: `variants_not_open` (flag), `variants_not_configured`, and the 402 `platform_variants` (Publish Plan) have their own messages.
2. **YouTube visibility.** Shown only when a chosen account is YouTube. Private is preselected, so a person must choose Unlisted or Public on purpose. Sent as `youtubeVisibility`; `youtube_visibility_not_open` has its own message.
3. **Several media items: not built.** `postCapabilityError` in `lib/social/postCapabilities.js` refuses any post with `media.length !== 1` for every network (`unsupported_media_type`). A multi-select would only ever produce that error, so the phone keeps one creation per post until the server accepts more. Recorded as a server gap.
4. **Queue choice.** A third "When" choice, "Next queue slot", is offered only if `GET /queues` answers with at least one enabled queue (it answers 404 `queues_not_open` while the flag is off, and then nothing is shown). The person picks a queue; its accounts replace the account choice (read-only, and all must take the creation's media type). A dialog names the queue and the accounts before anything is sent. Sending is three calls under one idempotency key: `POST /queues/reserve` (the slot and its accounts), `POST /posts` at the slot's time, `PATCH /queues/reserve` to confirm. A retry repeats all three safely. If the post was created but the confirm failed, the key is kept (a retry is a no-op on the post and confirms the slot). A definite refusal before the post leaves a reserved slot unconfirmed; the server owns releasing it.
5. **Disconnect.** `DELETE /accounts/:id` from a button on each account row, behind a system dialog that names the account and its network. The row leaves the list on success. The button has a 44 pt target and its label names the account.
6. **Draft key.** The signature now covers the network text, the visibility and the queue, so changing any of them is a different post.
7. No server change, no dependency, no flag.

## Consequences

- Proved against the dev mock server only (it now serves one queue, reserve and confirm, and remembers a disconnect). Nothing was posted to a real network and no queue was reserved on a real server.
- Server gap: more than one media item per post.
- A queue's slot times are shown in the queue's time zone (not the phone's); the post list shows the phone's.
