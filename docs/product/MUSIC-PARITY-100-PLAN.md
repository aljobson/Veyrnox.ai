# Music parity closeout plan

Date: 2026-11-23

## Goal

Raise Veyrnox Audio/Music from an evidence-corrected 69.5% product-capability parity with Suno to at least 93% on shipped, user-visible outcomes, while preserving Veyrnox's own provider, rights, credit, privacy and native-product boundaries.

This target is feature parity, not a claim that ACE-Step or any standby supplier has the same subjective output quality as Suno's current models. Provider quality requires a separate blind listening benchmark.

## Observable acceptance criteria

1. One checked-in scorecard maps each current Suno Audio/Music outcome to Veyrnox web, iOS and backend evidence, a production gate, an immutable row weight within its area, and one of: shipped, qualified, intentionally different, externally blocked or missing. The checked-in rows derive the 69.5% baseline and the final score. A test fails when a static Music capability is neither mapped to a frozen row nor explicitly exempt as infrastructure, row weights in an area do not sum to 100, the weighted total is miscomputed, or a claimed shipped row loses its route/evidence.
2. The current iOS source builds locally through Xcode on the consolidated native environment, installs on the iPhone 17 Pro simulator, and completes a deterministic Music smoke journey. The existing Swift 6 fixes from PR #2665 are rebased or ported onto current `main`; its stale OTA-version test and language-direction regression are corrected rather than skipped. The connected physical iPhone must be trusted and complete the hardware/audio/App Store sandbox proof package before the closeout may claim 93%; if it is unavailable, those rows remain qualified or missing and the lower score is reported.
3. Music Albums are first-class, owner-fenced releases rather than renamed playlists: a creator can create a draft album, order owned songs, add title/description/scanned artwork metadata, publish/unpublish it, convert an existing playlist without destroying that playlist, report a public album, and view a block-filtered public album. Web and iOS expose the same outcomes with native interaction patterns. Publication remains idempotent and includes only active songs with an independently published, non-blocked `music_publications` row and its rights attestation. Later song takedown, trash or viewer block removes the affected public track without leaking its asset. Account deletion remains blocked by existing Music content until that content is explicitly removed; removed album/song rows are classified in the deletion and privacy-export paths.
4. Create accepts multimodal inspiration without silently changing the paid generation contract: an owned image, short video, voice memo or audio loop can be attached; the system produces an editable textual brief; the user reviews that brief before quote/confirm; rights declarations, size/duration limits, account fencing and deletion are explicit. The immutable generation snapshot stores the reviewed brief and attachment provenance, not an opaque mutable reference.
5. Studio offers a capability-gated conversational action surface for read-only project questions and deterministic local editor commands. While `magicBar` is false, its planner cannot emit generation, replacement or other Magic Bar-equivalent actions. Generative conversational actions require `magicBar` as well as the new `studioChat` capability and reuse existing quote/idempotency/recovery-safe operations. Unsupported plugin design, provider-only synthesis and dark runtime capabilities return an honest explanation. `magicBar`, `beatCloud`, `beatLibrarySave` and `beatV5Writes` remain off until their server capabilities are enabled.
6. Community parity includes a capability-gated daily song challenge and public album discovery. Challenge prompts are server-owned, date/time-zone deterministic, optional and reusable; participation never bypasses the normal quote/confirm path. No gamified credit reward is introduced without a separate economic decision.
7. Audio continuity extends the existing web `MusicQueueProvider` and mobile Music player rather than creating a second queue: Music, Speech, Dialogue and the audio shelf can hand typed public-slug or owned-asset entries to it. The versioned storage key is account-scoped and purged on sign-out/account change. Expired URLs are refreshed through the existing mobile TTL boundary; deleted assets recover safely. Playback state never stores bearer URLs in durable client storage.
8. The final score is recalculated from the checked-in row rubric. `shipped` earns 1, `qualified` earns 0.5, `missing` and `externally_blocked` earn 0, and `intentionally_different` earns 1 only when the same user outcome is proved; otherwise it earns 0. Each area's row weights sum to 100, then area results receive the fixed product weights below. Provider health is scored only in `create.production-route-health`, `edit.cross-provider-format-fidelity` and `ios.release-build-route-health`; other rows measure feature contracts/UI and cite those health rows rather than being downgraded again. Simulator proof closes navigation, layout, deterministic state and accessibility-contract rows only. Physical hardware is mandatory for mic interruption/latency, audio fidelity/dropout, external MIDI/hot-plug and RevenueCat/App Store sandbox rows. Source-only and externally blocked rows are reported separately; scores and row weights cannot change after Slice 0.

## Fixed rubric

| Area | Weight | Current estimate | Target |
| --- | ---: | ---: | ---: |
| Creation and model controls | 25 | 80 | 90 |
| Song editing, stems, covers and extensions | 20 | 72.5 | 85 |
| Beats / generative DAW | 20 | 62.5 | 97.5 |
| Library, albums and discovery | 15 | 75 | 100 |
| Community and ecosystem | 10 | 60 | 100 |
| Production-ready iOS experience | 10 | 52.5 | 93 |
| Weighted total | 100 | 69.5 (rounded: 70) | 93.3 |

The target arithmetic is `(25×90 + 20×85 + 20×97.5 + 15×100 + 10×100 + 10×93) / 100 = 93.3`. The evidence-corrected current arithmetic is `(25×80 + 20×72.5 + 20×62.5 + 15×75 + 10×60 + 10×52.5) / 100 = 69.5`, displayed as 70 using round-half-up to a whole percentage. This corrects the earlier 77 estimate, which wrongly counted physical-device-dependent source rows as shipped and counted Music MCP before it supported Music. The rubric and row weights below are frozen before implementation. Subjective audio quality is excluded and reported separately.

### Frozen row rubric

Status credits are `shipped=1`, `qualified=0.5`, `missing=0`, `externally_blocked=0`, and `intentionally_different=1` only when the same outcome is proved. Weights sum to 100 inside each area. `Target` is the planned closeout status; exceeding it may raise an area above its table minimum, but falling below it cannot be hidden by changing weights.

#### Creation and model controls — current 80, target 90

| Stable row | Weight | Current | Target | Required proof |
| --- | ---: | --- | --- | --- |
| `create.simple-custom` | 15 | shipped | shipped | Reticle + simulator |
| `create.advanced-musical-controls` | 15 | shipped | shipped | contract + Reticle + simulator |
| `create.lyrics-instrumental` | 10 | shipped | shipped | contract + Reticle + simulator |
| `create.quote-rights-recovery` | 10 | shipped | shipped | contract |
| `create.audio-reference-input` | 10 | shipped | shipped | contract + UI |
| `create.models-personalization` | 10 | intentionally_different | intentionally_different | product evidence |
| `create.production-route-health` | 8 | qualified | qualified | production route probe |
| `create.native-qualification` | 12 | qualified | qualified | simulator plus physical audio proof where applicable |
| `create.multimodal-inspiration` | 5 | missing | shipped | scan/quota/contract + Reticle + simulator |
| `create.daily-challenge` | 5 | missing | shipped | UTC contract + Reticle + simulator |

The `create.models-personalization` same-outcome evidence is the private owned-example Lyricist profile contract and UI in `app/veyrnox/_components/music/MusicLyricistProfiles.jsx`, with its contract tests in `tests/musicLyricist.test.mjs`; it provides reusable private creative direction without claiming a trained custom model.

Target calculation: `70 shipped + 0.5×8 route qualified + 5 inspiration shipped + 5 challenge shipped + 0.5×12 native qualified = 90`. Restoring the route can raise the result later, but this plan does not depend on an owner-approved paid probe.

#### Song editing, stems, covers and extensions — current 72.5, target 85

| Stable row | Weight | Current | Target | Required proof |
| --- | ---: | --- | --- | --- |
| `edit.cover-reuse-remix` | 15 | shipped | shipped | contract + UI |
| `edit.sections-extend-crop` | 20 | shipped | shipped | contract + UI |
| `edit.stems-target-stems` | 15 | qualified | shipped | contract + physical fidelity |
| `edit.export-playback` | 10 | qualified | shipped | contract + physical fidelity |
| `edit.version-lineage` | 10 | shipped | shipped | contract |
| `edit.rights-takedown` | 10 | shipped | shipped | contract |
| `edit.cross-provider-format-fidelity` | 10 | qualified | qualified | production route + physical fidelity |
| `edit.advanced-stem-selection` | 5 | missing | missing | requires a verified provider contract not authorized here |
| `edit.surgical-lyric-change` | 5 | missing | missing | requires a verified provider contract not authorized here |

Current calculation: `55 shipped + 0.5×35 qualified = 72.5`. Target calculation: stems and export gain required physical proof while cross-provider format/fidelity remains qualified and the two provider-dependent rows remain missing, producing `55 + 25 + 5 = 85`.

#### Beats / generative DAW — current 62.5, target 97.5

| Stable row | Weight | Current | Target | Required proof |
| --- | ---: | --- | --- | --- |
| `daw.arrangement-transport` | 15 | shipped | shipped | contracts + simulator |
| `daw.piano-instruments` | 15 | shipped | shipped | contracts + simulator |
| `daw.mixer-effects-automation` | 15 | qualified | shipped | physical fidelity/dropout |
| `daw.recording-takes` | 10 | qualified | shipped | physical mic proof |
| `daw.mixdown-share` | 10 | qualified | shipped | physical fidelity/memory |
| `daw.beat-ai` | 5 | shipped | shipped | quote/recovery + UI |
| `daw.external-midi` | 10 | qualified | shipped | physical USB/Bluetooth/hot-plug |
| `daw.native-adaptive-accessibility` | 10 | qualified | shipped | simulator + VoiceOver/device |
| `daw.conversational-local-actions` | 5 | missing | shipped | gate/parser + Reticle + simulator |
| `daw.generative-chat-and-plugins` | 5 | missing | qualified | dual gate; plugin generation excluded |

Current calculation: `35 shipped + 0.5×55 qualified = 62.5`. Target calculation: all physical/native qualified rows and local conversational actions ship; generative chat remains qualified, producing `97.5`.

#### Library, albums and discovery — current 75, target 100

| Stable row | Weight | Current | Target | Required proof |
| --- | ---: | --- | --- | --- |
| `library.songs-history-hooks` | 15 | shipped | shipped | contract + UI |
| `library.playlists-workspaces` | 15 | shipped | shipped | contract + UI |
| `library.search-sort-filters` | 10 | shipped | shipped | Reticle + simulator |
| `library.discovery-profiles` | 10 | shipped | shipped | block-filtered contract + UI |
| `library.publication-share` | 10 | shipped | shipped | moderation contract + UI |
| `library.queue-public-slugs` | 5 | shipped | shipped | existing contract |
| `library.native-signed-assets` | 10 | qualified | shipped | physical playback/account fence |
| `library.discovery-native-polish` | 10 | qualified | shipped | simulator + accessibility |
| `library.albums-releases` | 10 | missing | shipped | database/moderation + Reticle + simulator |
| `library.account-fenced-audio-queue` | 5 | missing | shipped | storage/account tests + UI |

Target calculation: all rows ship for 100.

#### Community and ecosystem — current 60, target 100

| Stable row | Weight | Current | Target | Required proof |
| --- | ---: | --- | --- | --- |
| `community.public-tracks-creators` | 15 | shipped | shipped | block-filtered contract + UI |
| `community.comments-reports-blocks` | 15 | shipped | shipped | moderation contract + UI |
| `community.likes-play-counts` | 10 | shipped | shipped | contract + UI |
| `community.listen-links-app-handoff` | 10 | shipped | shipped | contract + UI |
| `community.music-mcp` | 5 | missing | shipped | Music quote/create/status/playlist connector contract |
| `community.mobile-social-polish` | 10 | qualified | shipped | simulator/device accessibility |
| `community.discovery-ranking` | 10 | qualified | shipped | production capability + UI |
| `community.public-albums` | 10 | missing | shipped | moderation + Reticle + simulator |
| `community.daily-challenge-participation` | 5 | missing | shipped | UTC contract + UI |
| `community.album-profile-shelves` | 5 | missing | shipped | block-filtered contract + UI |
| `community.challenge-discovery-shelf` | 5 | missing | shipped | Reticle + simulator |

Target calculation: Music MCP, all missing rows and the two qualified rows ship, producing `100`. The Music MCP row is not credited until `lib/veyrnoxMcp.js` exposes Music estimate/create/status and playlist operations through the existing quote/confirmation/recovery boundary.

#### Production-ready iOS experience — current 52.5, target 93

| Stable row | Weight | Current | Target | Required proof |
| --- | ---: | --- | --- | --- |
| `ios.navigation-core-create` | 15 | shipped | shipped | simulator |
| `ios.song-actions-library` | 15 | qualified | shipped | simulator + signed-asset device proof |
| `ios.beats-source-contracts` | 10 | shipped | shipped | contracts |
| `ios.orientation-layout` | 8 | qualified | shipped | simulator/device rotation |
| `ios.voiceover-dynamic-type-rtl` | 8 | qualified | shipped | simulator plus VoiceOver device walkthrough |
| `ios.audio-playback-export-fidelity` | 8 | qualified | shipped | physical device |
| `ios.mic-interruption-latency` | 8 | qualified | shipped | physical device |
| `ios.external-midi-hotplug` | 8 | qualified | shipped | physical device and hardware |
| `ios.revenuecat-app-store-sandbox` | 6 | missing | shipped | physical device/App Store sandbox |
| `ios.release-build-route-health` | 14 | missing | qualified | exact-commit Xcode build + healthy production route |

Current calculation: `25 shipped + 0.5×55 qualified = 52.5`. Target calculation: every current qualified row and the RevenueCat/App Store sandbox row ship while release build/route health remains qualified, producing `25 + 55 + 6 + 7 = 93`. If trusted physical-device and sandbox evidence is absent, the 93% product goal is not claimed. Physical-device proof is required, not optional, for the published closeout target.

### Shared-proof sensitivity

Some distinct user outcomes share one implementation or qualification package. They keep separate rows because they measure different surfaces, but a single proof artifact is reused and the headline reports correlated risk explicitly.

| Shared package | Rows | Target-total loss if package fails |
| --- | --- | ---: |
| Albums/public release | `library.albums-releases`, `community.public-albums`, `community.album-profile-shelves` | 3.00 points |
| Daily challenge | `create.daily-challenge`, `community.daily-challenge-participation`, `community.challenge-discovery-shelf` | 2.25 points |
| Physical audio/MIDI/accessibility qualification | Editing stems/export; DAW mixer/record/mixdown/MIDI/accessibility; Library signed assets; iOS signed assets/audio/mic/MIDI/RevenueCat/accessibility | 11.70 points |
| Studio conversational actions | `daw.conversational-local-actions`, `daw.generative-chat-and-plugins` | 1.50 points |
| Owned persistent queue | `library.account-fenced-audio-queue` | 0.75 points |
| Music MCP | `community.music-mcp` | 0.50 points |

Production route health is intentionally only qualified in the target and therefore contributes no hidden optimistic delta. Each shared package has one canonical evidence bundle referenced by every affected row.

The physical/device package exposure is 11.70 weighted product points: Editing fidelity rows 2.50, DAW audio/MIDI rows 4.50, Library signed assets 0.75, iOS signed assets/audio/mic/MIDI/RevenueCat 2.55, and DAW/iOS device accessibility rows 1.40. The 93.3 target has no contingency: every shared package in this table must earn its planned status, or the lower computed score is reported without a 93% claim.

### Static capability mapping

The drift test uses an explicit many-to-one map rather than inventing one weighted row per flag. `ui`, `schema` and `dispatch` are infrastructure prerequisites and are explicitly exempt from product-row coverage. All other current and planned names must map as follows:

| Flags | Disposition | Frozen row(s) |
| --- | --- | --- |
| `library`, `libraryTabs` | required | `library.songs-history-hooks`, `library.search-sort-filters` |
| `sources` | required | `create.audio-reference-input` |
| `references` | dark evidence only; not required for shipped audio input | `create.audio-reference-input` |
| `generation` | required health boundary | `create.production-route-health` |
| `distribution`, `publication` | required | `library.publication-share` |
| `playlists`, `collaboration` | required | `library.playlists-workspaces` |
| `editing`, `reverse`, `cover`, `reuse`, `remix`, `stems`, `targetStems`, `trackAdd`, `extend`, `replace`, `addSection`, `longSongs`, `lyrics` | required where the mapped row is shipped | the `edit.*` rows |
| `studio`, `beatEditor`, `beatAi` | required where the mapped row is shipped | the `daw.*` rows |
| `magicBar`, `beatCloud`, `beatLibrarySave`, `beatV5Writes`, `blocks` | dark evidence only; a false value does not invalidate unrelated shipped rows | `daw.generative-chat-and-plugins` and the applicable gated evidence |
| `labs`, `ranking`, `bestOf` | required for ranking/best-of rows | `community.discovery-ranking` |
| `reactions`, `follows`, `comments`, `notifications`, `plays`, `songReports`, `rails` | required for their mapped social outcome | the `community.*` public/social rows |
| `albums` | required after owner activation | `library.albums-releases`, `community.public-albums`, `community.album-profile-shelves` |
| `inspiration` | required after owner activation | `create.multimodal-inspiration` |
| `studioChat` | required after owner activation; generative actions also require `magicBar` | `daw.conversational-local-actions`, `daw.generative-chat-and-plugins` |
| `dailyChallenge` | required after owner activation | `create.daily-challenge`, the `community.*challenge*` rows |
| `persistentQueue` | required only for owned-asset persistence | `library.account-fenced-audio-queue` only |

The test fails when a flag is neither mapped nor explicitly exempt, or when a row claims shipped while a mapping marked required is off. Dark-evidence mappings are recorded but do not invalidate unrelated shipped outcomes. Adding a flag does not silently add or reweight a score row.

### Pre-activation and post-activation claims

New database migrations and production flags are external state changes. Each slice ends with an explicit owner activation checkpoint after code review, local/CI proof and migration dry-run evidence. The checkpoint names the exact migrations, flags, rollback and affected score rows; no activation is inferred from implementation authorization.

- Before those owner checkpoints are approved and observed, new flagged rows remain at most `qualified`. The maximum planned pre-activation score is approximately **85.05%**.
- The **93.3%** claim is post-activation only: migrations are observed in the production ledger, required flags are observed live, production routes return the expected capability projection, and the applicable Reticle/device proof is rerun against that state.
- If the owner declines or postpones any activation, the program reports the computed pre-activation score and does not relabel source-complete rows as shipped.

## Confirmed assumptions and evidence

- `origin/main` at plan start is `7ce2da37002155bae4a1a333748564422631c218`.
- Music creation, editing, publication, playlists, discovery, Beats, piano roll, mixer/effects/automation, recording, external MIDI source, mixdown/export and native adaptive layouts are present in source. Evidence: `lib/musicBackend.js`, `app/veyrnox/_components/music/`, `apps/mobile/src/app/(app)/music/`, `apps/mobile/src/app/(app)/beats/`, and `docs/mobile/MUSIC-BEATS-WEB-MOBILE-GAP-2026-11-22.md`.
- Native Beats qualification, RevenueCat/App Store sandbox checks, real hardware MIDI, mic interruption/latency and signed external-audio fidelity remain release work and cannot close on simulator evidence. Evidence: `docs/mobile/MOBILE-PARITY-EXECUTION-2026-11-21.md` and the Beats gap matrix.
- PR #2665 contains useful Swift 6 and language-startup fixes but is conflicting and its mobile CI fails two tests: the app-version expectation is stale and the signed Music-listen privacy test no longer observes the expected direction slot.
- Suno's current comparison edge includes Studio 2.0 chat, MIDI/synth/plugin/automation depth, advanced stem separation, multimodal v6 creation, Albums, Daily Song Challenge and Visuals. Sources: `https://suno.com/release-notes`, `https://suno.com/blog/studio-2`, and `https://help.suno.com/en/articles/13925185`.
- Crun Suno supply is built dark and must remain dark until the owner obtains written resale/privacy terms and approves a paid probe. Evidence: `docs/adr/0376-crun-suno-music-supplier.md` and `docs/runbooks/crun-suno-music-activation.md`.
- The root checkout is heavily modified and is not a safe build surface. This program uses a source-only worktree and reuses `/Users/aljobson/Documents/GitHub/Veyrnox.ai/.claude/worktrees/veyrnox-mobile-app-f52c2f/apps/mobile` for native dependencies/builds after confirming lockfile compatibility.

## Delivery sequence

### Slice 0: authoritative scorecard and release blocker

- Add the machine-readable parity inventory. Every row has a stable id, area, within-area weight, Suno evidence date/source, Veyrnox evidence, production route/capability, required proof class and status. Encode the status-credit formula above, derive the 69.5 baseline from rows, assert each area's row weights total 100, and make the drift test recompute area and weighted totals.
- Enumerate the static Music flag inventory from `LEGACY_FLAGS` plus the explicit `musicRuntimeFlag` allowlist. Add named default-off `albums`, `inspiration`, `studioChat`, `dailyChallenge` and `persistentQueue` flags to that inventory and the mobile capability projection, with tests. Freeze the many-to-one mapping above, exempt only `ui`, `schema` and `dispatch`, and fail when a flag is neither mapped nor exempt. Do not pretend deployment environment values are statically knowable.
- Port PR #2665's still-needed Swift fixes and language-startup correction onto current main, resolve the two failing tests, and close/supersede the conflicting PR.
- Diagnose the failing fal song route with existing read-only logs, stored typed failure classes and configuration evidence. Fix a repository-owned defect when one is identified and safely testable. Keep `create.production-route-health` qualified until a successful production route probe exists; do not run the Crun paid probe or hide an external/provider failure to raise the score.
- Run targeted mobile tests, the full mobile suite through `with-build-slot`, local Xcode simulator build with two jobs, install and launch on simulator, then run the Music smoke journey.
- Do not bump the app version merely to close tests. Derive the OTA runtime test from the release metadata source of truth. Because `runtimeVersion` follows `appVersion`, any later version bump must be paired with an explicitly authorized store build and must state that older installed binaries will not receive that runtime's OTA updates.

### Slice 1: Albums and releases

- Add database tables/RPCs for album draft, ordered track membership, publication state, public lookup and playlist conversion. Use user-derived ownership in RPCs; never accept a caller-supplied owner id.
- Add bounded, exact-key API contracts and replay-safe publication operations.
- Album publish must require an active, `status='published'` `music_publications` row for every included active song; it cannot publish a song implicitly or bypass its rights attestation. Public album, discovery and profile RPCs use `_for_viewer` variants and the existing private visibility/block boundary. Takedown, trash, sibling blocking and creator/viewer blocks are tested after album publication.
- Album artwork is selected from the creator's existing owned Library images, matching the Craft Anything APK evidence for SUNO's album draft flow. Only assets already admitted by the upload/generation boundary and marked `contentScan='clean'` are selectable or publishable; no raw or pending artwork becomes public. A dedicated direct artwork-upload path is deliberately out of this slice rather than implied. Public album metadata gains an album report/moderation path.
- Playlist conversion excludes trashed or unpublished songs with an explicit result notice and preserves the playlist. It does not assume playlists already have artwork.
- Classify every new album table in the account-deletion guard, privacy export and deletion scripts. Add retention and purge tests so new foreign keys cannot silently block account deletion.
- Add web album library/detail/public routes and native album list/editor/public screens.
- Reuse song cards and playlist interaction patterns where behavior matches; do not alias album lifecycle to playlist lifecycle.
- Owner activation checkpoint: review the exact album migrations, `albums` flag, rollback and moderation readiness; apply/enable only with explicit approval, then rerun public/filtering proofs.

### Slice 2: reviewed multimodal inspiration

- Reuse the owned upload admission, `contentScan`/CSAM escalation, media inspection and the exact existing vision/transcription boundaries identified during implementation. No attachment reaches inference before scan success. Introduce no new paid provider without a price/quote path and sub-processor disclosure.
- Brief generation is an explicitly free, account-rate-limited assist in this program: one cached brief per immutable attachment hash plus a bounded daily per-account quota. Retries reuse the cached result; quota exhaustion is honest and does not spend Music-generation credits. If existing provider economics cannot support that contract, move the assist behind a separate quote instead of shipping unmetered inference.
- Convert attachment content to an editable brief before the Music quote. The user must see and approve the exact brief that enters the immutable attempt snapshot.
- Validate the reviewed brief against the selected draft's immutable `provider_contract` limits. If the active contract changes, return `CONTRACT_STALE` and require review again; do not truncate silently.
- Support image and voice memo first. Add video only through bounded sampled frames plus extracted audio after the source contract is proved. Audio loops remain references, not automatic training material.
- Add web/iOS attachment pickers, clear provenance/rights copy, removal, retry and account-switch recovery.
- Define attachment retention, privacy-export inclusion and deletion/purge behavior, and test each lifecycle.
- Owner activation checkpoint: review the exact attachment/brief migrations, `inspiration` flag, quota/cost evidence, sub-processor disclosure and rollback; apply/enable only with explicit approval.

### Slice 3: Studio conversational actions

- Add a pure parser/planner whose typed actions are read-only project questions and supported deterministic local editor operations. The parser takes capability state and cannot emit gated actions.
- Present a reviewable action plan and price before any paid operation; reuse existing quote, confirm, idempotency and ambiguous-attempt recovery.
- Add `studioChat` to the static flag inventory and mobile projection, default off. When `magicBar` is false, prove the planner cannot emit generate, split, target-stem, extend, replace or any other action assigned to Magic Bar. Generative chat requires both flags and an owner rollout decision.
- Never synthesize executable plugins from arbitrary text. A later audited DSP graph format may be proposed separately.
- Add web and native conversational surfaces with history local to the project and no hidden activation of dark flags.
- Owner activation checkpoint: enable `studioChat` only for read-only/local actions after parser and UI proof. Generative chat remains unavailable unless a separate owner decision enables `magicBar`; that dark state does not block the planned qualified target for the generative-chat row.

### Slice 4: daily challenge, persistent queue and public discovery

- Add a deterministic server-owned daily challenge feed keyed to UTC, matching the daily check-in boundary, with locale-ready copy and no reward economics. Test DST transitions and both sides of the international date line.
- Add web/iOS challenge entry and route it into the normal Create draft.
- Extend the existing web `MusicQueueProvider` and mobile player. Keep the shipped public-slug queue on its current `rails` gate. Introduce one versioned account-keyed schema with distinct `public_slug` and `owned_asset` entries; migrate only safe public slugs from `veyrnox_music_queue_v1`, purge owned entries on sign-out/account change, and reuse the mobile refresh-before-TTL path. `persistentQueue` gates only owned-asset persistence and cross-Audio handoff. Test that disabling it leaves existing public-slug playback unchanged.
- Classify any challenge/queue tables in privacy export, retention and account-deletion tests. Prefer no durable server queue table unless cross-device continuity is an explicit later requirement.
- Add public album discovery and creator-profile album shelves.
- Extend the existing Veyrnox MCP with Music estimate, create, status and playlist tools. Reuse the repository's existing MCP trust model: the connector presents the exact quote, asks the user, and then sends `user_approved: true` with the exact `confirmed_credits` and idempotency key. The Music schema additionally requires draft identity, immutable `provider_contract`, `CONTRACT_STALE`/`QUOTE_STALE` handling and Music rights attestation. Add transport-level tests through the real MCP handler.
- Qualify mobile social polish and capability-enabled discovery/ranking through their existing block, report and viewer-filtered contracts so their target rows can move from qualified to shipped.
- Owner activation checkpoint: review and explicitly enable `dailyChallenge`, the owned-entry `persistentQueue`, and any still-off `labs`/`ranking` dependencies after their migrations and rollback are proved. Existing public-slug queue behavior remains on `rails` throughout.

### Slice 5: qualification and score closeout

- Run the affected root and mobile unit/contract suites and the full mobile suite through `with-build-slot` with a small worker count.
- Use Reticle for each changed web journey: album create/publish/public view, inspiration-to-reviewed-brief, Studio action review, daily challenge handoff and persistent player continuity. Only `verified: "yes"` counts.
- Use the consolidated iPhone 17 Pro simulator for navigation, layout, deterministic state and accessibility-contract journeys. Cover portrait/landscape, keyboard, RTL, XXL text, VoiceOver labels/order, offline/retry and account switching. Require a connected/trusted physical iPhone for mic interruption/latency, live/exported audio fidelity/dropout, external USB/Bluetooth MIDI/hot-plug and RevenueCat/App Store sandbox rows; leave those rows `qualified` or `externally_blocked` if hardware proof is absent.
- Build the final iOS image locally with Xcode. TestFlight submission is a separate external publication step and requires explicit authorization at that time.
- Recalculate the frozen rubric and publish evidence for every claimed shipped row.

## Key decisions and trade-offs

- Target 93% rather than a false 100%. Suno-only provider quality, its proprietary social graph, custom plugin generation, and externally blocked supplier/legal actions cannot be honestly cloned by source work alone.
- Build first-party outcomes on Veyrnox providers and shared contracts; do not integrate or imitate Suno's private implementation.
- Prefer several squash-merged PRs over one cross-cutting PR. Each slice is independently reversible and verified before the next.
- Keep server capability flags authoritative. Client UI cannot activate a dark backend.
- Do not run migrations or paid provider probes during implementation. Generate and test migrations locally; production application remains an explicit owner operation.
- A scorecard row is deployment-aware: code plus tests is not shipped while its mapped required production capability is off. Provider availability is scored once through the three dedicated health rows rather than double-penalizing every feature-contract/UI row.

## Non-goals

- Claiming equal or superior generated-audio quality without blind listening tests.
- Enabling Crun Suno, paid probes, production migrations, TestFlight submission or App Store release without the required explicit approvals.
- Simultaneous collaborative Beat editing when neither current product has that baseline.
- Arbitrary executable plugin generation from model output.
- Copying Suno branding, proprietary assets or private APIs.

## Verification contract

- Inventory/drift: `node --test tests/musicParityInventory.test.mjs`; it verifies row weights, status credits, the 69.5 baseline fixture, arithmetic and mapped/exempt coverage of the static runtime-flag inventory.
- Each root slice: exact affected `node --test` files plus `git diff --check`.
- Mobile targeted: run the exact affected Jest files from `apps/mobile`.
- Mobile full: `~/.local/bin/with-build-slot npm test -- --runInBand` from `apps/mobile`.
- Mobile typecheck: `~/.local/bin/with-build-slot npm run typecheck` from `apps/mobile`.
- Native build: first prove the canonical checkout is clean, not owned by another active task, and lockfile-compatible. Switch that checkout to the exact reviewed commit without overwriting work; if it is dirty or active, stop and leave native proof pending. Record the source commit and `git rev-parse HEAD`, plus a deterministic `git ls-tree` hash for `apps/mobile`, and fail the evidence step if they differ. Then build in the consolidated environment with `xcodebuild -jobs 2`, install and launch with `xcrun simctl`.
- Web UI: the repository's existing dev command, one Reticle session, declared consequences and exact end states; include the final Reticle result blocks.
- Native UI: deterministic simulator walkthroughs and screenshots for each slice; device checks record exact build commit and simulator/device identifier.
- Claudex: Claude reviews this exact plan before code, then inspects each implementation batch against the approved plan in a fresh session. Codex owns dispositions and reruns affected checks after fixes.

## Remaining risks

- The local provider-backed Music path may still be operationally unavailable even when UI/source parity is high; route health must be shown separately from feature breadth.
- Multimodal brief generation can create privacy and rights risk if attachments are retained longer than necessary; the implementation needs explicit lifecycle tests.
- Albums add a public publication surface and require moderation/reporting coverage, not only CRUD.
- Persistent queues are vulnerable to account and signed-URL leakage unless identifiers and refresh boundaries are kept separate.
- Native audio fidelity and hardware behavior cannot be established by Jest or simulator-only evidence.
