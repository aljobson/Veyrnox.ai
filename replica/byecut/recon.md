# Recon map: ByeCut (Android runtime + public iOS/iPadOS evidence)

Scope: the core talking-head workflow — import raw takes, ask AI for a first cut, review the proposed cuts and alternate takes, add word-level captions, then export or share. The Veyrnox reconstruction is named **Smart Cut** and must use Veyrnox branding, components, media contracts, and billing.

For: Veyrnox.ai creators producing TikToks, Reels, Shorts, UGC ads, tutorials, course lessons, podcast clips, and product updates.

Date: 2026-11-24

## Clean-room boundary

This map uses public product pages, the public App Store listing/version history, public terms, five public marketing screenshots, and read-only interaction with the user's own installed Android app. It does not use ByeCut source code, decompiled methods, private APIs, network captures, proprietary prompts, customer data, or copied product assets. The Android run stopped before starting a trial or sending the user's media to ByeCut's AI service. Reference screenshots in `screens/` are evidence only and must never ship.

REA readiness was checked because the user requested the REA workflow. The installed CLI reported version 3.2.1 and predates Android analysis, while the active Codex session exposed no usable Android REA target. Package identity was established independently with Android package-manager output and Android SDK `aapt` against the user-authorized APK copy; those are shell observations, not REA evidence. The current installed split APK set was copied intact to `/Users/aljobson/Downloads/ByeCut-APK/`, with convenience copies at `/Users/aljobson/Downloads/ByeCut.apk` and `/Users/aljobson/Downloads/ByeCut.apks`, at the user's request.

## Android device observations (2026-11-20 and 2026-11-24)

- Device: the user's unlocked Pixel 10 Pro XL on Android 17, USB serial intentionally omitted from this report.
- Package: `com.thinkbyte.theocut`; the current 2026-11-24 install is version `0.3.13` (version code 17), application label `ByeCut` (`aapt`-verified). The earlier 2026-11-20 run used 0.3.11 (14).
- S02 Projects was observed directly: search, settings, Batch AI Edit, filter/sort, new project, `Start an AI Edit`, an editing-time-saved card, folders, and a recent project card.
- S08 Editor was observed directly: portrait preview, editable project name, Export, playback, undo/redo, zoomable thumbnail timeline and bottom `AI Edit / Cut / Sound / Text / Layers` tools.
- S05 AI Edit setup was observed directly on the existing local project: optional script and notes, Music Video, Multiple Reels, output count, Original/9:16 shape, Snappy-to-Relaxed pacing, Auto-detect spoken language, source clips and `Create Best Cut`. The account had zero AI edits, so no analysis was started.
- S12 Export was observed directly without rendering: Video/Audio Only, automatic gallery save, 1080p, Source (30 FPS), H.264, Recommended quality and a 1080×1920 / 00:18 / ~38 MB summary.
- S13 Settings was observed directly: ByeCut Free, Google Drive Sync off, account, zero AI edits, storage, Video & Captions auto-detect, system appearance, device language, notifications off, Privacy & AI, tour/onboarding, support/rating and version 0.3.13 (17).
- Batch AI Edit's plan boundary was observed directly. It says one action can start several selected videos and they can finish while ByeCut is closed; it is gated to Pro, Extreme and Ultimate. `See Plans` was not pressed.
- S14 subscription gate was observed directly. The 0.3.13 trial sheet disclosed seven days free, a day-five reminder and day-seven billing. `Continue` was not pressed, notifications were not enabled and no trial was started.
- S15 first-use AI disclosure was observed directly. It says AI Edit finds the best takes, shares audio and some video frames, and does not use them to train AI models, with `Agree and Continue` and `Not Now`.
- The current public website says AI Edit sends audio/transcript/script/notes and never video, while the observed Android disclosure says audio and some frames. That is a live product inconsistency, not a basis for Veyrnox copy. Veyrnox must describe only its own implemented processor and data path.
- Neither observed run crossed a paid analysis, export, upload, purchase or new-consent boundary. Setup and export configuration are now device-observed; processing progress, AI results/review, completed export, background completion and notification delivery remain public-source evidence rather than device-verified behavior.

## Sources

| # | source | URL | evidence used |
| --- | --- | --- | --- |
| 1 | Official product page | https://byecut.com/ | Core promise, three-step flow, editor features, privacy posture, pricing summary, and public screenshots |
| 2 | App Store listing | https://apps.apple.com/us/app/byecut-ai-video-editor/id6813083215 | Current app description, sign-in, AI Edit stages, manual editor, storage/sync, plans, languages, compatibility, and version history |
| 3 | Official AI editing guide | https://byecut.com/guides/how-to-edit-videos-with-ai-on-iphone | Import, optional script, rough cut, RAW/CUT review, captions/polish, and export workflow |
| 4 | Official support/FAQ | https://byecut.com/support | Public support entry point and product FAQ routing |
| 5 | Official pricing | https://byecut.com/pricing | Free/Creator/Pro positioning and allowance model |
| 6 | Current Terms of Use | https://thinkbyte.tech/en/portfolio/byecut/terms | License and clean-room boundary; accounts, allowance, review/backup responsibilities, subscriptions, and acceptable-use constraints |
| 7 | Current privacy policy | https://thinkbyte.tech/en/portfolio/byecut/privacy | Public privacy reference for audio/text processing and account-linked data |
| 8 | AI Edit feature page | https://byecut.com/features/ai-auto-edit | Public AI Edit positioning and entry point |
| 9 | Auto-captions feature page | https://byecut.com/features/auto-captions | Public caption positioning and presets entry point |
| 10 | Official cross-platform download page | https://byecut.com/download?from=mobile_bar | Confirms Android availability and the advertised AI Edit/caption/editor feature set |
| 11 | User-owned Android install | android://com.thinkbyte.theocut@0.3.13 | Package identity and directly observed S02, S05, S08, S12, S13, S14 and S15 states |
| 12 | User-authorized APK copy | file:///Users/aljobson/Downloads/ByeCut-APK/ | Base plus arm64, English and xxhdpi split identity; copied for the owner, not shipped or decompiled |

## Core loop

A creator imports messy talking-head takes, optionally supplies the intended script and notes, receives a proposed best-take edit with silences/filler/retakes removed, reviews or swaps questionable cuts, then captions and exports the result.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen or publicly described |
| --- | --- | --- | --- | --- | --- |
| S01 | Welcome and sign-in | First launch or signed-out state | Authenticate before online AI features | Sign in with Apple, email, six-digit code, privacy/AI-sharing explanation | signed out; Apple sign-in; email-code sign-in; error guidance described |
| S02 | Home and projects | App launch after sign-in | Resume projects, see saved time, start a project | project cards, folders, search/sort, time-saved summary, new-project action, allowance summary | Android populated state observed; empty/folder/sync states publicly described |
| S03 | New project menu | `+` from Home | Choose the creation path | Start AI Edit, template, Photos import, Files import | menu pictured publicly; AI Edit and manual paths |
| S04 | Media import | S03 → Photos or Files | Select one long recording or several clips | media grid/list, selection order, duration/quality/storage checks, iCloud-file state | selected/unselected; importing; low storage; iCloud delay; unsupported/no speech warning |
| S05 | AI Edit setup | S03 → Start AI Edit → import | Tell the editor what should survive and how it should feel | optional script, editing notes, Music Video, Multiple Reels, output count, Original/9:16 shape, spoken-language detection/override, Snappy↔Relaxed pacing, source clips, allowance estimate, start action | Android populated setup observed with zero allowance; script supplied; notes supplied; language auto/manual; over allowance; no speech |
| S06 | AI Edit progress | Start from S05 | Show transcription, analysis, quality checks, retry/recovery | stage list, percentage/status, cancel, background/Lock Screen progress, retry guidance | transcribing; analysing; selecting takes; quality checks; retrying; interrupted; failed; complete |
| S07 | Cut review | AI plan needs attention or finishes | Compare source and proposal before applying | RAW/CUT toggle, duration saved, transcript sections, warnings, kept/removed labels, alternate takes, preview, restart/discard/apply | passed and auto-apply; warning; incomplete script match; alternate takes; thumbs rating |
| S08 | Main editor | Apply plan or create manually | Refine the non-destructive timeline | video preview, playhead, multitrack timeline, waveforms, snapping, trim/split/merge, undo/redo, safe-area guides, tool tray | Android portrait editor and populated timeline observed; landscape/loading/error states publicly described |
| S09 | Captions and text | Editor → Captions/Text | Generate, correct, style, show/hide, and position captions | word-level transcript, language selector, Edit Text, style cards, resize handles, alignment guides, visibility toggle | generating; existing captions; correction; hidden; timing issue; language issue; style preview |
| S10 | Media and effects tools | Editor toolbar | Add polish after the first cut | titles, overlays, music, imported audio, voiceover, cleanup, filters/colour, speed/reverse/freeze, stabilization, background removal, masks, chroma key, face retouch | tool-specific empty/configured/processing/error states; exact layouts not established |
| S11 | Plain-language assistant | Editor → assistant | Turn an instruction into an inspectable edit plan | prompt field, proposed operations, affected clips, warnings, accept/reject | described publicly; exact prompt and private implementation unknown |
| S12 | Export and share | Editor → Export | Render with explicit output settings and preserve progress | Video/Audio Only, automatic gallery save, resolution, frame rate, codec, quality, dimensions/duration/size summary, share sheet, progress preview | Android 1080p / Source 30 FPS / H.264 / Recommended setup observed; public sources describe up to 4K/60 fps, HEVC, background rendering, success, failure and low storage |
| S13 | Settings, account, sync, and plans | Home/Editor → Settings | Manage identity, language, appearance, AI allowance, sync, notifications, privacy, subscriptions and support | account, allowance meter, language, appearance, Google Drive sync, storage, Video & Captions, notifications, Privacy & AI, tour/onboarding, support, plans | Android Free plan with zero allowance, sync/notifications off, auto-detect captions, system appearance and device language observed; paid/restore/delete states not tested |
| S14 | AI Edit subscription gate | Android editor → AI Edit without entitlement | Explain paid AI value and select a plan | value bullets, plan cards, current selection, trial CTA, restore, terms/privacy/redeem links, close | Android populated paywall observed; no trial started; purchase/restore/error states not tested |
| S15 | AI processing disclosure | Android AI Edit first use after gate | Obtain an informed choice before any remote analysis | best-cut hero, data-sharing summary, training statement, Learn More, Agree and Continue, Not Now | Android disclosure observed; Not Now/back path verified; Agree path deliberately not executed |

## Flows

```text
F01 First AI edit
    S01 sign in → S02 Home → S03 New project → S04 import → S05 script/notes/pacing → S06 progress → S07 review → S08 editor → S09 captions → S12 export
    happy path clicks: about 10 before export confirmation
    edge: sign-in error, no speech, low storage, allowance exceeded, network interruption, AI draft needs review, export failure

F02 Fast repeat edit
    S02 → S03 → S04 → S05 Start → S06 → S08 (auto-applied after quality checks) → S12
    happy path clicks: about 6 before export confirmation
    edge: previous settings remembered, script absent, language misdetected, background completion notification arrives late

F03 Review and swap a take
    S07 choose transcript section → preview candidate takes → select alternate → compare RAW/CUT → Apply → S08
    happy path clicks: 4
    edge: only one viable take, alternate omits words, clipped word warning, section does not match the supplied script

F04 Manual edit without AI
    S02 → S03 → S04 → S08 trim/split/reorder → S10 polish → S09 captions → S12
    happy path clicks: variable
    edge: offline use, mixed aspect ratios, missing audio, unsupported media, iCloud download delay

F05 Caption and correct
    S08 → S09 generate → choose language/style → Edit Text → show/hide → S08
    happy path clicks: 4–6
    edge: permission disabled, incorrect language, proper-name correction, clips inserted after captions, timing recovery

F06 Organise and resume
    S02 create folder/subfolder → move project → optionally enable iCloud sync → reopen project → S08
    happy path clicks: 4–6
    edge: sync off, device offline, portable backup only, project media missing, local/iCloud conflict

F07 Export and share
    S08 → S12 choose format → Export → progress preview → save to Photos or share
    happy path clicks: 3–4
    edge: low storage, Photos permission denied, background render interrupted, codec unsupported by destination, share cancelled

F08 Observed Android gated AI Edit
    S02 open recent project → S08 tap AI Edit → S14 close without trial → S15 review disclosure → Not Now/back → S08
    happy path clicks: blocked before the paid/consented AI path
    edge: no entitlement, restore purchase, consent declined, public privacy copy conflicts with Android disclosure
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| AppShell | compact phone, landscape/tablet | signed out, signed in, backgrounded | all |
| ProjectCard | recent, folder child, template-derived | local, synced, missing media, rendering | S02 |
| NewProjectMenu | AI Edit, template, Photos, Files | default, permission denied | S03 |
| MediaImporter | Photos, Files, multi-select | importing, iCloud wait, low storage, invalid media | S04 |
| ScriptNotesForm | script, notes, both | empty, populated, mismatch warning | S05, S07 |
| LanguagePicker | automatic, manual | detecting, detected, unsupported | S05, S09 |
| PacingSlider | Snappy↔Relaxed | default, adjusted, disabled | S05 |
| AllowanceQuote | free intro, recurring plan, over limit | eligible, reserved, exhausted, restored | S05, S06, S13 |
| AIProgress | modal/page, Live Activity | queued, active stage, retrying, failed, complete | S06 |
| RawCutCompare | RAW, CUT, side-by-side concept | loading, playing, paused | S07 |
| TranscriptSection | kept, removed, warning, alternate available | collapsed, expanded, selected | S07 |
| TakeCard | kept, rejected, alternate | previewing, selected, unavailable | S07 |
| WarningBanner | speech, clipped word, script mismatch, storage, network | info, warning, blocking | S04–S12 |
| VideoPreview | canvas ratios, Reels-safe preview | loading, ready, effects processing | S08, S12 |
| MultiTrackTimeline | video, overlay, audio, caption | idle, selected, trimming, snapping, undoable | S08 |
| EditorToolTray | compact, expanded | enabled, disabled, processing | S08, S10 |
| CaptionStyleCard | simple/classic/trending/box/neon/poster-like families | selected, preview, unavailable font | S09 |
| AssistantPlanPanel | operations list, warning summary | drafting, review, accepted, rejected | S11 |
| ExportSettingsSheet | social preset, custom | valid, low-storage warning, remembered | S12 |
| ExportProgress | inline/Live Activity | rendering, background, failed, saved/shared | S12 |
| SettingsRow | navigation, switch, destructive | default, loading, error | S13 |
| PlanCard | Free, Creator, Pro, Extreme | current, trial eligible, purchase/restore error | S13 |
| AiSubscriptionGate | plan list, trial CTA, restore | selected, not entitled, purchase error, closed | S14 |
| AiProcessingDisclosure | compact sheet, full details link | not accepted, accepted version, declined | S15 |

## Inferred data model

```text
User            id, auth_provider, locale, appearance, created_at
                evidence: S01 and App Store description
                confidence: high

Project         id, owner_id, folder_id, title, canvas, status, local_uri, sync_state,
                created_at, updated_at, last_export_settings
                evidence: S02, S08, S12 and public version history
                confidence: high

Folder          id, owner_id, parent_id, name, sort_order
                evidence: public version 0.3.3 notes
                confidence: high

MediaAsset      id, project_id, kind, source, local_uri, duration_ms, width, height,
                fps, codec, audio_present, import_state
                evidence: S04 and editor/export descriptions
                confidence: high

Clip            id, project_id, media_asset_id, track_id, source_in_ms, source_out_ms,
                timeline_start_ms, speed, reverse, freeze_at_ms, effect_state
                evidence: public editor feature list
                confidence: high

TranscriptWord  id, project_id, clip_id, text, start_ms, end_ms, language, confidence
                evidence: word-level captions and timeline alignment behavior
                confidence: high

TranscriptSection id, edit_plan_id, order, intended_line, start_ms, end_ms, decision,
                  warning, selected_take_id
                  evidence: section review and alternate-take release notes
                  confidence: medium

TakeCandidate   id, transcript_section_id, clip_id, source_range, score_summary,
                rejection_reason, selected
                evidence: best-take public explanation and S07 behavior
                confidence: medium; scoring fields are intentionally unspecified

EditPlan        id, project_id, script, notes, language, pacing, status,
                raw_duration_ms, cut_duration_ms, warnings, quality_state, created_at
                evidence: S05–S07 and version history
                confidence: high

TimelineTrack   id, project_id, kind, order, muted, hidden
TimelineItem    id, track_id, asset_or_text_ref, start_ms, duration_ms, transform, style
                evidence: multi-track editor and caption/overlay behavior
                confidence: high

CaptionStyle    id, owner_scope, name, typography, colours, box, animation, placement
                evidence: public caption picker screenshots and description
                confidence: medium; exact proprietary presets are out of scope

ExportJob       id, project_id, resolution, fps, codec, destination, status, progress,
                output_uri, error_code, created_at, finished_at
                evidence: S12 and background export release notes
                confidence: high

AiAllowance     owner_id, plan, period_start, period_end, seconds_total, seconds_reserved,
                seconds_used, intro_edit_state, referral_bonus
                evidence: Terms sections 3–5 and public plan descriptions
                confidence: high

ProjectBackup   id, project_id, format_version, created_at, local_uri, import_state
                evidence: public portable-backup description
                confidence: medium

ConsentReceipt owner_id, project_id, disclosure_version, accepted_at, data_categories,
               processor, policy_version
               evidence: observed Android S15; server enforcement is inferred
               confidence: medium
```

Relationships: User 1-n Project; User 1-n Folder; Folder 0/1-n Folder and Project; Project 1-n MediaAsset, Clip, EditPlan, TimelineTrack, ExportJob, and ProjectBackup; EditPlan 1-n TranscriptSection; TranscriptSection 1-n TakeCandidate, while its TranscriptWord membership is derived from overlapping time ranges; TimelineTrack 1-n TimelineItem; User 1-1 current AiAllowance.

## Feature matrix

See `features.csv`. Must: 27, should: 33, could: 18, skip: 9.

## Out of scope (cannot or should not be cloned)

- ByeCut’s name, icon, copy, exact UI, caption preset artwork, screenshots, templates, fonts, music, or stock catalogue.
- Proprietary best-take scoring, prompts, quality-check heuristics, private APIs, telemetry schema, account data, and vendor infrastructure.
- Decrypting or extracting the installed iOS app, decompiling its binary, intercepting its traffic, or bypassing Apple/ByeCut protections.
- ByeCut/Thinkbyte subscription products, referral network, offer codes, and App Store purchase history. Veyrnox must use its own credit/plan system.
- TikTok, Instagram, YouTube, Apple, OpenAI, or other third-party services and their networks; only documented integrations with Veyrnox-owned credentials may be built.
- Exact on-device background-removal, face-retouch, stabilization, and speech models unless Veyrnox has an independently licensed implementation.
- iCloud-specific behavior unless implemented through documented Apple APIs in the native Veyrnox app.

## Veyrnox product decision

Build **Smart Cut** as an explainable pre-editor rather than a full second video editor. It should produce a non-destructive edit plan over Veyrnox-owned uploads, expose transcript sections, keep/reject reasons and alternate takes, then apply the accepted plan into the existing editor. Until a real analysis backend is independently designed, use a clearly labelled deterministic demo planner that performs no production spend or external calls. This preserves the valuable interaction model without pretending the proprietary ranking system has been reproduced.

## Size

Screens: 15. Flows: 8. Entities: 16. Hard parts: word-accurate speech segmentation and best-take ranking; non-destructive timeline mutation with reversible plan application; reliable large-media import/export/background execution. Core Smart Cut slice: **M** (a few weeks in the existing editor). Full parity with every manual editing/effect/sync surface: **L** (a quarter) and should be split into milestones.

