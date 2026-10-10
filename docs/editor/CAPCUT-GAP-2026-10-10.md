# CapCut feature inventory and editor delivery scope — 2026-10-10

The owner requested **all feature areas** in the signed-in CapCut editor and supplied a screenshot. This supersedes the earlier limited comparison in this document. All rows below are in scope; this is not a parity or production-completion announcement.

## Evidence boundary

The signed-in editor's twelve library areas, six inspector categories and export settings were inspected. No owner media, selected clip, preset, paid job or export was changed or submitted. Observed controls establish the exposed feature surface, not their behavior, quality or prices for other accounts. Unnamed toolbar commands and complete shortcut mappings still need a disposable-project execution pass.

REA 6.3.0 inspected a passive request/response metadata capture offline. It contains 122 records in an incomplete synthetic HAR; the initial load and evicted events are absent. Headers, cookies, bodies, auth and original query values were not retained. No recorded URLs were fetched. Status zero means the response was not captured. Worker/WASM manifest requests establish resource requests, not execution or internal implementation.

Evidence ID: `ev_2c1bac8ec500c5671a3464e4ea887aa00f3b560650c791e8474d7cd1b5d5aeb8`.

Capture SHA-256: `6c21a5c7697572484b44d0d7dda7ebe33e09c661a2fb2549f59b628989d13913`.

The owner screenshots and raw UI/network evidence remain private local artifacts. No CapCut code, media, presets, music, stickers, templates or thumbnails are adopted.

## Entire requested feature surface

| Area | Actual CapCut UI observed | Veyrnox gap and required work |
|---|---|---|
| Workspace | Left media/tool library, centre canvas, contextual inspector at right, timeline below; canvas bounds and handles | Dedicated editing workspace with resizable panels, visible selection and canvas interaction |
| Project | Editable title, space identity, cloud-save indicator | Existing project documents/history; cloud activation follows the migration observation window |
| Media | Uploads and Generated tabs, thumbnails and source lengths; uploaded clip marked Added | Rich bin, image import, folders/search, source preview, drag to timeline, relink and recovery |
| AI generation | Prompt, start/end image inputs, model picker, estimated credits and Generate | Bridge existing Studio jobs into the editor, display verified price before submission, return output to bin |
| Templates | Search and catalog categories including intro, outro, logo reveal, vlog, slideshow, business and promo | Original reusable edit templates with replaceable media/text; generation presets are a separate existing capability |
| Elements | Stock video, photos, stickers, Giphy and avatar entries | Images/overlays, original vector shapes and stickers; source/license metadata and catalog search |
| Audio library | Music and Sound effects tabs, search, categories, duration/creator rows | User/generated sound selection, waveform preview and insertion; licensed stock requires a catalog and usage terms |
| Text | Add heading/body, Text templates/Text effects tabs, preset categories | Multiline text, font/weight/alignment, colours, outline/background/shadow, positioning, reusable styles, text animations |
| Captions | Auto captions, language picker, Manual captions, upload .srt/.ass/.lrc, Auto lyrics | Editable timed captions and file import/export; word timings, styling and translation; priced transcription integration |
| Transcript | Spoken language, track selection, transcript-based editing and Transcribe | Editable transcript with timing-to-timeline mapping, range deletion, undo and source alignment |
| Effects | Video effects/Body effects, search, named categories and presets | Parameterised effect clips/ranges and compositor support; tracked/body effects need additional analysis/model work |
| Transitions | Instruction to drag between clips, categories and catalog | Transition slots, configurable duration, preview/export agreement and an original transition catalog |
| Filters | Themed filter catalogs including mono, film, portrait, landscape and restoration entries | Reusable original looks with intensity control, colour pipeline and export parity |
| Brand kit | Trial/Create entry; examples of videos, images, text/adjustment presets, stickers and music | Workspace brand assets and styles, ownership/permissions, reusable palette/fonts and licence tracking |
| Plugins | Epidemic Sound catalog entry | Define an extension contract with scoped capabilities and licensed providers; an external link alone is not plugin parity |
| Basic/mask | Mask section and None selector | Geometric masks, inversion, feather, transforms and keyframes |
| Basic/colour | Colour adjustment entry labelled Basic, HSL, Curves | Exposure/contrast/saturation/temperature, channel adjustment and editable curves |
| Basic/blend | Normal mode selector, opacity slider/input | Blend modes, opacity, render ordering and keyframes |
| Basic/transform | Scale, X/Y position and rotation controls | Crop/fit/fill, translation, scaling, rotation, flips and direct canvas manipulation |
| Basic/restoration | Stabilize, Reduce image noise, Remove flicker switches | Separate processing jobs or measured local algorithms; reliability, preview and result replacement |
| Background | Colour picker, Recents, Brand Color, Recommended, Apply to all | Solid/blur/image backgrounds and per-clip/project controls; other CapCut tabs remain unnamed in captured DOM |
| Smart tools | Auto reframe, Retouch, Remove background, Camera tracking, Relight, AI movement, Optical flow | Explicit tool contracts, local/remote execution decisions, progress/cancel/retry, verified pricing for remote jobs |
| Clip audio | Volume in dB, fade-in/out duration, Basic and Voice changer tabs | Audible synchronized preview, gain envelope/fades, extraction, mute/solo, overlapping music/voice tracks, noise/EQ tools |
| Voice changer | Library/Custom; processing and voice presets; Apply to all | Local DSP where suitable; voice transformation jobs where needed; original presets and result preview |
| Animation | In, Out, Combo tabs and many movement presets | Transform/opacity keyframe engine, easing, original animation presets and editable durations |
| Speed | Normal/Curve; 1x, duration, Pitch, Smooth slow-mo | Rate/remapping model, constant speed, source-to-output time mapping, pitch decision, reversal/freeze and optical-flow integration |
| Speed curves | None, Custom and multiple curve presets | Editable speed ramp points; preview, audio and export use the same time mapping |
| Selection/edit commands | Selection, undo/redo icons; canvas toolbar and timeline toolbar; selected clip has trim handles | Command history, duplicate/copy/paste, split/delete, linked/group selection, keyboard controls, ripple/snap and track locks |
| Timeline | Time ruler, playhead, clip filmstrip, audio control, timeline zoom and selected clip bounds | Drag trims/reorder/move, multitrack overlays, waveforms/filmstrips, zoom/pan, snapping and readable track headers |
| Export | Name, cover, resolution, quality, frame rate, format | Export settings tied to codec support, progress/cancel, clear failure and file validation |
| Export resolution | 360p, 480p, 720p, 1080p, 2K, 4K options | Measure higher resolutions and longer edits on supported browsers before exposing them |
| Export frame rate | 24, 25, 30, 50, 60 fps | Versioned project timebase and resampling; no frame-count drift |
| Export quality/format | High, Recommended, Fast; MP4/MOV | Codec/bitrate/quality controls and supported containers, with preview/export parity |
| Sharing/publish | Review link, presentation link, TikTok, TikTok Ads, YouTube/Shorts, Facebook, Instagram Reels and Schedule | Connect existing Publish with explicit destinations; review permissions/comments and shared project work need their own implementation |

## Delivery sequence

1. **Editing foundation:** source identity/import recovery, title duration/export, bounded undo/redo, duplicate/split, trim/reorder/move, zoom/keyboard, audible synchronized preview, export progress/cancel and resource disposal. This PR implements this step; see [verification](FOUNDATION-VERIFICATION-2026-10-10.md).
2. **Workspace and multitrack:** resizable panels, source viewer, filmstrips/waveforms, images/overlays, overlapping audio, mute/solo/lock, multi-select/groups, ripple and snapping. Design the versioned document, backward-compatible reader, Worker validator and database migration together; round-trip existing projects and preserve their appearance.
3. **Visual/audio controls:** transforms/crop/fit/fill/flips, opacity/blend, masks/feather, backgrounds, colour/HSL/curves, fades/gain/EQ/noise, constant speed/ramps and keyframes/easing. Preview and export must share parameter and time evaluation.
4. **Typography, captions and transcript:** multiline styles/animations; manual timed captions and bounded file import/export; editable transcript and source-aligned range edits; job-backed word timing, translation and lyrics.
5. **Original catalogs:** parameterised effects/transitions/filters, replaceable-media templates, elements and workspace brand styles. Retain external licence/source metadata; qualify each operation's undo, persistence and preview/export agreement.
6. **Smart tools and Studio:** generation, speech/captions, segmentation/reframe/retouch/tracking/relight, interpolation/stabilization/restoration and voice transformation through explicit local or remote contracts. Remote jobs use verified endpoints/prices and the normal debit/refund/idempotency path, with progress/cancel/retry and result insertion.
7. **Export/review/production:** measured 2K/4K/longer outputs, multiple timebases, codec/quality options, proxy/server fallback if selected, Library/Publish handoff, permission-aware review and collaboration. Require real outputs, clean CI/deployment and live verification.

## Boundaries that implementation must respect

- The present schema is fixed at 30 fps, a 60-second edit, 24 media files, 10 video clips, 10 non-overlapping audio clips and 10 single-line text items. The Worker/document/SQL boundaries enforce these limits, including a 32-KiB project-document ceiling. Multitrack, richer persisted parameters and timebase changes require a coordinated migration; adding UI alone cannot supply them.
- Browser-local editing/export stays free. New remote operations require controlled live endpoint tests and provider invoice verification before publishing a price. Current hidden caption pricing and prototype restoration/slow-motion integrations are not verified prices for this rollout.
- Licensed music/stock/fonts/provider catalogs need usage rights or an original alternative. Capability contracts and licences cannot be inferred from the passive CapCut capture.
- Production server uploads still need the agreed moderation/inspection rollout. Cloud project saving has been prepared independently and follows its migration observation gate. The owner has not waived that gate.
- CSP and identity isolation remain in place. A new WASM engine, origin or server rendering system needs its own decision and validation.

Every feature area is included. The remaining stages are **unimplemented scope**, not hidden working controls.
