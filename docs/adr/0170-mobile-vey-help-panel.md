# ADR-0170: Mobile Vey help panel (parity plan P3)

**Status:** Proposed 2026-10-19. Replaces the link-out on the Help screen (ADR-0125).

## Context

Help only linked to a chat and the legal pages. The web's Vey help assistant answers one product question at a time
from `POST /api/v1/help` (ADR-0103): free, rate-limited, and unable to spend, delete or publish.

## Decision

- The Help screen opens with **Ask Vey**: a question box (500 characters), an Ask button, the last answer, and the
  last six turns sent as history. It says in words that asking is free and that Vey can point somewhere but never
  spends credits or changes anything.
- The request is `{ question, pathname: '/app', history }`. The web also sends the page targets it can see; the
  phone has none, so the answer is words plus an optional place to go.
- A **Take me there** button appears only when the plan's action or target maps to a phone screen (`helpRoute`:
  Create, Library, Credits, Chat, Account, Publish, Explore). Oddlings, Film, Projects, Enhance, the video agent and
  admin targets have no phone screen yet, so they give no button rather than a dead one. The button navigates; it
  never presses anything in the target screen.
- Errors: rate limit, no connection and anything else each have their own plain words.
- Contact, appeals, report and legal rows stay below.

## Not proved

- Dev mock server and unit tests only. No device, VoiceOver or TalkBack. The live route's answer quality, the
  account-question path (`veyAccountEnabled`) and its rate limit were not exercised.

## Consequences

No new routes, flags, dependencies or server changes. Server gap: none. A future per-screen "ask about this" needs the
screens to name their targets.
