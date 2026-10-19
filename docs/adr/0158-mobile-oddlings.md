# ADR-0158: Oddlings on the phone (parity plan P8)

**Status:** Proposed 2026-10-19. All three slices: the gallery and character sheets, the builder, and the hand-off to Create.

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

## Slice 2: the builder

- **Route:** `/oddlings/build` (optionally `?from=<cast id>` or `?passport=<saved id>`) and `/oddlings/saved`. The
  gallery and each sheet link to them ("Build your own", "Build from this character", "Saved passports").
- **The option data is generated** into `src/lib/oddlings/builder.json` (51 groups, 390 options, the web's display
  wording, categories, swatches). **The logic is ported** into `src/lib/oddlingsBuilder.ts`: prompt, traits, canon,
  conflict rules, sanitiser, Randomize styling and Surprise me. Direct import was not provable without Metro, and jest cannot
  load files outside the app, so `scripts/oddlings-web-reference.mjs` runs the web files under Node over all 72
  characters (six hand edits each, three seeds of each randomizer, messy input) and a jest test requires identical
  picks and identical prompts. The reference script and the port share one seeded generator.
- **Live preview figure:** the web draws a stylised mannequin from pure geometry. The app has no SVG library and may not
  add one, so the same web modules are wrapped (generated, not rewritten) into one script that a WebView runs offline;
  the page loads nothing from the network and refuses navigation. Output is limited to known shape tags and escaped
  values (tested for all 72 characters and every option). It is a stand-in: the real picture is made from the picks.
- **Saved passports and the draft** are one JSON file in the app's document folder (`veyrnox-oddlings/passports.json`),
  up to 24, never sent anywhere (there is no server route). Picks are re-cleaned on every read.
- **Left out:** the optional reference image (moodboard) upload, and the animated mode (slice 3 sends a prompt to Create).
- **Not here:** prices. The builder costs nothing; the price is shown by Create, before anything is sent.

## Slice 3: the hand-off

- A card at the foot of the builder: **Make a portrait** and **Make a short**, each with the catalog price on the
  button. The price is `estimateCredits` over the catalog row (never computed in the app); Create shows it again.
- **Portrait:** opens Create on `flux-2-pro` (the model the web uses) with the full builder prompt in the `prompt`
  parameter. The web hands over only the scene and lets Create add the character; the phone's Create takes a prompt
  and no picks, so the character goes in the prompt.
- **Short:** opens Create on Auto Short, found as the open video model whose text input is `topic` (no id is
  hard-coded), with a topic that names the creator, voice, show, look and scene, cut to the model's own limit so the
  scene and look go before the creator.
- **Nothing is sent from here.** Create charges only on its own Generate button. Offline, the card checks
  `ensureOnline()` and opens nothing. The character is saved as a passport before leaving.
- **Video agent:** not used. `/create/agent` takes no brief parameter yet; adding one (`brief`, `aspect`) is a small
  change in the Create lane's file, listed in the PR. Auto Short already takes the topic today.

## Addendum: sharing and the mascot

- **Share a character:** the character sheet has a Share button that opens the system share sheet with the public
  page `https://veyrnox.ai/oddlings/<id>` and a one-line message. Only the 72 cast ids can be shared (the same
  `findOddling` check as the sheet); a character someone builds is never shared and has no public page.
- **Room for Vey:** every Oddlings list or scroll area pads its bottom by `VEY_CLEARANCE` (ADR-0159) so the corner
  mascot never covers the last row.
- **Explore banner:** the Explore home belongs to the navigation lane. The route to link is `/oddlings`.
