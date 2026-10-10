# CapCut capability gap, and how to build it in Veyrnox.ai

**Status:** Direction chosen by the owner 2026-10-10 · nothing built · ADR-0080 proposed (see [ADR-0080](../adr/0080-browser-timeline-editor.md))
**Extends:** [PRD.md](PRD.md), [CAPTIONS.md](CAPTIONS.md), [SPEED.md](SPEED.md). Where they disagree, CLAUDE.md and the ADRs win.

## How this was researched (and what it was not)

- Read: CapCut's **public** pages (`capcut.com`, `/tools/online-video-editor`) and this repo.
- Not done: the signed-in `my-edit` page. The Browser pane was not signed in, and credentials are the owner's to enter.
- Not done, on purpose: no scraping of CapCut's app bundle, API or assets. Features are fair to match; their code, UI, brand,
  templates, effects and music are not. Everything below is written fresh.

## What Veyrnox.ai has today

| Area | State |
|---|---|
| Clip Editor: trim, stitch (2 to 10 clips, same aspect, 60 s cap), add audio | **Live**, server-side `job_steps` chain, one priced job, Library "Edit" sheet |
| Captions (`veed/subtitles`) | Flag on in production, UI hidden behind `localStorage.veyrnox_editor_captions`; 7-credit price **not checked against fal's invoice** |
| Slow motion (Topaz interpolate) | Built; production flag off, staging on; placeholder price |
| Video agent (OpenMontage, ADR-0074) | Built; flag as written in `wrangler.jsonc` on main: production `"true"`, staging `"false"` (verify live before relying on it) |
| Video Enhance (face smoothing, colour) in `/app/enhance` | **Dev-only prototype** (PR #361 draft); runs in the browser on WebCodecs via Mediabunny; no upload, no credits |
| AI generation: 9 video, 6 image, 4 speech, 4 audio/music models; lip sync; avatar | Live in Studio |
| Image tools: background removal, expand, upscale, edit | Live in `/tools` |
| Video to audio (MMAudio) | Live since 2026-10-07 |
| Publish (schedule to social), device uploads library (`social_uploads`, 0223) | Built; uploads flag state per `wrangler.jsonc` |
| Projects (documents with history, ADR-0051/0055) | Built behind `TENANT_PROJECTS_ENABLED` |

**OpenCut is not in the repo.** It was evaluated 2026-09-22 and rejected again 2026-10-07: `opencut-classic` is archived, the
rewrite has its own Postgres/Redis/auth, its engine is WebAssembly (the CSP blocks it), and its Editor API is roadmap only. It is
MIT, so it stays worth a look when that API ships.

## CapCut features (public pages) against Veyrnox.ai

Status: **Have** = live. **Part** = built but hidden, flagged or server-only. **Gap** = nothing yet.

| CapCut feature | Veyrnox.ai | Notes |
|---|---|---|
| Multi-clip timeline with drag, split, trim, reorder | **Part** | Trim and stitch exist as a form, not a timeline. No preview of the combined result (PRD section 3, "Out") |
| Real-time preview of the edit | **Gap** | Needs a browser engine |
| Crop, reverse, mirror, resize / aspect ratios | **Gap** | Letterboxing and mixed aspect are explicitly out of v1 |
| Speed change | **Part** | Slow motion only, 2x to 8x; no speed-up (nothing on fal does it) |
| Transitions, filters, effects | **Gap** | Enhance has a WebGL filter pipeline to learn from |
| Text overlays, stickers | **Gap** | |
| Keyframes, multiple tracks | **Gap** | |
| Auto subtitles / transcribe | **Part** | Captions step; one style preset, no hand editing, no translation |
| Text to speech | **Have** | 4 models in Studio; not placeable on a timeline yet |
| Music and sound effects | **Have** (generated) | CapCut offers a licensed library; we generate. A stock library needs licences |
| Background remover (video), people remover, text remover, inpainting | **Gap** for video | Image background removal exists |
| Noise removal, voice enhance, extract audio | **Gap** | Candidate fal ffmpeg and audio endpoints, all unverified |
| Video converter, custom export (720p to 4K, MP4/MOV, 24 to 60 fps) | **Gap** | Output today is whatever the last step returns |
| AI video, image and character generation | **Have** | Plus Auto Short and the video agent |
| "Video Studio" (chat builds a video) | **Part** | The video agent and Studio skills do this, one job at a time |
| Templates (Reels, TikTok, business) | **Part** | Studio presets are for generation, not edited videos |
| Upload from computer, Drive, Dropbox, QR | **Part** | Publish has an owner-scoped device-upload library (10 files, 200 MB, MP4/JPEG/PNG/WebP); the editor edits **generated assets only** |
| Cloud storage, team spaces, collaboration | **Gap** | Out of scope for v1 (PRD: no shared projects) |
| Long-to-short, auto-cut | **Gap** | |

## The decision that shapes everything

CapCut is a **browser timeline** with AI tools attached. Veyrnox's editor is a **server chain** of priced steps. Those are
different products, and the chain cannot become a timeline: it has no preview and each change is a paid job.

**Recommended: two layers, and the second one already exists.**

1. **Compose in the browser, free.** A timeline on WebCodecs plus a canvas, exporting MP4 locally with Mediabunny 1.60.0, which is
   already a dependency (`/app/enhance` uses it: decode, composite, mux; no WebAssembly; CSP already allows `blob:` media).
   Nothing is uploaded, nothing is debited, like the accepted scope of ADR-0065. This is what makes it feel like CapCut.
2. **AI as priced steps.** Captions, speech, slow motion, video to audio, background removal and the rest stay as `job_steps`
   jobs with one debit and an all-or-nothing refund. The timeline calls them and drops the result back onto a track.

Alternatives considered:
- **Adopt OpenCut.** Its Editor API does not exist; needs its own auth and database. Revisit later.
- **Server-side render of a whole timeline.** The Slice 0 probe found fal's `compose` ignores durations and distorts portrait clips.
  Our own ffmpeg (the video agent's Fly runner) works but is a second product's infrastructure and a bigger build.

## Proposed slices (each behind its own flag, off in production)

| # | Slice | Needs |
|---|---|---|
| 1 | Timeline shell: Library assets onto tracks, split, trim, reorder, volume, preview, local MP4 export | Browser engine on Mediabunny; **an ADR** (new route, memory and codec limits, same qualification gates as ADR-0065: desktop Chromium, caps) |
| 2 | Text overlays, simple transitions, aspect-ratio presets and letterboxing | Canvas compositor; no money path |
| 3 | Save and reopen a timeline as a Project document | ADR-0051/0055 documents; flag `TENANT_PROJECTS_ENABLED` |
| 4 | AI buttons on a clip: captions, speech, slow motion, noise and voice clean-up, video background removal | Each is a priced step; each endpoint verified live and its fal bill **read** before a price is set |
| 5 | Upload your own media | **A new ADR**: moderation, likeness and the payment-provider review (#101); can reuse the 0223 upload library |
| 6 | Templates, stock library, collaboration | Licences and product definition; not planned |

## Owner decisions (2026-10-10)

1. Two-layer plan: **yes**.
2. Editing uploaded media: **yes**, through ADR-0056's project-asset layer; production use waits for moderation (M03) and #101.
3. Free, browser-local, desktop-Chromium first: **yes** (recommendation accepted).
4. Read the signed-in CapCut layout: **yes**, once the owner signs in inside the Browser pane (layout only; no scraping).

**Found after the first draft:** this is backlog item **M05** in `docs/architecture/implementation-backlog.md`, and its two prerequisites (M01 project documents, M02 project media) are built, so no new upload system is needed.

## What I needed from the owner (answered above)

1. **Direction:** the two-layer plan above, or something else?
2. **Uploads:** is editing the user's own uploaded media in scope, or generated assets only (the PRD's current rule)? CapCut's whole
   appeal is uploads, so "generated only" caps how close this can get.
3. **Free local export:** OK to ship slice 1 as free, browser-local, desktop-Chromium-first (the ADR-0065 shape), with priced AI
   steps added in slice 4?
4. **First look:** sign in to CapCut in the Browser pane if you want me to read the signed-in editor's layout (read-only).

## Not decided, deliberately

Prices for any new step (no price without a read fal invoice, per CAPTIONS.md); the licence for any stock media; and whether
slice 1's engine is Mediabunny alone or Mediabunny plus a small WebGL layer (decide from a Slice 0 spike, as before).
