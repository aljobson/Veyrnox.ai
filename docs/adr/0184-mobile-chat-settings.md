# ADR-0184: Mobile chat settings: model and instructions (parity plan P3)

**Status:** Proposed 2026-10-19.

## Decision

- A **Settings** button in the chat toolbar opens the chat's model and its instructions, as the web's settings panel does.
  The model list shows open models cheapest first with each one's credits per reply; the instructions are held to the
  server's 4000 characters with a running count.
- Save sends only what changed (`PATCH chat/threads/:id { model_id }` and/or `{ system_prompt }`; the route takes both
  together). Switching the model changes what the *next* reply costs, which the Send button shows at once; the Thinking
  and Web choices the new model does not offer are dropped.
- Disabled while a reply is being written, so a model cannot change under a send.

## Not proved

Unit tests (what changed, the limit, open-models-cheapest-first). No device, VoiceOver or TalkBack run; the live save was
not exercised. Personas, which also set instructions, keep their own screens.

## Consequences

No new routes, flags, dependencies or server changes.
