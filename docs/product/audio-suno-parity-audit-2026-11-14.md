# Veyrnox Audio vs Suno: parity audit (2026-11-14)

Read-only code audit of `origin/main` (1bf621a36). Suno's side comes from `docs/product/suno-music-parity-spec.md` section 3. Music itself is covered by that spec; this covers the Audio hub (`app/veyrnox/app/audio/page.js`) and what it links to: Music, Speech (`/app/text-to-speech`), Dialogue (`/app/dialogue`) and Dub (`/app/lip-sync`). Nothing was run.

## Gaps against Suno

| Suno | Status | Evidence | Missing |
|---|---|---|---|
| Speech: script | Built | `text-to-speech/TextToSpeechStudioClient.js`, `minimax-speech-2.6-hd` | Script capped at 500 characters (`_lib/textToSpeech.js`) |
| Speech: tone | Built | `TTS_EMOTIONS` (7) and voice tone tags | |
| Speech: vocal gender | Built | gender and age filters, `TextToSpeechControls.js` | Only 17 stock voices |
| Speech: background music | Gap | none in TTS or Dialogue | No music bed under speech |
| Speech: variety | Partial | voice audition board, `_lib/voiceAuditions.js` | No several takes of one voice |
| Speech: Simple and Advanced | Partial | one screen with optional controls | No mode switch |
| Audio input | Partial | lip sync uploads or records speech | Speech and Dialogue take no audio input |
| Own voice | Policy-blocked | parity spec section 6 | No voice cloning |
| Adjust speed | Partial | speed, pitch, volume at generation | No speed change after generation |
| Reverse | Gap | none | Whole feature |
| Hooks (short clips) | Gap | none | Short-clip tab |
| Persistent player and queue | Gap | per-page players only | Cross-page player with queue |
| Record and transport | Built in Music only | `MusicStudioRecorder.jsx` | Speech studios have none |

## Veyrnox has, Suno does not
Multi-speaker dialogue (12 turns) with saved casts; photo dialogue; lip sync and dubbing (`latentsync`, `kling-avatar-v2`); voice audition board; voice palettes and recipes; audio reference shelf; inline pauses and 19 interjections; 18 TTS languages; sound effects with seamless loop and MMAudio soundscapes; editor speech cut, best cut and transcription; editor stem separation.

## Defects found
1. `PHOTO_DIALOGUE_MODEL_ID = 'multitalk-dialogue'` has no `model_catalog` row in any migration, so photo dialogue has no model. Not checked at run time.
2. Speech, Dialogue and Sounds pages are English only (no `useI18n`), while the hub is in 11 languages.
3. The hub does not link Sounds, the audio shelf and voice library, or the editor's audio tools.
4. Dubbing lives at `/app/lip-sync`, and navigation also maps `/app/performance` to the same studio.
5. `speechCut` is on in production but missing from staging's `EDITOR_RUNTIME_FLAGS`, so it cannot be checked on staging first.
6. The Music parity spec section 4 still lists the seven editing features as off; they have been on since `0511`.

## Top gaps by value
1. Persistent player with queue across Music, Speech and the shelf: about 2-3 days. Folded into song page slice 2 (`docs/product/music-song-page-plan-2026-11-14.md`).
2. Background music under speech or dialogue: about 2-4 days, more if it needs a priced server mix.
3. Speed and reverse on finished audio, through the editor's browser pipeline, no credits: about 1 day.

## Not verified
Whether a later migration switched any audio model off; photo dialogue at run time; whether `/app/lip-sync` and `/app/performance` differ in practice; TTS speed limits.
