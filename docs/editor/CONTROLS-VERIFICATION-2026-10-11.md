# Editor controls and shared tools — verification, 2026-10-11

This preparation release extends the advanced editor. It does not establish full CapCut parity or activate the production editor. Local fixtures were synthetic and disposable; no owner footage or third-party catalog assets were used.

## Implemented and exercised in the browser

| Capability | Browser and output evidence |
|---|---|
| Masks | Inversion, feather, geometry keys and easing; decoded MP4 confirms the mask changes |
| Colour | Exposure, temperature, tint, shadows/highlights, gamma, HSL and RGB curves; decoded pixel checks |
| Backgrounds | Solid, blurred source and imported image; foreground mask remains independent; two decoded exports |
| Motion | Combo presets, motion paths and filter/colour parameter keys; motion/colour export decoded |
| Speed | Integrated speed ramps, reverse and freeze; 5.2-second output has 156 frames and freeze audio is silent |
| Typography | Ten system fonts, italic, underline, spacing, line height and shadow; Georgia multiline output decoded |
| Word captions | Manual and explicitly estimated timings, VTT/LRC/JSON word import, highlight/karaoke/single-word styles; two decoded outputs |
| Audio processing | Pitch preservation, independent pitch shift, original DSP voice presets and learned noise suppression; pitch and synthetic signal checks |
| Media | Folder labels, original source names, licences and search; source relink keeps source identity |
| Proxies | Local 360p preview proxies, cancellation and bounded cache; exported original is 1920×1080 |
| Timeline/workspace | Global ripple with atomic track-lock guards, undo, additional shortcuts, dock/resize and media drag to tracks |
| Local smart picture | Colour-key removal with feather/despill, bilateral image denoise and soft relight; decoded red foreground on blue background |
| Original audio catalog | Four procedurally generated music loops and six effects, search/preview/download/insert; generated identity reopens without relinking; H.264/AAC export has non-silent decoded PCM |
| Original elements/titles | Ten original vector shapes, eight title presets and catalog search; red heart and Georgia title decoded on blue background |
| Desktop layout | Compact labelled icon commands, bounded panel scrolling and fit-to-screen mode; add/duplicate/undo/redo pass; native playback reaches frame 179 and six-second 640×360 MP4 has 180 frames |

Formal Reticle verdicts passed the individual feature journeys above. The final command journey had partial coverage because three virtualized rows were unmounted. A synthetic Play click remained in audio preparation until a native gesture; the native click advanced the clock and Reticle asserted the final frame. A size-select assertion that was already true is **not** counted as verification; the resulting decoded export proves its dimensions.

Decoded export files and recordings remain private local artifacts. Temporary SDK wiring, the verification store and the localhost export collector are removed from the release. No new production CSP exceptions or telemetry tokens are shipped.

The high-level viewport override initially left the DOM at 1280×683. Hosted staging was subsequently checked with Chrome device-metric emulation at 390×844: measured client/scroll width were both 390, the title could be selected from the timeline, and its inspector remained reachable. The override was cleared afterwards. This is a narrow responsive-layout check, not qualification on a physical phone or of mobile rendering/export.

## Shared brand kits and saved-version review

Migration `0280_editor_brand_and_review` adds workspace palettes/fonts/styles/inspected-asset references and project review comments pinned to a saved revision and frame. All writes use caller-JWT RPCs, with RLS, membership rechecks, explicit grants, bounded payloads, optimistic versions and idempotency. Review links require existing project access; they do not create public access or new invitations.

Nine disposable local database checks passed, including revocation/replay, project isolation, viewer restrictions, resolved-version conflicts and paged comments. The migration replayed twice and the default-privilege allowlist passed. API checks exercise flag-off behavior, invalid payloads and exact revision/cursor forwarding.

Staging applied `0280_editor_brand_and_review` under receipt version `20261011054200`. Local browser sign-in returned to the configured staging callback because localhost is not allowlisted. Authentication settings were not widened and credentials were not transferred between origins. Hosted signed-in UI verification passed after deployment, using the existing staging account and a labelled test project. Reticle is not bundled there; the evidence below is native Chrome interaction plus backend reads, not a hosted Reticle verdict.

Production `EDITOR_SHARED_TOOLS_ENABLED` remains false. Its activation requires an approved production migration, its own complete 24-hour reconciliation window, green CI/deploy and real signed-in saved-version/permission checks. The earlier 0269 window does not qualify these new tables.

## Remaining scope

Automatic speech transcription/translation/lyrics, AI segmentation/retouch/reframe/tracking/movement, optical flow, stabilization/flicker restoration, licensed stock/Giphy/avatar/custom-font catalogs, plugin providers and editor render-to-Library/Publish handoff are still outstanding. Provider jobs need verified live contracts/prices and the existing debit/refund path. Local chroma key and measured synthetic DSP are narrower capabilities.

Long real-footage edits, smaller machines and mobile browsers need further qualification. This release does not imply those outcomes or licensed CapCut assets.

## Release checks

Implementation commit `da63c5bbdf2eac909bd27233887c8476232292dc` has green [integrated CI](https://github.com/aljobson/Veyrnox.ai/actions/runs/38118114199): 3,014 unit tests, 3,013 passed, zero failed, one skipped; lint has zero errors and 96 warnings. Foundation type checking, worker build, acceptance, hard-wall, verification and migration-ledger checks passed. The Cloudflare branch build also passed. Local checks additionally rebuilt all 260 migrations, passed the nine shared-storage checks, six multitrack-storage checks and explicit default-privilege allowlist. Temporary verification code is absent from the committed source.

The exact implementation was built for the actual staging origin, then uploaded and deployed with OpenNext/Wrangler. Worker version `11ff3971-c52c-417c-a4ae-4efb4e508361` received 100% traffic on 2026-10-11 at 06:31:33.910349 UTC, tagged `codex-editor-da63c5bb`. Readback confirmed staging Supabase `yrqzwqywxfesmbvhzjgj`, advanced/shared editor and project-saving flags enabled there. Production activation flags remain false in this preparation release.

Native hosted journeys and database corroboration:

- Reopened a version-1 legacy title, changed its words and font, autosaved and reloaded. Version 3 retained both Georgia titles and the applied blue canvas colour.
- Saved a brand name, palette, Georgia font and selected-title style; reloaded the kit, inserted its title style and applied a palette colour. Backend read confirmed brand version 1 and matching style/font/palette.
- Added a comment to saved revision 3, resolved it, reloaded the project, reopened the comment and followed the permission-preserving saved-review link. Backend read confirmed revision 3/frame 0, unresolved state and comment version 3.
- Native saved-review playback reached frame 89 of the three-second edit, stopped, and a second Play restarted at frame 4 rather than staying at the end.
- Inserted Glass shimmer, autosaved version 4, reloaded, and found its waveform and Loaded status without relinking. Backend metadata retained `originalAudio: {presetId: "glass-shimmer", version: 1}` and its 60-frame audio clip.
- Sign-out cleared attached-project state, both title clips, generated media, timeline, preview background and undo history. Normal existing Google sign-in restored the same account. Different-account races are covered by the implementation guards; this native journey specifically verifies sign-out.
- Restored the staging brand kit to its original name/palette/Arial-only fonts and empty styles/assets; backend confirmed version 2. The labelled fixture `Codex editor shared verification 2026-10-11` remains as evidence. No owner media was imported or production test project created.

Private screenshots: `editor-hosted-brand-verified.jpg`, `editor-hosted-review-verified.jpg`, and `editor-hosted-mobile-layout.jpg`. The shared UI is verified on staging; production migration 0280 still requires the owner-approved workflow and its own observation window.

Staging has unrelated missing receipts for migrations 0272–0279. Those migrations were not replayed to qualify this editor. The two newly introduced admin-grant/webhook-log flags were absent from the live staging Worker before this deployment and were explicitly kept false; source configuration for the owner's separate rollout was left intact. This is editor-specific staging evidence, not a declaration of complete staging-schema parity.

The editor, shared tools, project saving, media uploads and paid Cinema retain their independent production gates. Local controls follow the already approved 0269 editor gate; new shared tables follow 0280. Neither elapsed time nor a latest-zero sample proves either observation window.
