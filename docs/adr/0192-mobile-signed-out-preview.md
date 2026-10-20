# ADR-0192: Mobile signed-out preview (N2)

**Status:** Proposed 2026-10-20. Follows ADR-0179 (first run) and the owner's wording that signed-out people may browse
a preview and the Cinema list, while playing, creating and buying need an account.

## Context

A cold launch without an account showed only the sign-in screen. The plan (N2) asks for content before sign-in, so a
person can see what the app makes, and Apple's guideline 5.1.1 (no account needed just to look) is met.

## Decision

- **`/preview`**, a route outside the signed-in area, so it needs no account. Two tabs: **Templates** (from `GET /api/presets`)
  and **Cinema** (from `GET /api/cinema/titles`), both anonymous public data, read with plain `fetch` and no token.
- **Every action asks to sign in.** Tapping a template or a title opens sign-in. Nothing plays, creates or buys, and the
  screen links to no signed-in route. A footer says playing, creating and buying need an account.
- **"Browse first"** on the sign-in screen opens it. It sits before any provider button and needs no 18+ tick, because it
  reads public data only and creates no account.
- A signed-in person who reaches `/preview` is sent to the app.

## Not done

- **Returning to the same place** after sign-in (the flow spec's "return to the same place"): after sign-in the person
  lands on Explore as usual.
- The Cinema list shows the first page only, with no categories or paging.
- **Not proved:** this has not been run on the simulator yet; VoiceOver, TalkBack, Android and a real phone not run.
- Needs the Cinema public list to be on for the account-less read; if the server answers an error, the screen says the
  preview could not load.
