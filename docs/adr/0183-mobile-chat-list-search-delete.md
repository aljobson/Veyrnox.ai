# ADR-0183: Mobile chat list: search and delete (parity plan P3)

**Status:** Proposed 2026-10-19.

## Decision

- The chat list has a search box. It matches the title, ignoring case, as the web's list does (`visibleThreads`); a chat with
  no title is never a match, and an empty search shows everything. It works together with the folder chips and pinned-first order.
- Each row has a **Delete** button (44 pt, labelled with the chat's name). It asks first: the chat and its messages are
  removed and the credits it used stay spent (`DELETE /api/v1/chat/threads/:id`, which keeps the jobs and ledger rows).
  Cancelling leaves it; a failure says so and keeps the row.

## Not proved

Unit tests (search, the DELETE call). No device, VoiceOver or TalkBack run. The list does not search message text; neither does the web.

## Consequences

No new routes, flags, dependencies or server changes.
