# Parity map: web, phone, and the lipsync.video checklist

Date: 2026-11-21. Draft v1, built from read-only inventories. Line numbers are approximate and should be re-checked before building.

The reference site (lipsync.video) was studied only as a feature checklist. None of its code, wording, images or videos belong in Veyrnox.ai.

Key: **Yes** = present, **Part** = partly, **No** = missing.

## 1. Headline finding (rights and reliability)

> Status 2026-11-21: Lip Sync is local (PR 2584); five stills are local (PR 2587, stage A1). Twelve videos and Singing Photo are still hotlinked pending a media cost approval. The text below is the original finding.

Every example on the guided feature pages, on web (`app/veyrnox/_lib/creativeFeatures.js`) and on the phone (`apps/mobile/src/lib/creativeFeatures.ts`), is hotlinked from the competitor's CDN. The web file's own comment says the examples were copied from LipSync.video. That is a provenance problem and a reliability problem: if their CDN changes or blocks hotlinks, our examples vanish, which is probably what happened to the missing Lip Sync and Singing Photo videos. Fix this first, by replacing each example with original Veyrnox-made media stored in our own storage.

## 2. Matrix

| Feature | Web (`/app/*`) | Phone | Reference site checklist | Note |
|---|---|---|---|---|
| Lip Sync, video | Yes: `/app/lip-sync` studio and `/app/features/lip-sync`. Price in studio, none on the feature page | Yes: feature `lip-sync` plus audio hub row. Example is a still only | Yes: video upload, text or audio, 10 min, subtitles, picture-in-picture | PR 2584 restores the Lip Sync example. No subtitles or picture-in-picture on either surface |
| Lip Sync, photo / Talking Photo | Yes: `/app/features/ai-talking-photo-generator` and studio samples | Yes: slug `ai-talking-photo-generator`. MP4 example plays | Yes: model picker, text or audio or record, mask to pick the speaker, up to 10 min, daily free credits | Missing on both: model picker with length and credits per second, multi-person speaker mask |
| Singing Photo | Yes: feature plus studio workflow. Example hotlinked WebM | Part: example is WebM, so iOS shows a still | Yes: audio up to 3 or 10 min, 720p/1080p, 1 to 3 reference images, subtitles | Missing: multi-image scenes, resolution choice. Sibling session owns the example video |
| Dubbing | Yes: studio workflow plus batch locale planner (a strength) | Yes: feature `video-dubbing`, MP4 plays | Yes: video translator | Web leads on batch dubbing; phone lacks the planner |
| Dialogue (two speakers) | Yes: `/app/dialogue` studio and feature page | Part: hub row routes to a catalog model if one matches; feature has a WebM example (still on iOS) | Yes: AI dialogue video from photos or video | Phone has no dedicated studio |
| Text to Speech | Yes: `/app/text-to-speech`, 17 voices, price shown | Yes: SpeechStudio. Example is a still | Yes: voice with emotion and sound settings, inside the main studio | Reference site has an emotion picker; we have none |
| Voice cloning | Part: feature page only, no route of its own | Part: feature only, not in the audio hub | Not clearly offered | Both lack an entry in the audio section |
| Music | Yes: `/app/music/*` (about 14 routes) | Yes: about 18 screens plus beats | Not offered as a tool; has an audio template library | We lead. Price display on web unverified |
| Audio library (templates) | Part: `/app/audio` hub (session `audio-section-fix` is repairing it) | Part: `audio.tsx` hub | Yes: 9 starter templates with preview | Record only; not fixed here |
| Avatars and characters | Yes: 4 avatar features plus `/app/oddlings` | Yes: 4 avatar, 4 character and product-avatar features | Yes: AI Avatar, reuse across outfits and backgrounds | Phone example WebMs show stills on iOS |
| AI Video | Yes: `/app/create`, video agent, film studio, faceless reel | Yes: create tab, templates, film | Yes: up to 30 s, many models, frames and references | Parity is broadly good |
| AI Image | Yes: `/app/create` | Yes: create tab and tools | Yes | Parity is broadly good |
| Motion control | No: `performanceStudio.js` lists it as `planned` | No: no matches anywhere | Yes: reference performance drives a character | Missing on both surfaces |
| My creations / Library | Yes: `/app/library`, music library, projects | Yes: library tab with filters and favourites, files, history | Yes: tabs plus filters, 30-day retention note | Retention note absent on both. Phone filters are stronger |
| Pricing display | Yes: `/pricing`, `/app/credits`, studios show credits | Yes: `pricing.tsx`, `credits.tsx`, hub "From N credits" | Yes: plans, credit batches, per-model table, FAQ | Feature pages on web show no price. Phone shows live-model credits |
| Example media on tool pages | Part: all hotlinked; none local | Part: all hotlinked; six WebM show stills on iOS | Yes: sample galleries per tool | See section 1 |
| Instructions on tool pages | Yes: 3 steps per feature | Yes: 3 steps per feature | Yes: how-it-works plus per-tool notes | Parity |
| Subtitles toggle | No | No | Yes | Small gap |
| Picture-in-picture layout | No | No | Yes | Small gap |
| Entry to guided features | Yes: `/app/features` index | Part: no static in-app link; reached by search, reuse or hub rows | Home tabs | Phone voice, avatar, character and commerce features are hard to find |

## 3. Ranked gaps

| # | Gap | Surfaces | Size | Why it ranks here |
|---|---|---|---|---|
| 1 | Replace hotlinked competitor examples with original Veyrnox-made media in our own storage | Web and phone | Large (22 features; needs media production, possibly credit spend) | Rights risk and broken examples. Needs your yes for any credit spend |
| 2 | Phone WebM examples show only a still on iOS (six features) | Phone | Small once gap 1 delivers MP4s | Folds into gap 1; interim fix is an honest poster with no play badge |
| 3 | Add a visible entry to the guided features list on the phone | Phone | Small | Makes 22 features reachable |
| 4 | Show price on web feature pages | Web | Small | Phone already does |
| 5 | Voice cloning: own entry in the audio section and a route | Web and phone | Medium | Sits in the audio area, so coordinate with `audio-section-fix` |
| 6 | Motion control tool | Web and phone | Large, and needs a provider check | Planned only; the reference site offers it |
| 7 | Singing Photo options: multi-image scenes, resolution, longer audio | Web and phone | Medium | Depends on provider limits |
| 8 | Talking Photo: model picker with length and credits, speaker mask | Web and phone | Medium | Depends on provider support |
| 9 | Dedicated Dialogue studio on the phone | Phone | Medium | Web has one |
| 10 | Subtitles toggle and picture-in-picture | Web and phone | Medium | Provider-dependent |
| 11 | Library retention note | Web and phone | Small | Only if we really delete after 30 days |
| 12 | TTS emotion or style picker | Web and phone | Medium | Provider-dependent |

## 4. Out of scope here

Audio section repairs belong to `audio-section-fix`. The Lip Sync example (PR 2584) and the Singing Photo video belong to the session that owns them.

## 5. Not verified

Music price display on web, TTS price on the phone, and whether the web feature page fetches a price after submit were not checked in detail.
