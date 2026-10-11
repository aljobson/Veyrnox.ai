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

The responsive viewport override reported success but the DOM remained at 1280×683. Mobile breakpoint behavior has not been newly verified by this run.

## Shared brand kits and saved-version review

Migration `0280_editor_brand_and_review` adds workspace palettes/fonts/styles/inspected-asset references and project review comments pinned to a saved revision and frame. All writes use caller-JWT RPCs, with RLS, membership rechecks, explicit grants, bounded payloads, optimistic versions and idempotency. Review links require existing project access; they do not create public access or new invitations.

Nine disposable local database checks passed, including revocation/replay, project isolation, viewer restrictions, resolved-version conflicts and paged comments. The migration replayed twice and the default-privilege allowlist passed. API checks exercise flag-off behavior, invalid payloads and exact revision/cursor forwarding.

Staging applied `0280_editor_brand_and_review` under receipt version `20261011054200`. Local browser sign-in returned to the configured staging callback because localhost is not allowlisted. Authentication settings were not widened and credentials were not transferred between origins. Real signed-in shared UI verification must run on hosted staging after deployment. Reticle is not bundled there, so native browser evidence must be identified separately.

Production `EDITOR_SHARED_TOOLS_ENABLED` remains false. Its activation requires an approved production migration, its own complete 24-hour reconciliation window, green CI/deploy and real signed-in saved-version/permission checks. The earlier 0269 window does not qualify these new tables.

## Remaining scope

Automatic speech transcription/translation/lyrics, AI segmentation/retouch/reframe/tracking/movement, optical flow, stabilization/flicker restoration, licensed stock/Giphy/avatar/custom-font catalogs, plugin providers and editor render-to-Library/Publish handoff are still outstanding. Provider jobs need verified live contracts/prices and the existing debit/refund path. Local chroma key and measured synthetic DSP are narrower capabilities.

Long real-footage edits, smaller machines and mobile browsers need further qualification. This release does not imply those outcomes or licensed CapCut assets.

## Release checks

Final automated check totals, CI links and hosted staging results are appended after the final integrated commit. The editor, project saving, media uploads and paid Cinema retain their independent production gates.
