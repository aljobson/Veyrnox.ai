# ADR-0148: Mobile Explore as the home (parity plan N4)

**Status:** Proposed 2026-10-19. Third slice of the parity plan's Track B, after ADR-0146 and ADR-0147.

## Context

Home was the credits number and a column of buttons. A new person had to pick a feature before they could make
anything. The web's home is Explore, the template gallery, and the journey review asked for the same on the phone.

## Decision

The first tab (Explore, `/`) now shows, top to bottom:

- **A prompt box** with "Make an image" and "Make a video". Each opens Create on the first catalog model of that
  kind that takes a plain prompt and needs no file, with the prompt filled in. Both are off until something is
  typed. The price is shown on that screen, as always; Explore never computes one.
- **Pick up where you left off:** the creation still being made, or else the latest finished one that still has its
  file. It opens the result screen. It is built from the Library list, so it shows nothing for a new person.
- **Templates:** category chips (All, then each category in the server's order) and a two-column grid of the first
  twelve, with the server's price and length. A tap opens Create on the template's model with its prompt and length
  filled in (the same link the Templates screen uses, now shared). "See all templates" opens that screen.
- **Recent creations:** the last six finished ones, each opening its result.
- **More:** Quick edit, Projects and Chat with Vey, which have no tab yet, so nothing the old Home linked to is
  unreachable. The tabs, the credits chip (Buy credits) and the avatar (Account) cover the rest.

A new person makes something in two taps: a template, then Generate; or words, "Make an image", then Generate.

Nothing is computed in the app: the models come from the catalog, the templates and prices from `GET /api/presets`,
and the creations from the Library list. The credits number leaves the page (it is in the header on every tab).

## Not built

- **The Oddlings banner.** The spec lists it, but Oddlings has no phone screen and the journey review left open
  whether it should have one or stay a web link. It needs an owner decision.
- Template previews play on the phone's own tab: the grid shows the poster only.

## Not proved

- VoiceOver and TalkBack on the prompt box, chips and cards (steps as in ADR-0133).
- Android, and a real phone. Checked on the iPhone 17 Pro simulator against the mock server at the normal and the
  largest text size; the mock has two templates and no poster images, so the poster layout is unseen with art.
- Which model "Make an image" and "Make a video" pick on production: it is the first suitable model in the live
  catalog order, which this session has not read.

## Consequences

No new routes, dependencies, flags or server calls. Thirteen English strings (`explore.*`) are listed in
`docs/mobile/I18N-NEW-KEYS.md` for the localization process; no machine translation.
