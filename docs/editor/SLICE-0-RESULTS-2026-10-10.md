# Slice 0 results: browser timeline engine spike (ADR-0080)

**Status:** Done 2026-10-10 · spike code in `scripts/editor-spike/` · nothing shipped, no flag, no CSP change
**Question:** can the pinned Mediabunny 1.60.0 decode several clips at once, composite them with a text layer on a canvas, mix
audio, and write one MP4 in the browser? How fast, how much memory, and what breaks?
**Answer:** **Yes.** Every content check passed. One finding changes the plan: **hardware H.264 encoding has a long, variable
first-use stall; prefer software encoding.**

## What was tested, and on what

| | |
|---|---|
| Machine | Apple M5, 16 GiB, macOS 27.0.1, **busy** (other sessions were building and testing at the same time) |
| Browser | Google Chrome 154.0.0.0 (headless, driven by playwright-core); one headed run for comparison |
| Engine | Mediabunny 1.60.0 (the version in `package.json`); `CanvasSink`, `AudioBufferSink`, `CanvasSource`, `AudioBufferSource`, `Output` |
| Media | **Synthetic** clips made with ffmpeg (a flat colour, a white box moving 200 px a second to prove frame order, and a different sine tone per clip). No real footage. |
| Output | H.264 (`avc`, `QUALITY_HIGH`) + AAC 128 kb/s, 30 fps, MP4, held in memory (`BufferTarget`) |

Outputs were checked **outside the browser** with ffprobe and ffmpeg: stream types, frame count, duration, the colour and box position
at chosen times, whether the text was visible, and a Goertzel filter for each tone.

## Results

### Scenario 1: 720p, 9.5 s, three clips

Clip A (blue, 440 Hz) crossfades into clip B (red, 880 Hz) over 0.5 s; a portrait clip C (green, 330 Hz) follows, letterboxed; a 220 Hz
music bed runs underneath at 0.3 gain; a text layer shows from 4 to 6 s.

All 14 checks **passed**: H.264 and AAC stereo 48 kHz; exactly 285 frames; duration 9.5 s with audio and video within 0.1 s; the right
colour at 1.0, 3.75, 5.0 and 8.5 s; the box where frame order says it must be; the text visible at 5.0 s and gone at 6.5 s; black
bars either side of the portrait clip; and during the crossfade both 440 Hz and 880 Hz present.

### Scenario 2: 1080p, 55.5 s, ten clips

Ten clips from two 1080p sources, nine 0.5 s crossfades, three text layers, clip audio only.

| | Software encode (`prefer-software`) | Default (hardware) |
|---|---|---|
| Wall time | **25.9 s** (2.15x real time, 64 frames a second) | **107.5 s**, of which **86 s was the first second** |
| Peak browser memory (all Chrome processes) | 868 MB | 781 MB |
| Peak JS heap | 39 MB | 32 MB |
| Checks (frame count 1665, duration, colours, tones) | all pass | all pass |

About 11.8 s of the software run was the audio mixdown (decoding ten clips' audio into one buffer before encoding starts). That can be
pipelined later.

### The finding: hardware encoder cold start

| Case (720p, fresh Chrome each time) | First output second |
|---|---|
| Default encoder, no warm-up | **4.5 to 27 s**, then about 0.1 s a second |
| Warming up with a raw WebCodecs encoder | No help (4 to 26 s) |
| Warming up with a tiny real Mediabunny export first | The warm-up itself took 6.5 to 19 s; the export after it took 1.9 to 2.1 s |
| **`hardwareAcceleration: 'prefer-software'`** | **No stall. Whole export 2.3 to 2.8 s** |

The stall sits in the library's **first encoder use in a browser session** (the first `add()` waits), and is the same in headless and
headed Chrome. Software encoding avoids it and is fast enough at 1080p. A second export in the same Chrome is fast either way.

An earlier "slow decode" was a different cause: using `canvasesAtTimestamps()` (the library's sparse-access iterator) for sequential
playback. Switching to the sequential `canvases()` iterator removed it.

### Other behaviour

| Test | Result |
|---|---|
| Cancel after 0.8 s | Stopped **6 ms** after the abort; output cancelled cleanly |
| A clip with no audio track among clips that have one | Fine (0.4 s) |
| Decoding in Chrome 154 on this Mac | **All opened and decoded:** MP4 H.264+AAC, **MOV** H.264, **WebM** VP9+Opus, **HEVC** MP4, H.264 with **Opus** audio in MP4, video-only MP4, WAV |

Export is always H.264 + AAC whatever the inputs were, so the decode list is wider than ADR-0056's upload list (JPEG, PNG, WebP, MP4, MP3,
WAV). Decode support is a property of the user's browser and OS; HEVC in particular depends on the platform.

## What this does not prove

- **One machine, one browser build, a busy machine.** Timings varied a lot run to run; treat them as orders of magnitude.
- **No real footage.** Synthetic clips compress to almost nothing (2.8 MB for 55 s). Real 1080p at `QUALITY_HIGH` is much larger, and
  `BufferTarget` holds the whole file in memory. Peak memory with real footage is **unmeasured**.
- **Not tested:** Windows or Linux Chrome, Edge, Firefox, Safari (ADR-0065 keeps WebKit preview-only), machines with less than 16 GiB,
  4K, timelines over 60 s, and a live preview (this was export only).
- **The warm-up question is open for hardware encoding.** If hardware encoding is wanted later (it may be faster on long exports), it
  needs its own measurement on quiet machines.

## What this changes in the plan

1. **Encode with `prefer-software`** for slice 1. Revisit hardware encoding only with its own measurement.
2. **Use the sequential decode iterator**, with a small canvas pool, for preview and export.
3. **Slice 1 caps, supported by these numbers:** 1080p or 720p, up to **60 s and 10 clips**, which exported in about half the clip length
   on this machine. 4K stays out until measured.
4. **Pipeline the audio mixdown** (decode and mix as the encode runs) before a 60 s timeline is offered; it was 12 s of a 26 s export.
5. **Accept more input types in the editor than the upload list allows?** Decoding MOV, WebM and HEVC worked here, but that is a
   per-browser fact, so slice 1 should use real `canDecode` checks and say clearly when a file cannot be used.
