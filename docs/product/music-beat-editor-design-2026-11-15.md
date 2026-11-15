# Music beat and song editor: design (2026-11-15)

Status: design only, nothing built. Owner decisions are listed in section 9.
Sketches: [desktop](music-beat-editor-desktop-2026-11-15.svg) and
[phone](music-beat-editor-phone-2026-11-15.svg).

## 1. Goal

Give Veyrnox Music a GarageBand-style editor. People get a sound and instrument
library on the left and a timeline in the middle. They build beats and songs by
placing, cutting, looping and stitching clips: drum patterns, instrument takes,
MIDI parts, generated songs, stems and uploaded audio.

"Professional" here means the habits every reference product shares (section 3):
- drag from a docked library onto a beat grid
- loops that follow the project tempo and key
- a real step sequencer
- edge-drag trim and loop-extend
- deep undo
- autosave with versions
- a clear export menu

The editor is the compose layer. It is free and local-first, and it charges
Credits only for AI parts, priced from the catalog. That is the same split
ADR-0080 chose for the video editor.

## 2. What exists today (audit)

Paths are relative to the repo root.

### 2.1 Studio page: `app/veyrnox/app/music/studio/[id]/page.js` → `MusicStudioWorkspace.jsx`

| Piece | Can do | Cannot do |
| --- | --- | --- |
| `MusicStudioWorkspace.jsx` | Loads one owned song (`gatewayFetch('/music/songs/:id')`, :33) and plays it through a hidden `<audio>`. One "Audio 1" lane with mute, volume and hide. Tempo 40–240 and 4/4, 3/4 or 6/8 as a guide only. | The waveform is decorative bars (:84-86). The metronome creates a new `AudioContext` per tick on `setInterval` (:38-52), so it drifts. There is no second track, no save ("No project save", :64), and no export. The page does not check the `studio` flag itself; only the nav link is hidden. |
| `MusicStudioMidi.jsx` | Three wavetable presets (:16-20). Two-oscillator voices with filter and LFO (:91-134), 12-voice stealing. Input from musical typing, a floating keyboard, and Web MIDI with `sysex:false` (:250-264). 1/16 quantise (:226). | `MAX_NOTES = 64` (:7). The limit has no recorded reason and arrived with #2065. The piano roll is a table of number inputs (:310). Voices bypass the effects rack (:129). All notes are scheduled at once (:230-238). Memory only. |
| `MusicStudioEffects.jsx` | Five effects (EQ, compressor, distortion, delay, generated-impulse reverb), up to 10, reorder and bypass. Master-volume automation with at most 16 points. | Runs on the `<audio>` element only (`createMediaElementSource`, :125). Not per track, no send buses, no offline render, no save (:228). |
| `MusicStudioClipEditor.jsx` | Trim (≤ 60 s), three fade curves, reverse, ±12 st pitch by resampling. WAV preview. | Speed changes with pitch. Nothing is uploaded or placed on a timeline. |
| `MusicStudioRecorder.jsx` | Device picker, MediaRecorder to WAV, count-in in bars, 5 takes of 60 s. | Blob URLs only. Takes are not placed on a lane and not latency-compensated. |
| `MusicStudioLatencyCalibration.jsx` | Measures round-trip delay with three clicks (:50-80). | Reports the figure only; nothing applies or stores it (:90). |
| `MusicStudioInstrumentTakes.jsx` | Plays shelf takes alone, or against the song with a manual 0–60 s offset. | "Auditioning only… not part of any export" (:57). |

### 2.2 Instruments page: `app/veyrnox/app/music/instruments/page.js` → `MusicInstrumentsLoader` → `MusicInstruments.jsx`

**What it has**
- **Five instruments:** piano, guitar, drums, bass and synth (`lib/musicInstruments.js:3`).
- **Three playing surfaces:** keys (2 octaves, ±2 octave shift), a guitar neck (6 strings, 5 frets, 6 strum chords) and 8 drum pads on `a s d f j k l ;`.
- **Presets:** 3 drum kits (acoustic, 808, lo-fi) and 3–4 presets per other instrument (:10-38).
- **Fully synthesised sound, with no sample files.** `app/veyrnox/_lib/music/instrumentEngine.js` uses additive piano, Karplus-Strong guitar, sweep-and-noise drums and subtractive bass and synth.
  - `playEvent(context, out, noise, instrument, preset, event, at)` runs on a live or an offline context (:155-161).
  - `renderTake` renders to an `OfflineAudioContext` (:168-183).
  - **This is the most reusable piece we have:** it already schedules events at an exact audio-clock time.
- **Takes:**
  - Shape: `{instrument, preset, events: [{at, dur, vel, value}]}` (`lib/musicInstruments.js:107-137`). Limits are 60 s and 600 events.
  - Storage: IndexedDB `veyrnox-instrument-takes`, with at most 12 takes and a shelf of 8 shared with Studio.
  - Export: a 16-bit mono WAV download.

**What it lacks**
- Tempo, metronome, quantise and per-hit velocity are missing; timing comes from wall-clock `performance.now()`.
- Nothing reaches the server.

**Phone.** The only music screen in the native app is `apps/mobile/src/app/(app)/instruments.tsx`, a pure-JS port at 22,050 Hz.

### 2.3 Server side

Songs are immutable versions: `music_songs` and `music_song_versions`, with lineage in `music_version_sources`. There are 45 `music_*` tables in migrations 0457–0518. **None holds an arrangement, project or mix.**

**Local renders in the Worker** are free; they write a `jobs` row with `provider 'local'`. They run in pure JS on PCM WAV ≤ 25 MiB, with no ffmpeg:
- Crop: `songs/[id]/crop`, using `lib/musicWavRender.js`.
- Fade, speed, a single reorder, and remaster: `songs/[id]/render`.

**Paid operations** run through fal, with quote and submit routes. Every row has `cost_unit per_generation` (0511):

| Operation | Catalog id | credits_5s |
| --- | --- | --- |
| Extend | `ace-step-extend` | 1 |
| Add section | `ace-step-add-section` | 1 |
| Replace section | `ace-step-replace-section` | 1 |
| Cover | `stable-audio-3-cover` | 2 |
| Stems | `mureka-stems-v3` | 13 |
| Target stems | `sam-audio-target-stem` | 13 |
| Track add | `mureka-audio-upload` + `mureka-track-add-v8` | 1 + 6 |

**Flags.** One JSON var, `MUSIC_RUNTIME_FLAGS` (wrangler.jsonc:111 and :351). It holds `studio`, `editing` and the rest. The Worker is at its 67-var limit, so **a new switch must be a key inside this JSON, not a new var.**

**Other storage**
- `SavedMusicMixes` holds localStorage prompt seeds, not audio mixes.
- `MusicWorkspaceCollaboration` handles membership only, with no shared editing.

### 2.4 Reusable outside Music

- **ADR-0080 video timeline.** A versioned JSON document that is validated and rejected, never repaired, and references media by asset id plus in/out points.
  - `app/veyrnox/_lib/editorSequence.mjs`: tracks, mute/lock and `SEQUENCE_LIMITS`.
  - `editorHistory.mjs`: undo/redo.
  - `editorAudio.mjs`: `mixAudio` at 48 kHz.
  - `editorTimeStretch.mjs`: `stretchAudio`.
  - Its timebase is 30 fps frames, with no beats or notes.
- **`encodeAudioBufferAsWav`** in `app/veyrnox/_lib/performanceStudio.js:274`.
- **Worker budget.** `scripts/check-worker-size.mjs:20` allows 59,000 KiB, and main sits at about 58,431 KiB. **Every byte of the editor must be in client chunks behind `dynamic(..., { ssr: false })`.**

### 2.5 Summary

Every ingredient exists as a separate, unsaved demo:
- a synth engine
- drum synthesis
- MIDI input
- effects
- recording
- latency measurement
- clip trims

The missing parts are **one shared clock, one project document, one timeline, and one export**. The design below supplies those four pieces and moves the demos onto them.

## 3. Reference products: what makes them feel professional

Sources were read on 2026-11-15. help.bandlab.com and support.soundtrap.com refused full-page fetches, so those two rows rest on official search snippets.

| Pattern | GarageBand (Mac/iOS; no web app) | BandLab Studio (web) | Soundtrap (web) | Suno Studio (web, Premier) |
| --- | --- | --- | --- | --- |
| Library docked, drag to grid | Loop Browser; drop aligns to bar/beat; loops follow tempo and key ([guide](https://support.apple.com/guide/garageband-iphone/add-apple-loops-chsb34bb00c/ios)) | Sounds Browser on the `L` key ([help](https://help.bandlab.com/hc/en-us/articles/360021363353)) | Loops panel, 7,720+ loops on free ([pricing](https://soundtrap.com/pricing)) | Library dock, drag songs in ([help](https://help.suno.com/en/articles/13670849)) |
| Step sequencer | Beat Sequencer: 16–64 steps, per-step velocity, Chance, Note Repeat, per-row length, swing ([support](https://support.apple.com/en-us/101954)) | Drum Machine: 8 rows, patterns A–H, 1/2/4 bars, 3-level velocity, one swing ([blog](https://blog.bandlab.com/how-to-use-drum-machine/)) | Patterns Beatmaker, 100+ kits ([product](https://www.soundtrap.com/content/product/patterns-beatmaker)) | No sequencer; generated parts instead |
| Trim, split, loop-extend | Edge-drag trim; loop by dragging the right edge; scissors split; pinch off snap ([guide](https://support.apple.com/guide/garageband-iphone/edit-regions-chsec12c15d/ios)) | Yes; quantise with `Q` | Yes | Yes |
| Takes | Multi-take per cycle pass, pick a take ([support](https://support.apple.com/en-us/101934)) | Comping is paid ([help](https://help.bandlab.com/hc/en-us/articles/48566287349017)) | — | Two Alternates per generation in take lanes ([help](https://help.suno.com/en/articles/7940161)) |
| Keyboard | Musical Typing: Z/X octave, C/V velocity ([guide](https://support.apple.com/en-gb/guide/garageband/gbndd5278cd1/10.4/mac/11.0)); arpeggiator on Mac | Musical Typing and MIDI devices | Piano roll, live MIDI | Musical typing, arpeggiator, chord mode ([welcome](https://suno.com/studio-welcome)) |
| Save | iCloud | Ctrl+S revisions in a tree | Autosave; Time Restore on paid | Autosave plus a Versions list |
| Export | Mix, cycle range or selection; WAV/AIFF/AAC/MP3 ([guide](https://support.apple.com/guide/garageband/export-songs-to-disk-or-icloud-gbnd7cbf5ed9/mac)) | Mixdown or per-track stems, M4A/WAV ([help](https://help.bandlab.com/hc/en-us/articles/115002959774)) | MP3/WAV/OGG/MIDI | Full, range or multitrack WAV ([help](https://help.suno.com/en/articles/13925249)) |
| Limits | 32 tracks on iOS ([page](https://www.apple.com/ios/garageband/)) | 16 free / 32 paid, 15 min ([help](https://help.bandlab.com/hc/en-us/articles/115002945433)) | Unlimited projects | Premier only |
| Loop licence | Royalty-free inside your work; no standalone redistribution; iOS bans AI training ([SLA](https://www.apple.com/legal/sla/docs/GarageBand.pdf)) | Royalty-free in a "larger composition"; no standalone use; no ML training ([terms](https://blog.bandlab.com/terms-of-use/)) | Royalty-free; no standalone resale | — |

### Patterns we copy

1. A docked library with **audition on tap** and drag to the grid. A drop lands on the nearest grid line.
2. Loops follow **project tempo and key**, and a "Match project" filter is on by default.
3. **Colour by region type**, not by track:
   - drums: amber pattern
   - MIDI: iris
   - audio: aqua
   - generated: rose
4. **Edge-drag trims; the top-right corner loop-extends.** Audio cannot be lengthened past its source.
5. **Snap on by default**, with the current snap value always visible.
6. The **step sequencer is an instrument**, and its pattern is an ordinary region that can be moved, looped and copied.
7. **Take lanes** for recording passes and for AI Alternates.
8. **Musical typing plus Web MIDI**, with visible octave and velocity readouts.
9. **Autosave and a Versions list.** Undo is deep and survives a reload within the session.
10. **One export menu** offering mix, cycle range and stems.
11. **Limits are shown plainly** before the user hits them.

The timing approach comes from the Web Audio "Tale of Two Clocks" lookahead scheduler ([web.dev](https://web.dev/articles/audio-scheduling)). The mixdown approach comes from [OfflineAudioContext](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext).

## 4. Proposed design

### 4.1 Layout and component map

Desktop is 1024 px and wider (see the desktop sketch).

```
┌ Top bar: ← Music · title · Saved · ↶ ↷ · Share · Export · Mixer ───────────────┐
├ Transport: ⏮ ▶ ● · Cycle · Count-in · bar.beat.tick + time · BPM · sig · key · Snap · Zoom ┤
├ Library (272) ┬ Ruler + cycle region ─────────────────────┬ Inspector (240) ─┤
│ Sounds        │ Track headers │ Regions on beat grid        │ Region: loop,    │
│ Instruments   │ name M S ● vol│                             │ gain, fades,     │
│ Mine          │ pan           │                             │ transpose        │
│ ✦ Generate    │ + Add track   │                             │ Track: presets,  │
│               │               │                             │ FX, sends, auto  │
├───────────────┴─ Editor dock: Step sequencer | Piano roll | Audio editor ─────┤
└───────────────────────── (Mixer replaces the dock when toggled) ─────────────────┘
```

**Phone (under 768 px; see the phone sketch)**
- Track headers shrink to a 60 px name with M/S.
- The library becomes a bottom sheet (half or full height). A "+" button adds the item at the playhead on the selected track; long-press and drag places it by hand.
- Selecting a region shows an action bar: Split, Loop, Copy, Trim, Fade, Delete.
- Opening a drum region gives a full-height step grid showing 8 steps per page (swipe for the other 8), with pads underneath.
- The inspector and mixer are full-height sheets.
- The editor is landscape-friendly, but works in portrait.

**Tablet (768–1023 px).** Library and inspector are drawers that overlay the timeline.

**Components**, all under `app/veyrnox/_components/music/beat/`, each under 500 lines:

| Component | Job |
| --- | --- |
| `BeatEditorLoader.jsx` | `dynamic(..., { ssr:false })` entry, mounted by `app/veyrnox/app/music/beats/[id]/page.js` |
| `BeatEditor.jsx` | Shell, layout switching, keyboard shortcuts |
| `BeatTransport.jsx` | Play, record, cycle, count-in, position, tempo, signature, key, snap, zoom |
| `BeatLibrary.jsx` + `BeatLibraryItem.jsx` | Tabs, search, filters, audition, drag source, "+" add |
| `BeatTimeline.jsx`, `BeatRuler.jsx`, `BeatTrackHeader.jsx`, `BeatRegion.jsx` | Arrangement. Canvas for waveforms and grid; DOM buttons for regions so they are accessible |
| `BeatStepSequencer.jsx` | The drum pattern editor |
| `BeatPianoRoll.jsx` | MIDI note grid; replaces the number-input table in `MusicStudioMidi` |
| `BeatAudioEditor.jsx` | Trim, fades, gain and reverse for one audio region (from `MusicStudioClipEditor`) |
| `BeatInspector.jsx`, `BeatMixer.jsx` | Region and track properties; channel strips |
| `BeatGenerateSheet.jsx` | AI part: prompt, quote, send, alternates |
| `BeatExportDialog.jsx` | Mix, range or stems; download, or save to the Music library |

Pure logic goes in `app/veyrnox/_lib/music/beat/` as `.mjs` modules with unit tests:
- `beatDocument.mjs`: schema, validate, migrate
- `beatOps.mjs`: every edit as a pure function
- `beatHistory.mjs`: wraps the `editorHistory.mjs` pattern
- `beatTime.mjs`: ticks, bars and seconds
- `beatScheduler.mjs`
- `beatEngine.mjs`
- `beatMixdown.mjs`
- `beatStore.mjs`: IndexedDB plus cloud save

### 4.2 Data model: the project document

The document is versioned JSON. It is validated at every boundary and rejected rather than repaired, following ADR-0080's rule. Every edit is a pure function `op(doc) → doc`, which gives undo, autosave diffs and tests for free.

**Timebase.** Musical time is integer **ticks at 960 PPQ**, so a bar of 4/4 is 3,840 ticks. Seconds are derived from the tempo map. This keeps patterns and loops exact when the tempo changes, which the video editor's frame timebase cannot do.

```jsonc
{
  "kind": "veyrnox.music.beat", "version": 1,
  "id": "uuid", "title": "Night Drive",
  "tempo": { "bpm": 92, "map": [] },          // v1: one tempo; map[] reserved for changes
  "signature": [4, 4], "key": { "tonic": "F", "mode": "minor" },
  "lengthTicks": 61440, "cycle": { "on": true, "start": 3840, "end": 19200 },
  "master": { "gain": 0.9, "fx": [] },
  "tracks": [
    { "id": "t1", "kind": "drums", "name": "Drums", "color": "amber",
      "instrument": { "engine": "veyrnox-synth", "instrument": "drums", "preset": "808" },
      "mute": false, "solo": false, "arm": false, "gain": 0.8, "pan": 0,
      "fx": [{ "type": "eq", "preset": "warm", "bypass": false }],
      "sends": { "reverb": 0.2, "delay": 0 },
      "automation": { "gain": [[0, 0.8], [15360, 0.6]] },
      "regions": [{ "id": "r1", "start": 0, "length": 3840, "loops": 4, "patternId": "p1" }] },
    { "id": "t2", "kind": "midi", "instrument": { "engine": "veyrnox-synth", "instrument": "synth", "preset": "pulse-bass" },
      "regions": [{ "id": "r2", "start": 3840, "length": 7680, "loops": 1, "clipId": "m1" }] },
    { "id": "t3", "kind": "audio",
      "regions": [{ "id": "r3", "start": 0, "length": 15360, "loops": 1, "assetId": "a1",
                    "offsetSec": 0.0, "gainDb": -2, "fadeIn": 0, "fadeOut": 0.04,
                    "reverse": false, "takeLane": null }] }
  ],
  "patterns": { "p1": { "steps": 16, "stepTicks": 240, "swing": 0.12,
                         "rows": [{ "voice": "kick", "hits": [[0, 110], [6, 80], [8, 120]] }] } },
  "clips": { "m1": { "notes": [[0, 480, 36, 100]] } },           // [startTick, lenTicks, pitch, vel]
  "assets": { "a1": { "source": "library", "ref": "sound:rhodes-fm-90", "bpm": 90, "key": "Fm",
                       "durationSec": 10.6, "followTempo": true } }
}
```

**Asset sources (`assets[].source`)**
- `library`: a Veyrnox sound id.
- `song-version`: an owned `music_song_versions.id`.
- `upload`: an owned upload with rights attestation (ADR-0335 rules).
- `take`: a local instrument or mic take.
- `generated`: a job id.

**Asset rules**
- The document never holds audio bytes and never holds a URL. Playback resolves a short-lived URL through the existing owned-asset routes at load time.
- `take` assets are local until the project is saved to the cloud. On cloud save they upload as private project media, or stay local and are marked "only on this device", the same relink pattern as ADR-0080.

**Limits**, as constants in `beatDocument.mjs` and checked on the server too:

| Limit | Value |
| --- | --- |
| Tracks | 16 (owner decision) |
| Regions | 400 |
| MIDI notes per project | 5,000 (replaces the arbitrary 64) |
| Patterns | 64 |
| Steps per pattern | 64 |
| Length | 10 minutes |
| Document size | 256 KiB of JSON |

### 4.3 Saving

**Phase 1–4: local-first.** IndexedDB `veyrnox-beat-projects`:
- autosave 800 ms after the last edit
- the last 20 snapshots as a local Versions list
- undo history of 200 steps, kept for the session

**Phase 5: cloud save.** A new owner-only table `music_beat_projects`, on the same pattern as Film Studio (ADR-0245):
- RLS forced, user JWT
- `save_music_beat_project` / `remove_music_beat_project` invoker wrappers, added to the allowlist in `scripts/test-default-privileges.mjs`
- erased with the account
- `music_beat_project_versions` keeps the last 20 saves

Saving is free, so no ledger rows are written. Optimistic concurrency uses a `revision` column, and a conflict offers "Keep mine / Load theirs". This needs a short ADR, because it widens the user-JWT surface named in CLAUDE.md.

### 4.4 Reuse and replacement

| Existing | Fate |
| --- | --- |
| `instrumentEngine.js` (`playEvent`, synth voices, drums) | **Reuse as the sound source** for drum, keys, bass, guitar and synth tracks. Extend `playEvent` with a velocity → gain curve and a per-voice output node so each track has its own channel strip. |
| `lib/musicInstruments.js` presets | Become the "Instruments" library tab and the track instrument picker. |
| `MusicStudioMidi.jsx` wavetable voices, Web MIDI, musical typing | Move the voice code into `beatEngine` as a `wavetable` engine. Move input handling into a shared `useMusicInput` hook. Remove the 64-note cap. |
| `MusicStudioEffects.jsx` effect graph | Move node construction into `beatEffects.mjs`, used per track and on the master, with offline render support. |
| `MusicStudioClipEditor.jsx` trim, fade and reverse | Logic moves into `beatOps` (non-destructive, applied at playback and mixdown). The dialog becomes `BeatAudioEditor`. |
| `MusicStudioRecorder.jsx` + `MusicStudioLatencyCalibration.jsx` | Recording targets an armed audio track. The measured latency is stored per device in localStorage and subtracted from take positions. |
| Instrument page takes and shelf | Show in Library → Mine → Takes. Dropping one creates a `take` asset (audio) or, if it carries events, a MIDI clip. |
| `MusicStudioWorkspace.jsx` | Kept until the beat editor reaches phase 6. Then "Open in Studio" on a song creates a beat project with that version on track 1, and the old page redirects. The decision on retiring it sits with the owner (D5). |
| `encodeAudioBufferAsWav` | Mixdown and stem encoder. Extend it for 24-bit output. |
| `editorHistory.mjs` / `editorSequence.mjs` | Copy the history pattern, not the frame model. |
| Server crop/render routes | Not used by the editor: the editor is non-destructive, so it never rewrites a song. |

### 4.5 Audio engine

One `AudioContext` per editor, created on the first user gesture (a requirement on iOS). The graph:

```
source nodes ─▶ region gain (fades) ─▶ track FX chain ─▶ track gain (automation) ─▶ pan ─┬▶ master FX ─▶ master gain ─▶ limiter ─▶ destination
                                                                    sends ──▶ reverb bus / delay bus ─┘
```

**Scheduler** (`beatScheduler.mjs`)
- A lookahead loop runs every 25 ms. It schedules every event whose time is less than `currentTime + 0.1 s`.
- The loop runs on a `Worker` timer, so a busy main thread or a background tab does not starve it.
- Events come from a precomputed, sorted event list per track. It is rebuilt only when an op changes that track.
- Cycle wrap is handled by scheduling across the loop seam.
- Tempo or mute changes take effect within the 100 ms lookahead.

**Sources**
- Drums and MIDI use `playEvent` voices, scheduled at exact times.
- Audio regions use `AudioBufferSourceNode.start(when, offset, duration)` on decoded buffers. Loops use repeated starts, not `loop=true`, so fades and trims stay exact.
- Decoded buffers are cached by asset id. A memory cap of about 300 MB of PCM evicts least-recently-used assets and re-decodes on demand.

**Follow tempo.** An audio loop whose source BPM differs from the project's needs a pitch-preserving stretch.
- v1 renders a stretched copy offline with `editorTimeStretch.mjs` (`stretchAudio`) when the clip is dropped or the tempo changes, and caches it.
- Live time-stretch through an AudioWorklet (Safari 14.1+) is a later option, not v1.
- Loops without BPM metadata do not follow tempo.

**AudioWorklet** is not needed for v1. Add it only for live stretch, sample-accurate metering, or a custom synth that `OscillatorNode` cannot express. Meters in v1 use `AnalyserNode` at 30 fps.

**Latency**
- Visual playhead time is `currentTime − outputLatency`, falling back to `baseLatency` on Safari earlier than 18.4.
- Record alignment subtracts the calibrated round-trip time.
- Musical-typing input is quantised to the snap grid only when the user turns quantise on. Otherwise the event is placed at `currentTime` at the moment of the key press.

**Metronome.** It is scheduled by the same scheduler on the same context, replacing the per-tick `AudioContext` in the old workspace.

### 4.6 Mixdown and export

**In the browser.** `beatMixdown.mjs` rebuilds the same graph on an `OfflineAudioContext` at 48 kHz stereo and calls `startRendering()`. The same op code runs in both places, so playback and export cannot drift apart.

Export options:
- full mix
- cycle range
- stems: one file per track, rendered with the others muted

Formats: WAV in 16- or 24-bit. Compressed output is not in v1; WebCodecs AAC could come later.

The cost is zero Credits and no server load. 10 minutes of stereo at 48 kHz is about 115 MB in memory, which is acceptable on desktop. Phone memory is the risk, so on phones the render is chunked into 60 s segments and concatenated.

**Save to Music library**
- The rendered WAV is uploaded through the existing owned-source upload path, with the rights check, and creates a song plus version with `operation 'studio_mixdown'`.
- That operation needs a migration adding it to the allowed operation list, and a `jobs` row on the `provider 'local'` pattern (0473).
- Uploads over 25 MiB are refused with a clear message.

**No server render in v1.** The Fly concat runner (ADR-0261) stays an option if phone memory proves too small. It would need an ADR, and a Music bucket path for the runner.

### 4.7 AI generation inside the editor

Every AI action runs quote → shows the exact Credit price → user presses Send → result lands as a region. That is the existing quote and submit pattern, so nothing spends Credits without a visible price and a press (`suno-music-parity-spec.md` P3).

| Action | Backed by | Price |
| --- | --- | --- |
| **Generate a part** ("warm sax hook, 4 bars"): prompt plus the project's BPM, key and the cycle length | New catalog row, e.g. `ace-step-loop`. Instrumental, length = cycle range, BPM and key in the prompt. Two Alternates go into take lanes. | `model_catalog`; needs a migration and an owner price decision (D6) |
| **Split a song into stems → tracks** | Existing `mureka-stems-v3` | 13 credits_5s, existing |
| **Pull one instrument out** ("just the drums") | Existing `sam-audio-target-stem` | existing |
| **Extend / replace a section of an audio region** | Existing `ace-step-extend` / `ace-step-replace-section`. Result arrives as a new region; the original is kept. | existing |
| **Track add** (a new part over the mix) | Existing `mureka-track-add-v8` on a cycle-range mixdown | existing |

Rules that hold for every row:
- Results arrive as `generated` assets and go through the existing scanning and hold rules.
- A held result shows a placeholder region that says why.
- A failed job shows "Credits returned" (existing refund path).
- The Generate sheet keeps the user's prompt across failures and session expiry.
- No AI spend happens on drop, preview or playback.

### 4.8 Accessibility

- **Keyboard**
  - Space plays and stops. R records, C toggles cycle, ⌘/Ctrl-Z undoes and ⇧⌘/Ctrl-Z redoes.
  - Arrows move the selected region by one snap step; ⇧ + arrows trim.
  - ⌘/Ctrl-E splits at the playhead. ⌘/Ctrl-L loops. Delete removes.
  - Musical typing toggles with ⌘/Ctrl-K, as in GarageBand.
  - Every shortcut is also a visible button or menu item.
- **Step grid**
  - `role="grid"` with arrow-key movement. Each step is a toggle button whose accessible name reads like "Kick, step 5, on, velocity 110".
  - Velocity changes with +/− or long-press.
- **Regions** are DOM buttons, labelled for example "Lo-fi Rhodes, bars 2 to 5, looped 2 times". Moves and trims are announced through a live region ("Moved to bar 3").
- **Text alternatives**
  - The waveform canvas has a text alternative.
  - Meters expose their level through `aria-valuenow` only when focused.
- **Touch targets** are 44 px. The phone step grid uses 36 × 44 cells, and pad cells are 84 × 64.
- **Reduced motion.** The playhead still moves, because it carries information. Animated meters, pad glow and drop bounce are turned off.
- **Colour** never carries meaning alone: each region type also has a glyph (pattern dots, MIDI bars, waveform, ✦).
- **Strings.** Every string is in the 11 locales.

### 4.9 The nine states (plus validation and success)

| State | Behaviour in the editor |
| --- | --- |
| Empty | A new project shows one empty Drums track with a 1-bar pattern open and the library on Drums. Copy: "Tap steps to make a beat, or drag a loop in." Templates: Hip-hop, Lo-fi, House, Blank. |
| Loading | A skeleton of transport, library and three track rows renders within 100 ms. Assets show a per-region "decoding" bar, and the grid is usable before audio is ready. |
| Error | A region whose asset fails shows "Couldn't load this sound — Retry / Replace", and the rest plays. A broken document is refused with "This project file is damaged — open the last good version". No raw errors are shown. |
| No internet | The editor keeps working on local projects and the library cache. Cloud save shows "Offline — saved on this device" and syncs on reconnect. Generate and Save to library say they need a connection. |
| Slow network | Library previews stream. Uploads and AI jobs show the step and percent, and use the existing job watcher. |
| Service outage | One `ServiceStatusBanner`. Local editing continues. |
| No search results | "No sounds match 'tabla 140'". Offers "Clear filters" and "Turn off Match project", plus two suggestions (nearest category, ✦ Generate it). |
| Permission denied | Opening someone else's project: "This project belongs to another account", with a link to Music. Microphone blocked: how to allow it in browser settings. A plan-gated feature names the plan. |
| Session expired | Local autosave means nothing is lost. A sign-in prompt returns to the same project and selection. |
| Form validation | BPM 40–240, length and track caps, and the prompt length are checked inline at the field. |
| Success | Export: "Night Drive.wav saved — Open in Music". AI: "Sax hook added — 6 Credits spent, balance 120". No confetti. |

### 4.10 Performance and bundle limits

- **Worker:** 0 KiB added to the server bundle.
  - The route page is a thin server component that renders `BeatEditorLoader`, which is dynamic with `ssr:false`.
  - Check this with `scripts/check-worker-size.mjs` on every phase PR.
- **Client bundle.** No new npm dependency in v1: Web Audio, Canvas and the in-repo stretch and WAV code are enough. Initial editor chunk under 180 KB gzip; the piano roll, mixer and export dialog load lazily when first opened.
- **Runtime targets**
  - 60 fps playhead and scrolling with 16 tracks and 400 regions. Only visible regions render; waveforms are canvas peak caches computed once per asset in a Worker.
  - No audio glitches with 16 tracks of mixed content on a 2020-class laptop and an iPhone 12.
  - Scheduler callback under 2 ms.
- **Memory.** Decoded audio is capped at about 300 MB with LRU eviction. Stems export renders tracks one at a time.
- **CSP.** No new hosts. Audio comes from our own R2 endpoints and the existing presigned routes. A licensed library would be stored in our R2, never hot-linked.

### 4.11 Flags and rollout

- **The switch** is a key inside `MUSIC_RUNTIME_FLAGS` (`beatEditor`), off by default. There is no new Worker var.
  - Unlike the current studio page, the beats route itself checks the flag.
  - Staging first; production on the owner's word.
- **Cloud save (phase 5)** additionally waits for its migration and 24 h of clean reconciliation, as the CLAUDE.md delivery rules require.

## 5. Build phases

Each phase is one PR, flag-off, about 1–3 days of build time, and ends with the design-goal lines it touches. Most valuable first: **people can make and keep a beat before anything else.**

### Phase 1: Beat maker core (recommended first, about 2–3 days)

**Scope**
- New route `/app/music/beats/new` and `/app/music/beats/[id]`.
- `beatDocument`, `beatTime`, `beatScheduler` and `beatEngine`, reusing `playEvent` drums.
- `BeatTransport`: play/stop, BPM, swing, metronome on the shared clock.
- `BeatStepSequencer`:
  - 8 rows from the drum kit, and 16 or 32 steps
  - per-step velocity
  - 3 kits
  - patterns A–D
  - `role="grid"` keyboard support
- Local autosave to IndexedDB, plus a "My beats" list.
- WAV download through OfflineAudioContext.
- Phone layout for the step grid and pads.

**Done when**
- A person can make a 1-bar beat, change tempo and swing, switch kits, reload the page and find it again, and download a WAV that matches what they heard.
- The scheduler holds timing within 1 ms of the audio clock over 5 minutes of looping, with a background tab and a busy main thread.
- Worker size is unchanged.

**Tests**
- Unit tests for document validation, pattern-to-event expansion with swing, tick and second maths, and the scheduler with a fake clock.
- Offline-render snapshot: a pattern renders to a known RMS and onset times.
- Playwright on a local build: create, edit, reload, export.
- Browser pane at 375 px and 1280 px in both themes.

### Phase 2: Arrangement timeline (about 3 days)

**Scope**
- Tracks with headers (mute, solo, gain, pan) and a ruler with a cycle region.
- Pattern regions placed on the grid: move, copy (⌥/Alt-drag), loop-extend from the corner, edge trim, split, delete.
- Snap values: bar, 1/4, 1/8, 1/16, off. Zoom.
- `beatOps` plus `beatHistory` with 200 undo steps.

**Done when**
- A 16-bar song can be built from patterns A–D across two drum tracks.
- Every op is undoable.
- Keyboard-only editing works.
- Playback matches the export.

**Tests**: property tests on ops (an op and its undo return the same document; documents stay valid), Playwright drag/trim/split, an axe pass.

### Phase 3: Library panel and audio regions (about 2–3 days)

**Scope**
- `BeatLibrary` tabs:
  - **Instruments**: presets from `musicInstruments.js`.
  - **Mine**: the takes shelf, owned songs and versions, and uploads with attestation.
  - **Sounds**: the starter set, depending on D2.
- Audition, search, filters, drag-to-timeline and phone "+".
- Audio regions: decode, peak cache, trim, fades, gain, reverse, loop.
- Follow-tempo stretch through `stretchAudio`.

**Done when**
- Dragging an owned song version and an instrument take into the arrangement plays them in time.
- A 90 BPM loop placed in a 92 BPM project stays in time without a pitch change.

**Tests**: unit tests for asset resolution and stretch length maths, Playwright drag-in, and a memory check with 16 audio tracks.

### Phase 4: Piano roll and playable keyboard (about 3 days)

**Scope**
- MIDI tracks using the `playEvent` keys, bass and synth voices plus the wavetable voices from `MusicStudioMidi`.
- `BeatPianoRoll`: draw, move, resize, velocity lane, quantise.
- Record from musical typing, the on-screen keyboard and Web MIDI, with count-in.
- Instrument takes dropped in become editable MIDI clips.
- Drum patterns can be converted to MIDI.

**Done when**
- A bass line can be played in from the computer keyboard, quantised and edited.
- The 64-note cap is gone (5,000 per project).

**Tests**: unit tests for record-to-ticks and quantise; a Web MIDI mock in Playwright.

### Phase 5: Cloud save and versions (about 2–3 days, plus ADR)

**Scope**
- Migration for `music_beat_projects` and its versions table, RPC wrappers, the allowlist entry, the account-deletion classification, and the save route.
- Autosave sync with revision conflicts.
- Versions list.
- Take uploads to private storage.

**Done when**
- A project opened on a second browser is identical.
- A conflict is offered rather than lost.
- Deleting the account erases the projects.

**Tests**: acceptance tests against local Postgres (RLS, idempotent save, revision conflict), `test-default-privileges`, `test-account-deletion`.

### Phase 6: Export and save to Music (about 2 days)

**Scope**
- `BeatExportDialog`: mix, cycle range or stems, in 16- or 24-bit.
- "Save to Music library" creates a song version (`studio_mixdown`, migration).
- Phone chunked render.
- Retire `MusicStudioWorkspace` behind a redirect (D5).

**Done when**
- An exported mixdown is identical to an offline re-render.
- A saved mixdown appears in the library with lineage.

**Tests**: render-equivalence test, route tests for the commit, and Playwright export on a 375 px viewport.

### Phase 7: AI parts (about 2–3 days)

**Scope**
- `BeatGenerateSheet`: Generate a part into take lanes with two Alternates.
- Split stems into tracks, Target stem, and Extend/Replace on a region.
- Every action uses quote → send → region.
- The new `ace-step-loop` catalog row is added (D6).

**Done when**
- The shown price equals the catalog quote.
- A failure shows Credits returned.
- A double tap does not double-submit, because requests carry an idempotency key.
- A held result cannot be exported.

**Tests**: quote and submit route tests, the refund path, and Playwright with the fake provider (memory: `local-signed-in-preview-with-stub-supabase`).

### Phase 8: Mixer, effects and automation (about 3 days)

**Scope**
- `BeatMixer` channel strips: meters, the effects chain from `MusicStudioEffects`, reverb and delay sends, and a master limiter.
- Volume and pan automation lanes, drawn as points with curves.

**Done when**: automation sounds the same in playback and in export, and 16 tracks with 3 effects each play without glitches on the reference devices.

### Phase 9: Recording and take lanes (about 3 days)

**Scope**
- Arm an audio track and record with count-in. Cycle recording makes takes in lanes; the user picks a take and comps between takes with crossfades.
- Latency compensation from calibration.

**Done when**: a click recorded through a loopback lands within 5 ms of its grid line after calibration.

### Phase 10: Polish pass (about 2 days)

**Scope**
- Templates.
- First-run coach marks.
- Shortcut sheet.
- Full nine-state review.
- XL text.
- 11-locale strings.
- `design-goal-criteria.md` proof on every screen.

### Later, not sized

- Tempo changes over time.
- Arpeggiator and chord mode.
- Live AudioWorklet stretch.
- AAC export.
- Real-time collaboration.
- Native mobile app port.
- Licensed sample-library expansion (depends on D2).

## 6. Risks

| Risk | Mitigation |
| --- | --- |
| Phone memory during decode and export | LRU buffer cache, chunked offline render, a phone track cap if needed |
| iOS audio unlock and silent-switch behaviour | Create the context on first tap; show a "Tap to enable sound" state |
| Synthesised drums sound less "pro" than samples | Tune kits in phase 1; the sample library depends on D2 |
| Follow-tempo stretch quality | Offline stretch with cached result; disable follow-tempo for loops without BPM metadata |
| Scope creep toward a full DAW | Phases stop at 10; anything else needs a new decision |
| Worker size | Thin server page plus dynamic import; checked in CI |

## 7. What this design does not change

- No price is computed in app code.
- No ledger writes outside the existing quote and submit RPCs.
- No new CSP hosts.
- No new Worker vars.
- No server-side audio processing in v1.

## 8. The goal is met when… (lines this work will be checked against)

- Layout holds at 375 px and 1280 px with no horizontal page scroll. The timeline scrolls inside its own region.
- Every tappable control is at least 44 CSS px on touch.
- Every control has an accessible name, every status change is announced, and every focusable element shows a focus ring and is keyboard-operable.
- Web colours are `vx` tokens in both themes:
  - aqua marks actions
  - amber appears only on Credit amounts (the drum-region amber in the sketch becomes a feature hue)
  - feature hues name region types
- With reduced motion on, looping animation is off.
- Every state in 4.9 is handled.
- Before a Credit spend the exact cost is shown, and afterwards the new balance. A failed submit says the Credits were returned. Paid buttons disable while a request runs, and requests carry an idempotency key.
- The price shown equals the catalog quote.

## 9. Owner decisions

| # | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| D1 | Does the free tier get the editor? | (a) Everything free except AI parts; (b) free with limits (e.g. 8 tracks, 3 cloud projects), full with a plan; (c) paid only, like Suno Studio | **(a) at launch.** It costs us nothing to run (browser-side), and it pulls people into paid AI parts. Revisit limits after usage data. |
| D2 | Sound library source and licence | (a) Synthesised kits and instruments only (exist, zero licence risk); (b) commission an original sample pack we own outright; (c) license a commercial royalty-free pack with in-app redistribution rights; (d) CC0 sounds (Freesound CC0 only; CC BY needs attribution in every export, so no) | **(a) for phases 1–4, then (b).** Owning the pack avoids terms that ban "standalone" use and AI training, which a generator platform would trip over. (c) only with written in-app redistribution and AI terms. |
| D3 | Track and length limits | 8 / 16 / 32 tracks; 5 / 10 / 15 minutes | **16 tracks, 10 minutes for everyone** (BandLab free is 16 / 15 min). Phones may get 8 if memory testing fails. |
| D4 | Cloud project count per account | Unlimited / 20 free / tied to plan | **50 per account** at launch; it is JSON only and cheap. |
| D5 | Fate of the current Studio page | Keep both / retire after phase 6 / retire now | **Retire after phase 6.** "Open in Studio" then opens a beat project seeded with the song. |
| D6 | New catalog row and price for "Generate a part" | Use `ace-step` at its `credits_5s` / a new `ace-step-loop` SKU with its own price / no in-editor generation | **New `ace-step-loop` row** priced from a staging probe, reading the fal bill before activation (the house rule). |
| D7 | Does "Save to Music library" of a mixdown that contains library sounds or another person's song version need the rights attestation? | Always / only for uploads / never | **Only when the project contains `upload` assets.** Library and generated sounds are ours; owned versions are the user's. |
| D8 | Native mobile app | Web only (phone-browser layout) / port to the Expo app later | **Web only for phases 1–10.** The engine is Web Audio; a native port is a separate project. |
| D9 | Public sharing or remixing of projects | Not in v1 / view-only share / remixable | **Not in v1.** |
