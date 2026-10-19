# Prompt collage: ready-made prompts for images, video and audio

**Status:** Requirement, proposed 2026-10-19. Owner ask: people need a collage of prompts in several categories to create images, videos and audio. Facts below come from `app/veyrnox/_lib/templates.js`, `lib/publicPresets.js`, `app/api/presets/route.js`, the live web Explore page read signed in, and `apps/mobile/src/lib/presets.ts`. Nothing was run on a phone.
**Reads with:** [PARITY-2026-10-19.md](PARITY-2026-10-19.md) section 3, [WEB-WALKTHROUGH-2026-10-19.md](WEB-WALKTHROUGH-2026-10-19.md), [USER-JOURNEY-2026-10-19.md](USER-JOURNEY-2026-10-19.md) (slice N4, Explore as the home).

## 1. What exists

| Fact | Evidence |
|------|----------|
| The web Explore page is a gallery of cards under category chips: All, New, Your photo, Kids birthday, Cinematic, Anime, Cartoons, Movies, Fantasy, Realistic, Fashion, Products, VFX, UGC, Ads | web page, `PRESET_CATEGORIES` |
| Each card shows a preview, a title, the model, the length, the full prompt and the price in credits. Opening it fills the Create screen | web page |
| The gallery showed "110 templates on 2 models" on the owner's account | web page |
| The repo holds 164 templates: Kling 3.0 image-to-video 125, Seedance 2.0 Fast 19, a handful on other video models, and **about 11 image templates** (Nano Banana 2, Nano Banana Pro 1, Seedream 4 four, Flux.2 pro 2, Nano Banana Pro Edit 1, Background Removal 1) | `ALL_TEMPLATES` counted by model |
| **No template uses an audio model.** The categories are all picture or video styles | same count |
| `GET /api/presets` already carries a `modality` field on every preset, a poster and a preview URL, and the price comes from the catalog | `app/api/presets/route.js` |
| The phone has a template list (`create/presets.tsx`, ADR-0120) and the Explore home grid (N4, merged). Both read `/api/presets` and so inherit the same gaps | `apps/mobile/src/lib/presets.ts` |

## 2. The gap

1. **Image prompts are thin** (about 11 of 164) and have no categories of their own.
2. **Audio prompts do not exist** on the web or the phone: no voice, music or sound-effect templates.
3. **Categories describe looks, not what is being made.** A person who wants a song or a product photo cannot pick "Audio" or "Images" first.
4. **The phone shows the same single list.** There is no way to filter by image, video or audio, and no search.

## 3. Requirement

### 3.1 The collage on the phone (Explore home and the template screen)

- A top filter **Images, Video, Audio** (plus All), then category chips under it. The category set depends on the type chosen.
- A masonry collage of cards: preview or poster, title, model, length where it applies, price in credits, and a "New" mark.
- Tapping a card opens Create with the prompt, model and length filled in. The price is already on the card and is shown again before Generate.
- Search across titles and prompts; a favourites filter (local, per account).
- Audio cards play a short sample on tap (no sound until the person taps); video cards preview muted.
- Works offline from the last loaded list, with the existing "saved copy" note.

### 3.2 Categories to cover

| Type | Categories proposed (the owner confirms or changes) |
|------|-----------------------------------------------------|
| Images | Portraits, Products, Fashion, Food, Interiors, Landscapes, Anime, Cartoons, Fantasy, Logos and graphics, Social posts, Thumbnails, Photo edits (background removal, upscale, expand) |
| Video | the existing set: Cinematic, Anime, Cartoons, Movies, Fantasy, Realistic, Fashion, Products, VFX, UGC, Ads, Kids birthday, Your photo |
| Audio | Voiceover and narration, Music beds, Jingles, Sound effects, Podcast intros, Ambience, Lip sync and talking avatars |

### 3.3 Content and data (the part nobody has done)

- Write the missing **image** and **audio** prompts with a real model behind each, so every card has a verified price. A model only counts once its endpoint is verified in the catalog (`CLAUDE.md`, Money and billing).
- Give each template a poster and, for audio, a short sample. Preview files are served from the site; the phone loads them from the site's public URLs and does not bundle them.
- Keep the same data for the web gallery and the phone: one `ALL_TEMPLATES` source, served by `GET /api/presets`. The web gallery should gain the same Images, Video and Audio filter so the two stay in step (a parity rule, not a phone-only feature).
- Original wording only. Prompts that name a real person or copy a living artist's style are not added; fictional adult characters only for character prompts.

### 3.4 Rules that hold

- Every card shows its price. Credits are bought only through the store; the collage never links to web checkout.
- Nothing in a prompt or card uses wallet or crypto wording (hard wall).
- Strings go through the translation key list. Prompt text itself stays in English for now and is marked as such.

## 4. Who does what

| Piece | Owner | Notes |
|-------|-------|-------|
| Image and audio template content, catalog check, web gallery filter | A content and web session | Touches `app/veyrnox/_lib/templates.js`, the Explore page and `lib/publicPresets.js`. Not the phone. Needs audio models that are active in the catalog |
| Collage UI on the phone: type filter, category chips, search, favourites, audio sample | The mobile navigation session (it owns the Explore home) | Reads `GET /api/presets`; works with today's data and fills in as content lands |
| Server field changes, if the response needs a sample URL or a category per modality | A server session, one small PR | Additive only |

## 5. Order

1. Phone: type filter and search on the existing data (video and about 11 image cards). Small, no new content.
2. Content: the first image categories (Portraits, Products, Social posts, Photo edits) with posters.
3. Content: the first audio set (Voiceover, Music beds, Jingles, Sound effects) with samples, once audio models are confirmed active.
4. Phone: audio sample playback on cards, favourites.
5. Content: the remaining categories.

## 6. Open questions for the owner

1. Are the proposed image and audio categories right, and is there a priority order?
2. Which audio models should back the first audio prompts (voice, music, sound effects)? None appears in the template data today.
3. Do prompts get translated, or stay English with a localized chrome?
4. Should people be able to save their own prompts to the collage (a personal collection), or is that a later feature?
