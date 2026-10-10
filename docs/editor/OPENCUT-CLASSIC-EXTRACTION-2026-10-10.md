# Slice 0b: can OpenCut Classic's editor core be reused? (ADR-0080)

**Status:** Done 2026-10-10 · read-only · **no code adopted, nothing copied into this repo**
**Source read:** `opencut-app/opencut-classic` at `cf5e79e` (2026-05-17, the last commit; the repo is archived), shallow-cloned into a scratch
folder and only read, never installed or run. MIT licence ("Copyright 2025-2026 OpenCut").
**Verdict:** **Yes, the TypeScript editor core is separable and worth adapting.** The one WebAssembly dependency in it is integer time
arithmetic. The renderer is plain Canvas 2D and the exporter is the same Mediabunny design the slice 0 spike proved. Adopt it as a
**starting point we own**, not as a dependency, and keep its assets and services out.

## What it is

A Next.js 16 / React 19 / Mediabunny web editor. `AGENTS.md` says business logic was being migrated into a Rust core (`rust/`, with a
desktop app on GPUI); that migration was **in progress** at this snapshot, so a lot is still TypeScript. **648** TypeScript files in `apps/web/src` (about 29 k lines in the folders marked Adapt below).

## What is separable, by folder (non-test TypeScript files, and how many import each concern)

| Folder | Files | Lines | WASM glue | Next.js | DB / auth | Verdict |
|---|---|---|---|---|---|---|
| `timeline` | 103 | 16.9k | 49 (time maths only) | 1 | 0 | **Adapt**: tracks, clips, drag, trim, snapping |
| `commands` | 53 | 4.0k | 13 (time maths only) | 0 | 0 | **Adapt**: command and undo stack |
| `actions`, `selection` | 19, 13 | 2.0k, 1.0k | 1, 0 | 0 | 0 | Adapt |
| `ripple`, `retime`, `speed` | 4, 6, 1 | 0.9k | 0 | 0 | 0 | **Adapt**: pure logic |
| `text`, `subtitles` | 6, 7 | 2.3k | 1, 1 | 0 | 0 | Adapt (drawn on canvas, matches our no-DOM-text rule) |
| `services/renderer` | 17 | 2.6k | optional compositor only | 0 | 0 | **Adapt**: scene graph and `CanvasRenderer` |
| `services/renderer/scene-exporter.ts` | 1 | 171 | 0 | 0 | 0 | **Adapt**: `Output` + `CanvasSource` + `AudioBufferSource`, MP4 or WebM, quality presets, cancel |
| `services/video-cache` | | | | 0 | 0 | Adapt: decode cache for scrubbing (we have not built this yet) |
| `masks`, `effects` | 24, 7 | 7.7k | 0 | 0 | 0 | Later (slice 2+) |
| `components` (UI), `preview` UI | 86, 24 | 16k | | | | **Rewrite in our design system**; React but styled for their app |
| `auth`, `db`, `blog`, `changelog`, `site`, `feedback`, `env` | | | | | | **Do not take** |

Across the editor folders **nothing imports the database or auth layer**, and only one timeline file imports Next.js.

## The WebAssembly question, answered

- Counting every named import of `opencut-wasm` across the source (including multi-line imports), there are **20 distinct symbols**.
  **Ten are time maths**: `FrameRate`, `TimeCodeFormat`, `TICKS_PER_SECOND`, `mediaTimeFromSeconds`, `mediaTimeToSeconds`, `roundToFrame`,
  `lastFrameTime`, `snappedSeekTime`, `parseTimecode` and `formatTimecode`, used by the timeline through one wrapper
  (`src/wasm/media-time.ts`, 233 lines) and imported directly in about 25 files. **The other ten are the GPU compositor**
  (`initializeGpu`, `initCompositor`, `renderFrame`, `uploadTexture`, `releaseTexture`, `resizeCompositor`, `getCompositorCanvas`,
  `getLastFrameProfile`, `applyEffectPasses`, `applyMaskFeather`), each used **once**, in `compositor/wasm-compositor.ts`. One dynamic
  import in `project-manager.ts` loads the module at start-up.
- The time maths is about a hundred lines of TypeScript (integer ticks, rounding to a frame, timecode parse and format). Re-implementing it
  and dropping the compositor path removes the WebAssembly dependency from the whole editor, so **the CSP stays as it is** (the condition
  ADR-0080 set).
- The Rust `gpu` and `compositor` crates are reached only through `services/renderer/compositor/wasm-compositor.ts`. Every place that
  builds a renderer (`project-manager`, `renderer-manager`, the preview, and the scene exporter) constructs **`CanvasRenderer`**, the 2D
  canvas one. The WASM compositor is an alternative path we would simply not bring.

## What it would save, and what it would not

- **Saves:** the timeline data model and interactions, the command and undo system, ripple and retime logic, snapping, a scene-graph
  renderer, a decode cache, subtitle and text layout. These are the large, fiddly parts of a CapCut-style editor (about 29 k lines in
  the folders marked Adapt).
- **Does not save:** the interface (their components are built for their design system), our persistence (a timeline must become a
  versioned **project document**, ADR-0080), our asset access (Library and project assets through signed URLs), our flags and money
  paths, or the AI buttons.
- **Cost of owning it:** the upstream is archived and its author moved to a rewrite, so we would **fork a snapshot and maintain it
  ourselves**. There are 30 test files to start from. Code quality beyond structure is **unread**: this was a structural check, not a
  code review.

## Licences and things to leave behind

- The repo has **one licence file (MIT) and no NOTICE or third-party list**. MIT lets us copy and modify, on the condition that the
  copyright and licence text travel with the code. Anything adopted gets a header and a `THIRD_PARTY` entry.
- **Leave behind:** the 15 AVIF **font atlas** chunks (Google Fonts, each family under its own licence, and the app also fetches fonts
  from `fonts.googleapis.com`, which our CSP does not allow); the **stickers** folder (country flags and brand **logos**, which are
  trademarks); the **sounds** panel (it queries the third-party Freesound API, with per-sound Creative Commons licences); and the
  analytics, blog and marketing pieces.
- Their **name and branding** are not ours to use. Nothing here proposes it.

## Recommendation

1. **Adapt a snapshot, behind a clean boundary:** a new `lib/editor/` (pure logic: time, timeline model, commands, ripple, retime,
   renderer, exporter) with **no React, no Next and no network**, and an `app/` UI in our design system.
2. **Replace `media-time` with our own TypeScript** first. That is the only change that touches every file.
3. **Start with the exporter, the scene graph and the time module**, because slice 0 already proved that path; then the command stack.
4. **Do not import its assets, stickers, sounds, fonts or services.** Use our Library and project assets, bundled fonts, and our own
   (priced) AI steps.
5. **Done 2026-10-10 (see [OPENCUT-EXTRACTION-SPIKE-2026-10-10.md](OPENCUT-EXTRACTION-SPIKE-2026-10-10.md)): it passed.** Original wording: a one-day extraction spike that copies `media-time`, `ripple`, `retime` and `scene-exporter` into a
   scratch folder, replaces the WASM time module, and runs their own unit tests against it. If those pass, adopt; if not, write our own.

## Not checked

The code's quality and test results (nothing was installed or run), how **masks and effects** render on the Canvas path (the compositor
has `applyMaskFeather` and `applyEffectPasses`; the Canvas path was not traced), the licences of its npm dependencies, whether `video-cache` and
the scene graph hold up on real footage, and any patents. None of this is legal advice; the MIT notice rule is the only condition I
read.
