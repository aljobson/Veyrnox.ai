# ADR-0158: Oddlings on the phone (parity plan P8)

**Status:** Proposed 2026-10-19. Slice 1 of three: the gallery and character sheets. The builder and the hand-off to Create follow.

## Context

The web's Oddlings area is a client-side character builder plus a gallery of 72 original, fictional adult characters.
No server route is involved. The phone had none of it. Oddlings are fictional adults only; nothing here lets a real
person's photo stand in for a likeness.

## Decision

- **Routes:** `/oddlings` (the gallery) and `/oddlings/[id]` (a character sheet), a new route group under the signed-in
  stack. The Explore banner links to `/oddlings`; the Explore home belongs to another lane.
- **Data is generated, not copied by hand.** `apps/mobile/scripts/sync-oddlings-cast.mjs` imports the web's
  `character.js` and `oddlingExplore.js` by relative path and writes `src/lib/oddlings/cast.json` (name, hook, accent,
  kind, collections, premise, canon lines, picks). A jest test runs the script with `--check` and fails if the copy
  drifts. Metro cannot be run to prove a direct import (spike S4), so the build never depends on files outside the app.
- **Portraits are not bundled.** The 72 webp portraits (about 5.8 MB in all, roughly 80 KB each) load from
  `https://veyrnox.ai/oddlings/portraits/<id>.webp` and are cached on disk by the image component. A card loads only
  when it scrolls into view.
- **Filters match the web:** collection tabs, and Human (68) / Other beings (4) over whichever tab is open.
- **Free previews:** the web's animated puppet previews are not built; the sheet says they are free on the web.
- **Not in the first release:** the optional reference-image moodboard. It would put a photo next to a character, and
  the phone has no need for it.
- **No server change, no flag, no credits.** Browsing is free. Character names, hooks and premises are English only for
  now; the web's translations of them can be added to the cast file later.

## Consequences

When the web cast changes, run `node apps/mobile/scripts/sync-oddlings-cast.mjs`; the test names the file to refresh.
