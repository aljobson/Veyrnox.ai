# ADR-0155: Mobile chat Stop, ask again, rename and pin (parity plan P3, slice 2)

**Status:** Proposed 2026-10-19. Second slice of the Chat lane, after ADR-0154.

## Context

A phone chat that could not be stopped, renamed or pinned, and that treated a dropped connection as "not charged",
was behind the web (ADR-0067 amendments 10 and 11): the server finishes and charges a turn after the reader has
gone, so "the request failed" is not "nothing was charged".

## Decision

- **Stop** replaces Send while a reply streams. It aborts the stream; the server keeps what had been written and
  charges it. The phone then looks for the turn (`lib/chatStop.ts`, a port of `app/veyrnox/_lib/chatStop.js`):
  by the job id from the `start` event, or, if Stop came before `start`, by asking `POST /api/v1/chat/sends/close`
  with the send's key. `closed: true` as the whole answer means no job exists and none can: nothing was charged.
- The same look runs after a dropped connection or a request that got no answer. A server refusal (any HTTP
  status) made no reply and is told as such.
- Endings and their words (each says whether credits were used): saved (kept, charged; the chat is read again
  for the real reply and price), unsaved (charged, not stored), nothing (no credits; the message returns to the
  box), pending (still checking; what arrived stays on screen and the key is kept).
- **Idempotency key** is now `vx-<uuid>`, the shape `chat/sends/close` accepts (the route refuses any other).
  It is kept only after an unsettled (`pending`) ending, so retrying the same text with the same choices is a
  replay and charged once; every other ending drops it. A closed key can never send again.
- **Ask again** (the web has no regenerate): under the last reply, a button that sends the last question as a
  new paid reply, labelled with its price, with a new key. It is not a free retry.
- **Rename and pin** use `PATCH chat/threads/:id` with `title` (1 to 120 characters) or `pinned`. The chat list
  shows pinned chats first with a marker. Pin is optimistic and rolls back on failure.
- Each assistant reply shows its price once saved.

## Not proved

- Against the dev mock server (extended: `sends/close`, `title`/`pinned` PATCH) and unit tests only. The mock
  never holds a job for a stopped send, so the job-read branch is proved by unit tests, not end to end.
- `chat/sends/close` answers 503 `send_close_not_open` unless `CHAT_SEND_CLOSE_ENABLED` is `"true"` (migration
  0242); the phone then reads "no answer" and falls back to the job or chat look, as the web does. I did not check
  whether production has it on.
- One charge on a retry is proved on the phone side (same key, same body; `__tests__/chat.test.ts`). The charge
  itself is the server's (`tests/chatTurn.test.mjs`, "the same send again is a replay: no provider call, no
  second charge").
- No simulator or device run; VoiceOver and TalkBack not run.

## Consequences

No new routes, flags, dependencies or server changes.
