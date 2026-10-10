# ADR-0080 — Browser timeline editor (backlog M05), free and local first

- **Status**: **Accepted for browser-local editing 2026-10-10.** Slices 0–2 are built and verified; slice 3 is built and remains behind the projects gates. The owner requested a visible Studio navigation entry on 2026-10-10. See `docs/operations/three-session-rollout-2026-10-10.md` for rollout evidence.
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
  four queued encoder requests). The prototype caps clips at 15 s, 100 MiB and 1920 px. Slice 0 has since tested a multi-clip composite
  (see Decision 4).
- **The persistence and media layers are built.** Project documents with autosave and history (M01, ADR-0055) and project media with
  quarantine, inspection and 15-minute signed downloads (M02, ADR-0056) exist. `TENANT_PROJECTS_ENABLED` is `"false"` in production
  and on in staging.
- **OpenCut was rejected twice** (2026-09-22, 2026-10-07) as a *host* for the editor: its current repo is a ground-up rewrite
  (the README lists an Editor API, plugins and a Rust core as "coming"), it has its own Postgres, Redis and auth, and its compositor is
  WebAssembly, which the CSP blocks. **Revisited 2026-10-10 after the owner asked how it could help**, from public GitHub data only
  (directory names, `package.json`, README; no code was read):
  - **OpenCut Classic** (`opencut-app/opencut-classic`, archived 2026-05-17, MIT, 266 stars) is the web editor that actually shipped.
    It is **Next.js 16, React 19 and Mediabunny ^1.29**, the same stack and engine as Veyrnox.ai, with source folders for `timeline`,
    `commands`, `actions`, `selection`, `ripple`, `retime`, `speed`, `text`, `subtitles`, `stickers`, `masks`, `effects`, `export`,
    `canvas`, `preview` and `rendering`.
  - Not to take: its Rust/WASM crates (`gpu`, `compositor`, `effects`, `masks`, `time`; the `opencut-wasm` package), which need a CSP
    change we have not agreed; its auth and database layer (better-auth, drizzle, Postgres, Upstash); and its asset providers and
    remote fonts, whose licences and hosts are unchecked.
  - So it is a **reference and a possible source of MIT TypeScript** (timeline model, command and undo stack, ripple, retime, subtitle
    handling), not a dependency or a host. Anything copied keeps its MIT notice. Slice 0b (2026-10-10) found the core separable; adopting it is the owner's call.

## Owner decisions (2026-10-10)

1. **Two-layer plan: yes.** Compose in the browser, free. AI features stay priced `job_steps`.
2. **Editing the user's own uploaded media is in scope.** It goes through ADR-0056's project-asset layer, not a new upload path.
3. **Free, browser-local first, desktop Chromium only:** accepted as the recommendation.
4. **Read the signed-in CapCut layout:** yes, once the owner signs in inside the Browser pane. Observation of layout only: no
   scraping of CapCut's app, API, assets, templates, effects or music.
5. **Expose the browser editor in Studio navigation:** yes (2026-10-10). Free local composition and export can open independently of cloud project saving.

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
- **Files from this computer** are decoded in the browser and remain local. MP4, MOV and WebM video and MP3, WAV and MP4 audio are checked by `editorMedia.mjs`; codec probing can refuse an unsupported file. Choosing a local file creates no server upload or stored asset.
- **Uploaded project assets** once `state = 'inspected'` (ADR-0056). Accepted today: JPEG, PNG, WebP, MP4, MP3, WAV, with the
  per-type ceilings in `lib/uploadSource.js` (20 MB, 20 MB, 20 MB, 100 MB, 20 MB, 20 MB). This server upload path does not accept MOV or WebM.
- **Server uploads inside the editor stay off in production** until two things are decided: moderation of uploaded media (backlog M03, which
  ADR-0056 explicitly left out) and the payment-provider review (#101). `inspected` means well-formed, not safe. Staging may use them.

### 4. Export, and what is qualified

Local MP4 (H.264 video, AAC audio), desktop Chromium only, using the **same qualification gate as ADR-0065**: real decode and encode
capability checks, not browser identity alone; WebKit stays preview-only; Opus audio is refused until a regression passes. **Measured in slice 0** (one Apple M5, 16 GiB, Chrome 154, synthetic clips; see the results doc for what it does not prove):
a 55.5 s, 10-clip, 1080p timeline with crossfades and text exported in 26 s (2.15x real time, 868 MB peak browser memory), and every
content check passed. **Encode with `hardwareAcceleration: 'prefer-software'`:** the default hardware encoder stalled for 4.5 to 86 s on
first use in a browser session, and a warm-up did not reliably remove it. Decode with the library's sequential iterator, not the
sparse-access one. Caps for slice 1 stay at the Clip Editor's (60 s total, 10 video clips, 720p or 1080p); 4K is out until measured.
Memory with real footage, other browsers and smaller machines are **unmeasured**. Saving the rendered file back to the Library is **out of slice 1**: it creates a
stored asset and belongs with the isolated render queue (M07).

### 5. Flags and rollout

`EDITOR_TIMELINE_ENABLED` is the request-time server switch for both `/app/editor` and its Studio navigation entry. The owner approved opening it in production and staging on 2026-10-10; the per-browser editor preview switch is retired. Setting it to `"false"` hides the link and makes the route return 404.

Browser-local composition and export use no new database or money path. Cloud saving and reopening still require `TENANT_PROJECTS_ENABLED` and the projects preview switch. Production projects stay off while their migration and reconciliation rollout gate is pending. The CSP is
**unchanged**: if the spike finds it needs `wasm-unsafe-eval` or a new host, the work stops and comes back as its own ADR.

## Not decided

Prices for any AI step; stock music, footage or templates (licences); collaboration, shared projects and cloud storage; a server-side
render; and whether to add a WebGL layer later. The engine is decided: **Mediabunny with a Canvas 2D compositor** (slice 0), because it worked.

## Slices (each its own PR, each off in production)

| # | Slice | Done when |
|---|---|---|
| 0 (**done 2026-10-10**) | **Spike, no UI shipped.** With the pinned Mediabunny 1.60.0, decode two or more MP4 inputs, composite them and a text layer on a canvas, mix audio, and write one MP4, in desktop Chrome | Measured on real clips: peak memory, encode time per second of output, and failure modes. Writes the caps. Confirms or kills the engine choice |
| 0b (**done 2026-10-10**) | **OpenCut Classic extraction check, no code adopted.** Read its timeline, commands, ripple, retime and subtitle code; list what is separable from its Next app, database and WASM, its licence notices, and any bundled asset licences | **Yes** (`docs/editor/OPENCUT-CLASSIC-EXTRACTION-2026-10-10.md`): the editor core is separable; its WebAssembly use is time maths plus an unused-by-default compositor; the owner decides what to adapt, and anything copied keeps its MIT notice |
| 0c (**done 2026-10-10**) | **Extraction spike, scratch only.** Replace OpenCut Classic's WebAssembly time module with a TypeScript port; run its tests; type-check the app; compare the port to the real WebAssembly | **Passed** (`docs/editor/OPENCUT-EXTRACTION-SPIKE-2026-10-10.md`): 205 tests pass versus 170 with the real package (4 files that could not load now run); the same 4 failures in both; 0 mismatches in about 72,600 side-by-side calls; the whole app type-checks with the identical 49 errors. Nothing adopted; the port is saved outside the repo awaiting the owner's go-ahead |
| 1 (**done 2026-10-10**, #822, #826) | Timeline shell on staging: Library and local files onto tracks, split, trim, reorder, volume, preview, local export | Shipped behind `EDITOR_TIMELINE_ENABLED`; driven on staging (Library load, split, trim, volume, move, undo, delete, a 2.8 MiB export); 24 real-Chrome export checks with ffprobe |
| 2 (**done 2026-10-10**) | Text, a crossfade dissolve, aspect presets with letterboxing | One drawing routine (`editorRender.mjs`) serves the preview and the export; on the test clips the two agree to a mean channel difference under 3 of 255 at 8 sampled frames across a dissolve and a caption; 9:16 export is 406x720; the sound crossfades with the picture (both tones through the dissolve); 33 real-Chrome checks. Design: a dissolve on clip k plays clip k-1 underneath, past its out point when the file has more else on its last frame, picture and sound alike; the sequence timing does not change. Text is one line, drawn with the canvas text API only (never the page), bundled system fonts |
| 3 (**built 2026-10-10**) | Save and reopen as a project document, with history | Project document **v2** (`lib/projectDocument.js`, migration `0255`): the v1 keys plus `timeline` (a validated editor timeline or null). The Worker validates every number (`validateTimeline`); SQL bounds the shape (`private.project_timeline_within_bounds`: version, fps, counts, aspect) and keeps 0254's write caps and the 32 KiB ceiling. Stale update (409 with the newer version offered), replay (idempotent), restore (new version carrying the timeline) and damage (refused, never repaired) are proved on the replayed chain (`scripts/test-project-document-timeline.mjs`) and at the route. Text is only ever drawn on a canvas, so a timeline from another account carries no markup into the page. Reopening fetches Library files again by generation id and asks for local files again (matched by name, kind and length to the frame); the document never carries bytes. Autosave 3 s after the last edit; versions and restore in the editor (`ProjectBar.js`), behind the projects preview switch and `TENANT_PROJECTS_ENABLED` |
| 4 | AI buttons on a clip (one at a time) | Endpoint verified live and the fal bill read, then a price |
| 5 | Uploads in the editor in production | Moderation decision and #101 settled |

**Production CORS gate cleared 2026-10-10:** the production bucket originally allowed only `PUT` from `https://veyrnox.ai`. ADR-0028 amendment 2's `GET, HEAD, PUT` rule with `Range` and `If-None-Match` was applied and read back; a browser range GET returned 206 with video bytes. The rule and apply command are in `docs/infra/README.md`.

## Consequences

- **Good:** the editor feels like CapCut (instant, interactive) and costs nothing to run; reuses M01, M02, Mediabunny and `job_steps`.
- **Cost:** browser memory and codec support vary, so support is "desktop Chrome" and a clear refusal elsewhere. A free local export
  leaves no server-side copy, so there is nothing to recover if the user loses the file.
- **Risk:** real footage, other browsers and smaller machines still need qualification beyond the measured slice 0 clips. Desktop Chromium capability checks remain authoritative.

## Cloud project saving rollout — 2026-10-10

The owner requested cloud project saving in production. The normal Studio
Projects entry and editor Save to a project controls now use the same
request-time `TENANT_PROJECTS_ENABLED` flag as the project APIs. The retired
`veyrnox_projects` browser switch no longer hides an enabled feature. Disabling
the server flag hides both controls and returns 404 for project pages/APIs.

This release stores project documents, timeline decisions and immutable history.
Library files are fetched again by generation id; local files are relinked on
reopen and are not uploaded. Project media reservation needs the separate
`PROJECT_MEDIA_UPLOADS_ENABLED` flag, false in production and true in staging.
It cannot issue an upload URL while production moderation/malware acceptance is
open. No scanner exception or paid feature activation is part of cloud saving.

Production activation remains pending the 24-hour clean reconciliation window
after 0261, applied at 2026-10-10 15:32:27 UTC. Its earliest end is
2026-10-11 15:32:27 UTC (16:32:27 BST). This preparation leaves production
`TENANT_PROJECTS_ENABLED=false`. No schema or ledger behavior changes.
