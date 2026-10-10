# ADR-0080 — Browser timeline editor (backlog M05), free and local first

- **Status**: **Proposed 2026-10-10.** Nothing is built. Owner decisions recorded below.
- **Related**: backlog M05 (`docs/architecture/implementation-backlog.md`), ADR-0029 (Auto Short, `job_steps`), ADR-0051 and
  ADR-0055 (tenant projects, project documents with history), ADR-0056 (project media, quarantine and inspection), ADR-0060
  (CSP), ADR-0065 (Video Enhance browser runtime), ADR-0074 (video agent), `docs/editor/PRD.md`, `docs/editor/CAPCUT-GAP-2026-10-10.md`

## Context

The owner wants CapCut-style editing in Veyrnox.ai. Today the Clip Editor is a **server chain of priced steps** (trim, stitch, add
audio, captions, slow motion). It has no timeline, no preview of the combined result, and every change is a paid job. A timeline
needs the opposite: instant, free, interactive composition, with paid AI work attached only where it is genuinely AI.

Facts from the repo (read 2026-10-10):

- **A browser engine already exists.** `/app/enhance` decodes, filters and re-encodes MP4 in the browser on WebCodecs through
  Mediabunny 1.60.0 (`app/veyrnox/_lib/videoEnhanceExport.mjs`). It needs no WebAssembly for the export path, and the CSP already
  allows `blob:` for `media-src` and `img-src`. It is gated and not live (PR #361, ADR-0065 "Proposed").
- **Its proven limits are narrow.** MP4 in and out, one video track and at most one AAC audio track, H.264 output, and a runtime
  `canEncodeVideo` check. Opus export is refused (padding loss in the pinned converter). WebKit is preview-only (Safari 27 stalled with
  four queued encoder requests). The prototype caps clips at 15 s, 100 MiB and 1920 px. None of that has been tested for a
  multi-clip composite.
- **The persistence and media layers are built.** Project documents with autosave and history (M01, ADR-0055) and project media with
  quarantine, inspection and 15-minute signed downloads (M02, ADR-0056) exist. `TENANT_PROJECTS_ENABLED` is `"false"` in production
  and on in staging.
- **OpenCut was rejected twice** (2026-09-22, 2026-10-07): archived classic version, a rewrite with its own Postgres, Redis and auth,
  a WebAssembly engine the CSP blocks, and an Editor API that is roadmap only. MIT-licensed, so worth revisiting when that API ships.

## Owner decisions (2026-10-10)

1. **Two-layer plan: yes.** Compose in the browser, free. AI features stay priced `job_steps`.
2. **Editing the user's own uploaded media is in scope.** It goes through ADR-0056's project-asset layer, not a new upload path.
3. **Free, browser-local first, desktop Chromium only:** accepted as the recommendation.
4. **Read the signed-in CapCut layout:** yes, once the owner signs in inside the Browser pane. Observation of layout only: no
   scraping of CapCut's app, API, assets, templates, effects or music.

## Decision

### 1. Two layers

**Layer 1, compose (this ADR).** A timeline in the browser: tracks, clips, split, trim, reorder, volume, text, simple transitions, an
aspect-ratio preset, a preview, and a local MP4 export. No server render, no debit, no ledger row, no provider call, and nothing
uploaded for the export itself. Like ADR-0065, a free local tool.

**Layer 2, AI.** Captions, speech, slow motion, noise and voice clean-up, video background removal and video to audio stay
**`job_steps` jobs** (ADR-0029): one debit, an all-or-nothing refund, the signed webhook path. The timeline calls them on a clip and
puts the result back as a new asset. Each step needs its endpoint verified live and **its fal bill read before any price is set**
(`docs/editor/CAPTIONS.md` rule). No new money path.

### 2. The timeline is a project document

A timeline is a versioned JSON document inside a Project (M01), so it gets autosave, history and restore for free. Rules:

- **Versioned schema, validated at the boundary** (`schema_version`, bounded numbers of tracks and clips, bounded string lengths,
  every number finite and within range). A document that fails validation is rejected, never repaired silently.
- **Media is referenced by asset id plus in and out points.** The original is never mutated (M05 acceptance: non-destructive).
- **Text is drawn on the canvas, never inserted into the DOM**, so a timeline from another account cannot inject markup. Fonts are
  bundled or system fonts; no remote font host (the CSP would refuse it, and it would be a new origin).

### 3. Media sources

- **Generated assets**, through the existing signed-asset path (`get_user_asset`, 15 minutes at most).
- **Uploaded project assets** once `state = 'inspected'` (ADR-0056). Accepted today: JPEG, PNG, WebP, MP4, MP3, WAV, with the
  per-type ceilings in `lib/uploadSource.js` (20 MB, 20 MB, 20 MB, 100 MB, 20 MB, 20 MB). **MOV and WebM are not accepted** in slice 1.
- **Uploads inside the editor stay off in production** until two things are decided: moderation of uploaded media (backlog M03, which
  ADR-0056 explicitly left out) and the payment-provider review (#101). `inspected` means well-formed, not safe. Staging may use them.

### 4. Export, and what is qualified

Local MP4 (H.264 video, AAC audio), desktop Chromium only, using the **same qualification gate as ADR-0065**: real decode and encode
capability checks, not browser identity alone; WebKit stays preview-only; Opus audio is refused until a regression passes. Caps start
at the Clip Editor's (60 s total, 10 video clips) and are **lowered, not raised, by the Slice 0 spike** if memory or encode time
demands. No number here is a measured guarantee. Saving the rendered file back to the Library is **out of slice 1**: it creates a
stored asset and belongs with the isolated render queue (M07).

### 5. Flags and rollout

`EDITOR_TIMELINE_ENABLED` (server var, `"false"` in production) plus a per-browser preview switch, as with the other staged surfaces.
It requires `TENANT_PROJECTS_ENABLED`, so it ships to staging first and reaches production only when tenant projects do. The CSP is
**unchanged**: if the spike finds it needs `wasm-unsafe-eval` or a new host, the work stops and comes back as its own ADR.

## Not decided

Prices for any AI step; stock music, footage or templates (licences); collaboration, shared projects and cloud storage; a server-side
render; and whether the engine is Mediabunny alone or Mediabunny plus a small WebGL layer (decided from the spike).

## Slices (each its own PR, each off in production)

| # | Slice | Done when |
|---|---|---|
| 0 | **Spike, no UI shipped.** With the pinned Mediabunny 1.60.0, decode two or more MP4 inputs, composite them and a text layer on a canvas, mix audio, and write one MP4, in desktop Chrome | Measured on real clips: peak memory, encode time per second of output, and failure modes. Writes the caps. Confirms or kills the engine choice |
| 1 | Timeline shell on staging: Library and project assets onto tracks, split, trim, reorder, volume, preview, local export | Capability-checked export; cancellation works; validation tests; no CSP change |
| 2 | Text, simple transitions, aspect presets with letterboxing | Rendered output matches the preview frame for frame on the test clips |
| 3 | Save and reopen as a project document, with history | Stale-update, bound and XSS tests pass |
| 4 | AI buttons on a clip (one at a time) | Endpoint verified live and the fal bill read, then a price |
| 5 | Uploads in the editor in production | Moderation decision and #101 settled |

## Consequences

- **Good:** the editor feels like CapCut (instant, interactive) and costs nothing to run; reuses M01, M02, Mediabunny and `job_steps`.
- **Cost:** browser memory and codec support vary, so support is "desktop Chrome" and a clear refusal elsewhere. A free local export
  leaves no server-side copy, so there is nothing to recover if the user loses the file.
- **Risk:** the multi-input composite has not been tried on this engine. That is why slice 0 comes first and can end the plan.
