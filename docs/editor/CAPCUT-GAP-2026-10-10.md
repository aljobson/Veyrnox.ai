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

1. **Editing foundation:** source identity/import recovery, title duration/export, bounded undo/redo, duplicate/split, trim/reorder/move, zoom/keyboard, audible synchronized preview, export progress/cancel and resource disposal. The foundation release implements this step; see [verification](FOUNDATION-VERIFICATION-2026-10-10.md).
2. **Workspace and multitrack:** resizable panels, source viewer, filmstrips/waveforms, images/overlays, overlapping audio, mute/solo/lock, multi-select/groups, ripple and snapping. Design the versioned document, backward-compatible reader, Worker validator and database migration together; round-trip existing projects and preserve their appearance.
3. **Visual/audio controls:** transforms/crop/fit/fill/flips, opacity/blend, masks/feather, backgrounds, colour/HSL/curves, fades/gain/EQ/noise, constant speed/ramps and keyframes/easing. Preview and export must share parameter and time evaluation.
4. **Typography, captions and transcript:** multiline styles/animations; manual timed captions and bounded file import/export; editable transcript and source-aligned range edits; job-backed word timing, translation and lyrics.
5. **Original catalogs:** parameterised effects/transitions/filters, replaceable-media templates, elements and workspace brand styles. Retain external licence/source metadata; qualify each operation's undo, persistence and preview/export agreement.
6. **Smart tools and Studio:** generation, speech/captions, segmentation/reframe/retouch/tracking/relight, interpolation/stabilization/restoration and voice transformation through explicit local or remote contracts. Remote jobs use verified endpoints/prices and the normal debit/refund/idempotency path, with progress/cancel/retry and result insertion.
7. **Export/review/production:** measured 2K/4K/longer outputs, multiple timebases, codec/quality options, proxy/server fallback if selected, Library/Publish handoff, permission-aware review and collaboration. Require real outputs, clean CI/deployment and live verification.

## Boundaries that implementation must respect

- The foundation schema was fixed at 30 fps, a 60-second edit, 24 media files, 10 video clips, 10 non-overlapping audio clips and 10 single-line text items. The advanced version-3 schema supports independent tracks and longer edits, with its own bounded validator. The Worker/document/SQL boundaries enforce these limits, including a 32-KiB project-document ceiling. Multitrack, richer persisted parameters and timebase changes require a coordinated migration; adding UI alone cannot supply them.
- Browser-local editing/export stays free. New remote operations require controlled live endpoint tests and provider invoice verification before publishing a price. Current hidden caption pricing and prototype restoration/slow-motion integrations are not verified prices for this rollout.
- Licensed music/stock/fonts/provider catalogs need usage rights or an original alternative. Capability contracts and licences cannot be inferred from the passive CapCut capture.
- Production server uploads still need the agreed moderation/inspection rollout. Cloud project saving has been prepared independently and follows its migration observation gate. The owner directed an early editor/cloud release on 11 October 2026; the scoped ADR-0080 exception preserves the unproven observation window and separate media-upload gate.
- CSP and identity isolation remain in place. A new WASM engine, origin or server rendering system needs its own decision and validation.

## Advanced workspace and controls implementation status — updated 2026-10-11

The foundation and previously qualified advanced controls are separate from the completion work below. Implemented code, a local browser result and a production release are different evidence. This table records the current code and available development/staging qualification; it does not claim proprietary catalog parity, equal output quality or that every row is live.

The base advanced workspace follows `EDITOR_MULTITRACK_ENABLED` and migration 0269. Shared brand/review storage follows `EDITOR_SHARED_TOOLS_ENABLED` and migration 0280. New folder/font document fields follow `EDITOR_ORGANIZATION_ENABLED` and `0286_editor_folders_and_fonts.sql`; private Library renders follow `EDITOR_LIBRARY_EXPORTS_ENABLED` and `0285_editor_library_renders.sql`. Local speech/person inference has the independent `EDITOR_LOCAL_INFERENCE_ENABLED` opt-in. Native social video destinations use `PUBLISH_VIDEO_DESTINATIONS_ENABLED`, existing upload/network permissions and `0287_tiktok_submission_fence.sql`. Migrations 0285–0287 are applied to staging only; [the staging qualification record](COMPLETION-STAGING-2026-10-11.md) includes receipts, Worker/ACL/cron readback, signed-in folder/font save/reopen, corrected Library save/playback and a Publish handoff stopping before posting. Native speech/avatar draft preflight and the staged person runtime were exercised without paid generation. Owner-approved fixture cleanup passed; raw hosted Worker-header readback remains unavailable. Completion-branch production configuration keeps these activation flags off; native social video also stays off in staging until qualified. Production approval/application receipts, complete clean observation windows, green CI/deploy and live journeys remain required; an earlier clean window does not qualify later schema changes.

| Area | Implemented code and recorded qualification | Remaining work and qualification |
|---|---|---|
| Workspace/media | Dock/resize, compact layout, source viewer, images, thumbnails/waveforms, search/source/licence labels, Library/relink and local proxies. Explicit empty folders, subtree moves and Undo have a positive Reticle journey. Meaningful regressions preserve previously valid media folder labels and enforce the resulting path count. Signed-in staging folder save/reload and backend readback passed | Production 0286 application/window/activation and live journey; broader mobile and low-resource qualification |
| Timeline/commands | Independent overlapping tracks, hide/mute/solo/lock, groups/multiselect, copy/paste/duplicate, trims/split, lane/global ripple, snapping and undo/redo | Broader gestures, keyboard mappings and low-resource/long-edit qualification |
| Picture/masks | Transform/crop/fit/flips, blends/opacity, geometric masks/inversion/feather/keyframes, local chroma key, bilateral denoise and soft light adjustment | Semantic/depth relighting, face/body reshaping and tracked/body-effect parity remain unimplemented; broader real-footage quality checks |
| Local motion/restoration | Stabilization of horizontal/vertical camera shake, exposure-flicker correction, measured texture-region tracking/reframe, manual camera pan/zoom and bidirectional optical-flow interpolation. All five actual editor processing journeys have positive Reticle verdicts and downloaded outputs independently decoded/measured. Stabilization preserved AAC packets/decoded PCM exactly and reduced fixture translational jitter by 97.04%; insertion/Undo verdicts are recorded | Broader real footage, large shake/rotation/parallax, motion/occlusion artifacts and smaller-machine qualification. Manual camera crops do not implement generative AI movement. Ordinary processing is bounded to 30 seconds/720p; optical flow to 10 seconds/480p/60 fps |
| Local person tools | Pinned MediaPipe multiclass segmentation drives solid background replacement, transparent removal, skin-mask smoothing/light adjustment, silhouette glow and largest-person reframing. All five actual editor journeys have positive Reticle verdicts and downloaded outputs. Independent decoding found transparent background alpha 0–1 and face alpha 255 across 60 pictures; the corrected overlay composited through the actual editor MP4 exporter | Broader people/lighting/occlusion footage and edge/rapid-motion quality remain pending; no face/body reshape or semantic/depth relight. Person processing is bounded to ten seconds. Transparent VP9/WebM requires a silent source; other operations preserve AAC. Production inference remains gated |
| Colour/background | Exposure/temperature/tint/shadows/highlights/gamma, HSL/RGB curves, original looks and solid/blur/image clip backgrounds | Broader real-footage quality and preview/export agreement across combinations |
| Animation | Transform/opacity/easing, original in/out/combo presets, editable paths and filter/colour parameter keys; original camera crop movement | Generative AI movement, tracked/body effects and CapCut's proprietary animation catalog/quality are not supplied |
| Audio/speed | Overlapping sounds, gain/fades/pan/EQ, pitch preservation/shift, original DSP voice effects, learned noise suppression, ramps/reverse/freeze and local optical-flow processing. Existing Fal speech generation is exposed in a dedicated voiceover mode; finished speech uses normal Library/audio insertion | Broader real-speech/music/noise and slow-motion quality qualification. Provider voice/model settings retain existing contracts; new cloning/voice entitlements are not introduced. KIE speech contracts are registered but absent from the inspected live catalog |
| Text/fonts | Ten system fonts, rich multiline styles/shadows/animations and user-selected local custom fonts verified by hash with source/usage metadata and relinking. An actual Archivo OFL font loaded and was selected for a title exported to a valid 640×360 H.264 file of 90 pictures/three seconds. Signed-in staging persistence/backend readback, missing-font export refusal and same-byte relink passed. Unit checks cover matching bytes and removal-while-used | Production 0286 application/window/activation and live journey; broader font formats/export combinations. The font-removal UI test was blocked by automatic approval review, so its browser guard remains unverified. No proprietary licensed-font catalog is claimed |
| Captions/transcript | Editable timed captions, word styling/import/export and source-aligned transcript range deletion. Actual local automatic recognition of the audible timeline mix inserted ten measured words in the integrated editor; cancellation and atomic insertion are implemented. Initial recognition bound is 120 seconds | More speakers/languages/noise and singing need qualification. Lyric-specific recognition/alignment and vocal isolation remain incomplete. Paid transcription prices/invoices are separate; local recognition does not qualify those jobs |
| Caption translation | User-triggered browser Translator integration with atomic cue replacement, preserved positions/styles, cleared obsolete word alignment, progress and cancellation; unsupported availability is stated in the UI | A successful native translation run is unproven: the required browser translation model was unavailable here. Additional language-pair/device quality qualification and hosted availability remain pending |
| Original catalogs/plugins | Original shapes/title styles/effects/transitions/looks/replaceable-media templates, four generated music loops and six sounds, searchable catalogs. Data-only local catalog-pack creation/import verifies filenames, MIME and SHA-256, with declared source/usage metadata and scoped `local-catalog` capability | Licensed stock, Epidemic Sound and GIPHY production accounts/agreements and approved editable/export usage are unresolved. Imported usage statements do not grant provider rights; no executable or commercial provider plugin parity is claimed |
| Studio generation | Existing catalog-priced Studio jobs, polling/Library recovery and editor result insertion. Explicit Start/End frame choices use bounded actor-owned, MIME-inspected source descriptors; same-image frame assignments and legacy image arrays are supported. Safe public input bounds match gateway limits. Native staging speech draft showed live catalog pricing and readiness without a submission | Hosted Reticle attachment is unavailable; actual paid start/end output/billed-cost evidence and production deployment remain required. No new price or provider job was invented |
| Avatar/lip sync | Dedicated mode exposes existing live-catalog Fal `kling-avatar-v2` (owned photo + speech audio up to 10 seconds) and `latentsync` (owned video + speech, each up to 40 seconds). Source consent and gateway inspection precede debit; output quantity controls are omitted and one existing catalog unit is quoted. Native staging owned-photo/audio pickers, model switching and missing-video preflight were exercised without a generation request | Hosted Reticle attachment is unavailable; actual hosted paid output and broader provider quality qualification remain pending. No paid avatar job was submitted for this work. A registered provider contract is not a licensed stock-avatar catalog or a new entitlement |
| Local export | MP4/MOV H.264/AAC, settings through 4K/60 fps, progress/cancel and memory bounds; originals remain the export source when proxies are used. Native font/motion exports were decoded and measured. Corrected transparent VP9/WebM composited over a grayscale source into an actual four-second 640×360 H.264 MP4 of 120 pictures; Reticle and independent decoding retained the coloured face and grayscale background. An MP4 preview proxy refuses alpha sources | Long real footage, 2K/4K/60-fps combinations and smaller/mobile-machine qualification remain bounded by actual evidence rather than settings alone. Hosted exact Worker build/assets/headers and deployment verification remain required |
| Private Library/Publish handoff | Owner-scoped immutable private editor-render reservation/upload/inspection/read/removal, explicit rights statement, quotas and expiry; Prepare in Publish uses existing Social Upload inspection and an opaque actor-owned upload ID without posting. Corrected native staging save/inspection/Library playback and composer handoff passed, with real backend readback and successful expiry cron | Production 0285 application/clean window, deployment, `EDITOR_LIBRARY_EXPORTS_ENABLED` activation and live journey remain pending. Owner-approved staging fixture removal passed. Existing media-upload and Publish gates still apply |
| Sharing/publish | Existing permission-preserving saved-review links/comments and Publish scheduling are retained. Native Instagram Reels, Facebook Page video and TikTok inbox adapters now have explicit checkpoint/poll/ambiguity handling and request-time capability contracts; YouTube retains its independent path | Hosted provider/account/permission/format qualification and independent activation are pending. TikTok inbox delivery requires the creator to finish posting; it is not automated public posting. TikTok Ads lacks its separate advertiser authorization/account/creative contract and remains unavailable |
| Brand/review | RLS workspace kits and inspected-asset references; saved-revision frame comments, resolve/reopen and permission-aware links. Local DB/API checks and actual hosted staging signed-in kit/comment journeys are recorded | Verify the approved production 0280 application receipt, its complete clean independent window, deployment/flag readback and production signed-in permission journey before activation |

See [foundation verification](FOUNDATION-VERIFICATION-2026-10-10.md), [advanced workspace verification](MULTITRACK-VERIFICATION-2026-10-10.md) and [additional controls verification](CONTROLS-VERIFICATION-2026-10-11.md) for the earlier recorded verdicts, decoded files and limits. Current completion contracts/evidence are in [processing/local assets ADR-0090](../adr/0090-editor-processing-and-local-assets.md), [speech/assets](SPEECH-ASSET-CONTRACTS-2026-10-11.md), [isolated recognition ADR-0091](../adr/0091-isolated-local-speech-recognition.md), [person/motion ADR-0092](../adr/0092-editor-isolated-person-vision-runtime.md), [source slots ADR-0094](../adr/0094-explicit-generation-source-slots.md), [private renders ADR-0089](../adr/0089-editor-private-library-delivery.md) and [native destinations ADR-0093](../adr/0093-native-editor-video-destinations.md).

Cloud project saving, project media uploads and paid Cinema retain their own production gates. No code inventory or local success proves hosted activation or a complete reconciliation window. Every observed area remains in scope; the unresolved provider/licensing, translation, lyrics, semantic relight/reshape/movement, Ads and quality rows remain genuine gaps.


## Owner-directed release amendment — 11 October 2026

The owner requested activation now instead of waiting until tomorrow. The
scoped [ADR-0080 exception](../adr/0080-browser-timeline-editor.md) enables the
implemented advanced workspace, cloud documents, brand/review tools, private
Library delivery, folders/fonts and local inference after fresh health checks
and green release CI. All relevant production migrations have application
receipts. Earlier table statements about pending production application are
historical preparation notes; actual release evidence belongs in
[the activation record](PRODUCTION-ACTIVATION-2026-10-11.md). The original
missing midnight count sample remains unverified; activation is explicitly
an owner-directed exception, not a clean-window announcement.

The unresolved implementation, provider/licensing and output-quality rows above
remain open. Native social destination, project media-upload and paid Cinema
flags remain off.

Production activation and signed-in save/reload/history, brand/review, folder/font,
private Library playback and independently decoded exports subsequently passed.
The activation record above contains the actual deployment and flag readback.
Historical preparation rows do not override this measured live status.

## Camera-generation completion — 11 October 2026

Dedicated AI camera movement now uses the existing live FAL/KIE image-to-video
contracts, with nine direction presets, three paces, scene description, complete
prompt preview, owned Library start/end sources where supported, and normal
quote/consent/idempotency/job recovery. Full composed prompts retain provider
limits. Local Reticle verified the live model filter, direction/pace/quote and
overflow refusal without submitting a paid job; see
[the camera verification record](CAMERA-VERIFICATION-2026-10-11.md).

This adds reviewable generation controls. Actual paid camera-movement output and
billed-cost quality qualification remain open; prompting does not guarantee
trajectory or proprietary CapCut model parity. The local-animation row above
continues to describe browser camera crops, which remain a separate operation.

## Person finishing completion — 11 October 2026

Face/body region reshape and directional person lighting now have real local processing, downloadable H.264/AAC results, unchanged original sources, normal insertion/Undo, cancellation and no-person refusal. See [person finishing evidence](PERSON-FINISHING-2026-10-11.md). These bounded 2D mask-based controls do not recover depth/shadows or fine facial landmarks; their limitations and broader quality qualification stay explicit. Camera-generation controls from PR #890 are verified live; paid output quality remains unqualified.


## Native caption translation qualification — 11 October 2026

The actual production editor completed native Chrome English-to-Spanish
translation of an original test sentence. Caption t1 retained start 0/duration
3 seconds; Undo restored the English text and Redo restored Spanish. The normal
Export SRT -> Download link produced independently read subtitles with the same
0:00.000–0:03.000 interval and Spanish text. The earlier unsupported in-app
browser result remains a limitation for that browser, not evidence that desktop
Chrome cannot translate. This qualifies the measured Chrome/language pair only;
other pairs, lyric translation and wider device quality remain open. No hosted
Reticle verdict or private media upload/provider job is claimed for this test.

## Latest pre-launch testing completion — 11 October 2026

Device generation sources from #902 and owner-approved FAL vocal separation
availability from #904 are now deployed. The latter exposes six named stems
through one quoted six-credit, inspected 120-second job; no paid qualification
job was run. See their separate device-source and audio-stem verification
records for actual production deploy and flag/UI readback. Paid Cinema,
project-media uploads and native social publishing remain off.

Native Chrome translation also exposed a stale availability label after the
model had prepared. The focused fix refreshes availability after a translation
finishes or is cancelled, with stale async language-pair responses still
ignored. An actual native local Chrome model changed from downloadable to
available, produced the timed Spanish cue, and retained Undo/Redo. Reticle
readiness assertions and the Redo action returned explicit positive verdicts;
coverage notes for virtualized unmounted rows remain in the private artifact.
Four existing translation contract tests and focused lint passed. Temporary
SDK/state/CSP wiring was restored before committing. No mocked Translator,
audio upload or remote provider job was used. This qualifies the measured
English/Spanish desktop flow; IAB support and broader language/device quality
remain separate.

Licensed stock/music/GIPHY entitlements, TikTok Ads advertiser authorization,
lyric-specific recognition/alignment and broader real-media/mobile/provider
output quality remain open. These releases are production-hosted owner tests
before public launch, not a statement of full CapCut parity.


## Supplied lyric alignment — 11 October 2026

The caption panel now aligns user-supplied lyric display lines against existing
word timestamps from imported word JSON/timestamped subtitles or local captions.
Case/punctuation changes preserve their matched timestamps. One atomic edit
replaces only the selected timed source, gives each display line karaoke word
highlighting, and supports Undo/Redo, normal subtitle/video export and the
existing version-3 document contract. Missing words, ambiguous repetitions,
estimated/multiword/trimmed/overlapping timings, locked source tracks and project
limits refuse without changing the timeline. A removed selected source requires
a new selection instead of silently broadening the replacement.

Five local Reticle state verdicts verify insertion/timing/karaoke, Undo/Redo and
missing/repeated-word refusal. The actual MP4 exporter produced a fully decoded
640x360/30-fps, 2.9-second/87-picture video with cumulative highlights inspected
in decoded frames. Reticle's export verdict is presence-grade and its synthetic
click reported occlusion; the visible output link was retrieved separately.
Temporary development SDK/store/CSP wiring was removed before commit. Existing
word/caption contracts and focused lyric safety/project-round-trip checks pass.

This supplies lyric formatting/alignment with reviewed word timing. Automatic
singing recognition accuracy, vocals isolation output quality and alignment of
lyrics that differ from the transcript still need qualification; no paid job,
new model, licensed lyrics or universal lyric accuracy is claimed. Production
release and native verification are recorded separately.

## CapCut workspace and original-catalog completion — 13 October 2026

The signed-in CapCut workspace was re-audited across its Media, Templates,
Elements, Audio, Text, Captions, Transcript, Effects, Transitions, Filters,
Brand kit and Plugins areas, including the separate Video effects and Body
effects surfaces. The evidence boundary above remains unchanged: passive REA
evidence ID `ev_2c1bac8ec500c5671a3464e4ea887aa00f3b560650c791e8474d7cd1b5d5aeb8`,
capture SHA-256 `6c21a5c7697572484b44d0d7dda7ebe33e09c661a2fb2549f59b628989d13913`,
and a fresh runtime inspection of the signed-in interface. No CapCut code,
assets, media, presets, music, stickers, templates or thumbnails were copied.

Veyrnox now uses a compact vertical editing rail with independently scrolling
tool panels and selected states. Its original, searchable visual catalogs
include 18 video effects in six categories, 12 directional and compositing
transitions, 20 editable graphic elements, 16 text styles and eight
replaceable-media project templates. Body effects open the actual bounded
person-processing controls rather than a placeholder list. Template actions
create real editable timeline content, and effect intensity and transition
duration remain ordinary project edits with Undo/Redo and document validation.

The expanded effect and transition types are shared by preview and export.
Directional wipes and slides, dissolve, dip-to-black, flash, blur and zoom use
the same sequence metadata in both paths. The original effect compositor now
implements pixelation, grain, glow, light leak, pulse, strobe, old film,
scanlines, monochrome, sepia, chromatic separation, negative, mirror, tiles,
duotone and posterization in addition to the existing neutral and vignette
looks. Posterization bounds CPU pixel readback to a 640x360 working surface so
2K/4K export does not require full-frame synchronous readback.

Local Reticle journeys verified the dense rail and catalog switching, actual
fixture import and clip selection, video-effect application, Body effects,
element insertion, template insertion, a transition between two clips and a
text-style insertion. Reticle exposed an invalid `Arial Black`/weight pairing
in the first Bold Impact attempt; the preset now uses the valid Impact/bold
contract and the repeated insertion produced a positive verdict. Source-state
registration was unavailable in the zero-install session, so the recorded
proof uses concrete DOM pressed/inserted consequences rather than claiming a
store-state verdict. Exploratory locator failures remain preserved instead of
being relabelled as passes.

This completes the native workspace and original catalog implementation in the
areas above. It does not claim CapCut's proprietary catalog, licensed stock,
music or Giphy inventory. Those sources are optional integrations and require
their own usage rights; original and owner-supplied media do not require a new
catalog purchase. The approved KIE Turbo and dialogue qualifications both
ended in provider Internal Error with zero credits consumed, so neither voice
model is qualified or activated. TikTok Ads still requires advertiser-account
authorization, and broad long-edit, mobile, low-resource, real-footage and
provider-output qualification remains separate. Native social publishing,
project-media upload and paid Cinema flags remain off.

## Professional transport and timeline interaction — 13 October 2026

The editor now has a centred five-control transport for start, previous frame,
play/pause, next frame and end; an editable `HH:MM:SS:FF` timecode; visible
duration; fit-to-window and shortcut-guide actions; precise timeline zoom
buttons; ruler drag scrubbing; keyboard ruler movement; playhead auto-follow;
and command-wheel zoom. The command bar remains a single scrollable row, and
the tool rail becomes a compact horizontal strip on narrow viewports while
retaining the dense vertical CapCut-style workspace on desktop.

Keyboard coverage now includes Space/L play, K pause, J back one second,
frame/second stepping, Home/End, Split with S or Cmd/Ctrl+B, Escape to clear
selection, Shift+Z to fit, plus/minus zoom and `?` for the discoverable shortcut
guide. Timecode, fit and zoom calculations have bounded pure helpers with unit
coverage.

Reticle used an actual four-second video fixture and produced positive verdicts
for one-frame stepping (`00:00:00:00` to `00:00:00:01`), typed timecode seeking
to frame 75, zoom increments, fit-to-window and the shortcut dialog's playback,
editing and timeline sections. The first typed-timecode check failed because
synthetic Enter did not submit the form; an explicit Enter handler fixed the
same flow, and the unchanged frame-75 assertion then passed. The initial fit
assertion also expected the wrong viewport-specific zoom value; the measured
3.75-to-3.50 fit consequence subsequently passed. These failures remain in the
Reticle run history rather than being relabelled.

Pixel captures at 720×900 and 1440×1000 confirmed the responsive rail and
desktop workspace composition. The exact final source passed the production
build and complete repository lint with no errors. The full Node suite passed
3,336 tests except for one sandbox-denied localhost listener; that exact
six-test file passed outside the sandbox. Existing repository lint warnings
remain unchanged.

## Immersive workspace chrome — 13 October 2026

The multitrack editor now opens as a dedicated dark production workspace even
when the surrounding Veyrnox site uses its light theme. A compact Veyrnox Cut
header replaces the two tall project rows and keeps cloud save/version state,
local project import/download, workspace layout and the full-editor toggle
available without taking canvas height. Edit commands and timeline controls use
continuous dark toolbars; the media, preview and inspector columns share crisp
panel dividers instead of separate page cards. The header and command bar scroll
horizontally at narrow widths, while the existing tool rail switches to its
mobile horizontal layout.

Reticle produced positive verdicts for opening and closing the compact project
file menu, opening the workspace-layout menu, leaving and re-entering the full
editor, and switching the surrounding site to light theme. The first project
menu assertion checked DOM presence rather than visibility and therefore
returned `no-fault`; the corrected visible/hidden assertions both passed. Pixel
captures at 1280×720 in dark and light site themes, plus 390×844, confirm that
the editing surface remains dark and usable across those measured layouts.
