# ADR-0154: Mobile chat reply options and prices (parity plan P3, slice 1)

**Status:** Proposed 2026-10-19. First slice of the Chat lane.

## Context

The phone chat sent a plain reply only. The web chat (ADR-0067, 0068) lets a person choose Standard or Thinking
and turn Web search on, each with a catalog price, and shows what a reply will cost before it is sent.

## Decision

- `GET /api/v1/chat/models` already returns `options.thinking|web|images` with `extra_credits` per model. The phone
  reads them (`ChatModel.options`) and shows only the choices the model offers.
- The conversation screen shows the model and its credits per reply, a Standard / Thinking radio pair (price on
  Thinking) and a Web switch (price on it). The Send button shows the total: base plus each extra chosen. The
  total is a sum of listed catalog numbers; the server prices and charges the turn itself.
- The choices go to `POST .../messages` as `options: { thinking, web }`. A model change or a model without the
  choice drops it, so a price never rests on a switch that is gone.
- The idempotency key belongs to text **and** choices. Retrying the same message with the same choices reuses the
  key (one charge); changing either makes a new send with a new key.
- A paid send checks the connection first and shows the offline message instead of sending (`ensureOnline`).
- Deep research is **not built**: `CHAT_RESEARCH_ENABLED` is absent in production and the route returns no
  `research` offer.
- New English strings (`chat.opt.*`, `chat.perReply`, `chat.send*`) are in
  `docs/mobile/I18N-NEW-KEYS.md`; no machine translation.

## Not proved

- Proved against the dev mock server (extended to price options like `lib/chat.js` `replyPrice`) and unit tests only;
  no simulator, device, VoiceOver or TalkBack run, and no live staging send.
- The price shown for a long thread is the catalog price; the server may refuse with `insufficient_credits`, which
  the screen already reports.

## Consequences

No new routes, flags, dependencies or server changes.
