# ADR-0171: Mobile chat: a long reply through iOS suspension (parity plan P3, spike S6)

**Status:** Proposed 2026-10-19.

## Context

A long reply can outlive the phone's attention. iOS suspends the app, the stream goes quiet, and on return it is dead or
silent. The server does not depend on the phone: a chat reply is a job that saves the reply in the step that ends it
(ADR-0067), and a reader that has gone is taken for Stop. Cutting the stream off to "check" would therefore end the reply early.

## Decision

- While a send is in flight the screen records its key, text, job id (from `start`) and the time of the last event.
- When the app returns to the foreground and the stream has been silent for 4 s, the turn is looked for by its job, every
  1.5 s for about a minute (`resolveResumedSend`; the stopped-send look gives up after four tries).
- Finished (`saved` or `unsaved`) or never made (`nothing`): the screen lets go of the stream (the server is done, so
  the disconnect changes nothing), reads the thread, and shows the saved reply with its price and a notice in words that
  say the reply finished while the app was in the background and was charged once. Still running (`pending`): the stream
  stays in charge and nothing is cut off; the look runs again on the next return.
- A stream that dies outright is handled as before: the same look from the failure (ADR-0155).
- **One charge:** the send key is kept only after a `pending` ending, so retrying the same message with the same choices
  is a replay of the same job (`tests/chatTurn.test.mjs`, "the same send again is a replay"); every settled ending drops it.

## Not proved

Unit tests only (the look's outcomes, the long wait, the quiet test, the notice words). The AppState wiring and a real
suspension were **not** run: this is spike S6 in `docs/mobile/PARITY-2026-10-19.md` section 7 and needs a real phone. No
server change; a thread GET recovers a finished reply today.

## Consequences

No new routes, flags, dependencies or server changes.
