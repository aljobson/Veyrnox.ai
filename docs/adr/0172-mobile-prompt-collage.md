# ADR-0172: Mobile prompt collage on Explore, slice 1 (type filter and search)

**Status:** Proposed 2026-10-19. Implements step 1 of `docs/mobile/PROMPT-COLLAGE-2026-10-19.md`, on top of ADR-0148.

## Context

The owner wants a collage of ready-made prompts the person can pick from, for images, video and audio. Today's
`GET /api/presets` is mostly video, about eleven image templates and no audio. The spec's order puts the phone's
type filter and search first, on the data that exists, so the content session can fill in categories after.

## Decision

The Templates section of Explore now has:

- **A type filter** (All, Images, Video, Audio) from each template's `modality`, which the endpoint already
  returns. All four chips are always shown.
- **Category chips that depend on the type**: only the categories that type has. Changing the type starts at All.
- **Search** across titles and prompts (case and extra spaces ignored), combined with the type and category.
- **A masonry of two columns**: poster, title, model, price, and a "New" mark. Video posters are taller than image
  posters. A tap opens Create prefilled as before; the price is shown again before Generate.
- **A clear empty state.** An empty Audio type says "Audio templates are coming soon." and a search with no hits
  says "No templates match." Neither is a blank area.

The prompt text is whatever the server sends, in English. Nothing about wording or content is written here.

## Not done (later steps in the spec)

- Favourites, and playing an audio sample on tap (step 4).
- The image and audio content itself, its posters and samples (steps 2, 3 and 5): a content session.
- Video previews on cards (the grid shows posters only), and the "your own prompts" collection.
- Working from a saved list while offline: the Explore list is fetched each time.

## Not proved

- VoiceOver and TalkBack on the chips, search and cards; Android; a real phone.
- How it looks with real posters and the real ~110 templates: the mock has three templates and no art.
- Audio: there are no audio templates to test against, only the empty state.

## Consequences

`Preset` gains a `modality` field read from the existing response. No new routes, dependencies, flags or server
calls. Eight new English strings (`explore.*`) are listed in `docs/mobile/I18N-NEW-KEYS.md` for the localization
process; no machine translation.
