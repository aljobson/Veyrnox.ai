# Mobile Audio parity: audit and remaining slices (2026-11-19)

Owner complaint 2026-11-19: the phone's Audio area has a parity gap with https://veyrnox.ai/app/audio and repeats icons. Slice 1 (distinct icons plus a hub that reaches the real lip sync and dubbing workflows) is the PR that carries this file. The rest waits for the owner's pick.


Raw agent audits (long): scratchpad/audit-web-dialogue-dub.md, audit-mobile-and-icons.md, audit-flags-tts-nav.md.

## Production flags (wrangler.jsonc, not the deployed Worker)
- MUSIC_RUNTIME_FLAGS: 36 keys true (cover, stems, targetStems, extend, replace, addSection, trackAdd, playlists, studio, labs, beatEditor...). references, magicBar false; beatCloud, beatLibrarySave absent (off).
- APP_RUNTIME_FLAGS {"checkin":true,"push":true}. NO flag exists for text to speech, dialogue, lip sync, performance, voice recipes, audition board, audio shelf: they are ungated, depend on catalog rows + kill switch.
- Web Performance studio (/app/performance, /app/lip-sync) hides behind localStorage `veyrnox_performance=1` unless the route is dedicated (lip-sync page is dedicated).
- VERIFIED_VOICE_TTS_ENABLED absent (off). STORE_BILLING_ENABLED absent in prod. FILM_STUDIO_ENABLED false.

## Gap table (ranked by user impact)
| # | Studio | Web has (files) | Mobile today | Gap | Flag / blocker |
|---|---|---|---|---|---|
| 1 | Speech | TextToSpeechStudioClient.js: script (500 chars), 17 stock voices, 19 languages, 7 emotions, speed/volume/pitch, pause presets, interjections, 20 palettes, Audition Board (2-3 voices priced as N jobs), Voice Recipes, audio shelf, Use for lip sync, approve-total panel | Generic /create/[modelId]: script box + one free-text voice description (CreateOptions.tsx:81-94) | No voice list, language, style, audition, recipes | Ungated. BLOCKER (verified in code): web sends inputs.tts_voice/emotion/speed/volume/pitch/language; lib/generationInputValidation.js ALLOWED_INPUTS has none of them, so POST /generations returns 400 inputs_key_not_allowed:tts_voice and the capability record for fal-ai/minimax/speech-2.6-hd declares only `prompt`. Not confirmed live (no paid POSTs allowed). Needs owner/staging check before any native speech build |
| 2 | Dialogue | DialogueStudioClient.js: audio mode (2-12 turns, 1000 chars, 2-4 speakers, voices Aria/Roger/Sarah/George), cast map, project casts, handoff to dubbing/talking avatar; photo dialogue (dead: multitalk-dialogue has no catalog row), video planned | Generic create on an audio model whose name matches dialogue; no turn editor | No turn editor/speakers/cast | web sends inputs.dialogue_voice_1..4 which ALLOWED_INPUTS also lacks (same 400 risk); capability for eleven-v3 dialogue derives blocks from the prompt text only |
| 3 | Dub / lip sync | PerformanceStudioClient.js (2149 lines): 10 workflows (talking photo, video lip sync, video dubbing + 2-5 locale batch, product presenter, cartoon, animal, object, baby podcast, singing photo), source step, speech step (script via minimax, upload, record), consent step, optional subtitles (clip-edit, 7x), PiP local | Hub row -> features/lip-sync; creativeFeatures.ts also has video-dubbing, talking photo, singing photo, avatar-dialogue, talking cartoon/animals/objects, baby podcast as separate guided features | Hub reaches only one of ten workflows; no dubbing locale batch or subtitle step | latentsync / kling-avatar-v2 are real (0090, 0366). Sync lipsync models unverified |
| 4 | Library audio | Shelf, JobAssetPreview, DownloadAsset, save to shelf, use for lip sync | LibraryMedia.tsx play/pause only | no seek, no use-as-lip-sync-source | none |
| 5 | Music extras | Discover, Instruments, Playlists, Workspaces, Beats, Labs, Studio, Sounds | create, library, song detail + actions, stems, instruments | Discover, Playlists, Workspaces, Beats, Labs, Studio, Sounds absent. Owned by music sessions (music-p3, beat-native) - not touched here | flags true except beatCloud |
| 6 | Hub itself | 4 cards with title+blurb | 5 rows, title+blurb, no price | no price hint, one icon for 3 rows | none |

## Icon audit
Icon key `audio` (music-notes) = six meanings: hub Your music, Music, Speech (audio.tsx:13); Home Audio card ((tabs)/index.tsx:248); Create goal badge (create.tsx:38); Library "Your music" row (library.tsx:277). Hub dialogue = `chat` (generic chat), dub = `video`. Music screens (src/app/(app)/music/*, src/components/music/*) have NO icons: song actions (MusicSongActions.tsx), player (MusicPlayer.tsx:28-32 play/pause/+-10s) are text-only buttons. Other reuse: `squares` on three Templates tiles (create.tsx:134-136), `smiley` twice (create.tsx:138-139).
Registry: 92 PNGs in assets/icons, all registered (+6 Kubai colour PNGs separately). Fits already present: waveform (lipsync tool), userSound (avatar tool), speaker, faders, filmReel, monitorPlay, chatText, pianoKeys, slideshow, penNib, magicWand, cutout, expand, upscale.
Missing for this area: microphone, headphones, scissors, repeat, share, download, translate, pause, skip, copy, trash, playlist/vinyl.
How icons are made: Phosphor regular 2.1.1 (MIT), SVG recoloured #ffffff, rendered to 96x96 PNG, tinted at runtime. No icon package installed; adding new ones needs the SVGs from `npm pack @phosphor-icons/core@2.1.1` in a temp dir (not a dependency) and ~1-2 KB per PNG.

## Remaining slices, in recommended order (one PR each; owner picks)
| Slice | What | Needs first | Rough size |
|---|---|---|---|
| S2 | Server contract for speech and dialogue: either extend `ALLOWED_INPUTS` + capability records so voice, language, emotion, speed, pitch and `dialogue_voice_N` reach the provider, or confirm on staging that the web studios work today (read-only, no paid POST) | Owner/server decision. Web `ttsGenerationInputs` sends keys that `lib/generationInputValidation.js` rejects; unconfirmed live | server + tests |
| S3 | Native Text to speech studio: script, 17 voices, 19 languages, 7 styles, speed/volume/pitch, price panel; Audition Board after | S2. Register the POST in `aiConsent.ts` CONTENT_POSTS and `hardPaywall.ts` PAID_ACTIONS, real client guard test, one idempotency key per attempt, price before spend | large |
| S4 | Native Dialogue studio: ordered turns (2-12, 1000 chars), 2-4 speakers, cast (Aria/Roger/Sarah/George), `elevenlabs-dialogue`. Photo dialogue stays out: `multitalk-dialogue` has no catalog row | S2 | large |
| S5 | Dub / lip sync depth: video dubbing locale batch (2-5), speech step (script via minimax, upload, record), consent step, optional subtitles (clip-edit, x7); five avatar workflows already exist as features | S2 for the script step; rate limit 10 jobs/60 s | large |
| S6 | Library audio: seek, "use for lip sync", save to shelf | none | small |
| S7 | Voice Recipes, palettes, audio shelf | web keeps them in localStorage only; needs a storage decision | medium |
| S8 | Music extras (Discover, Playlists, Workspaces, Beats, Labs, Studio, Sounds) | owned by the music sessions; flags true except beatCloud | n/a |

Other icon reuse found but left out of slice 1: `squares` on the Image and Video template tiles, `smiley` twice on Create, `SourcePicker.tsx` audio-file placeholder. Phone icons are Phosphor regular via pre-rendered PNGs; no icon package is installed.

## Slice 1 as shipped: notes
- Hub rows, icons and the From-price hint: `src/lib/audioHub.ts`, `src/app/(app)/audio.tsx`. The price line shows only when the catalog is fresh (not a stale cached copy) and never for Music or Your music, because native Music quotes two candidates.
- Icon reuse still present after slice 1 (meaning differs, left on purpose): singing photo `pianoKeys` (Home Instruments card also uses it), dubbing `monitorPlay` (video-upscale tool also uses it).
- The `/audio` drawer menu entry in `src/lib/menu.ts` also moved from music-notes to headphones, to match the Home Audio card (not in the approved plan; added after the first inspection).
- The 11 new icons are Phosphor regular 2.1.1 (MIT) rendered to 96 x 96 white PNGs, 19,383 bytes in total; no icon package was added.
- Ten non-English locales are machine translated (new `audioHub.*` strings) and need a native review.
- Review trail: plan reviewed by Codex in 3 rounds (APPROVED); two fresh Claude inspections each returned REVISE and every finding was fixed; the last fix round had no independent inspection because the budget of two was used.
