# Music parity closeout plan

Date: 2026-11-23

## Goal

Raise Veyrnox Audio/Music from an evidence-corrected 67.0% iOS/backend product-capability baseline toward at least 93% on shipped, user-visible iPhone outcomes, while preserving Veyrnox's own provider, rights, credit, privacy and native-product boundaries.

This target is feature parity, not a claim that ACE-Step or any standby supplier has the same subjective output quality as Suno's current models. Provider quality requires a separate blind listening benchmark.

## Observable acceptance criteria

1. One checked-in scorecard maps each current Suno Audio/Music outcome to Veyrnox iOS/iPhone and backend evidence, a production gate, an immutable row weight within its area, and one of: shipped, qualified, intentionally different, externally blocked or missing. Veyrnox's current application delivery scope is iOS/iPhone only: Android is excluded, and existing web source is supporting implementation evidence rather than release proof. The checked-in rows derive the immutable 67.0% iOS-only baseline and each dated current/final score. A test fails when a static Music capability is neither mapped to a frozen row nor explicitly exempt as infrastructure, row weights in an area do not sum to 100, the weighted total is miscomputed, or a claimed shipped/qualified row loses its row-specific native route/evidence. Backend-only ecosystem rows must declare a backend route explicitly.
2. The current iOS source builds locally through Xcode on the consolidated native environment, installs on the iPhone 17 Pro simulator, and completes a deterministic Music smoke journey. The existing Swift 6 fixes from PR #2665 are rebased or ported onto current `main`; its stale OTA-version test and language-direction regression are corrected rather than skipped. The connected physical iPhone must be trusted and complete the hardware/audio/App Store sandbox proof package before the closeout may claim 93%; if it is unavailable, those rows remain qualified or missing and the lower score is reported.
3. Music Albums are first-class, owner-fenced releases rather than renamed playlists: a creator can create a draft album, order owned songs, add title/description/scanned artwork metadata, publish/unpublish it, convert an existing playlist without destroying that playlist, report a public album, and view a block-filtered public album on iPhone. Publication remains idempotent and includes only active songs with an independently published, non-blocked `music_publications` row and its rights attestation. Later song takedown, trash or viewer block removes the affected public track and artwork without leaking its asset. Account deletion remains blocked by existing Music content until that content is explicitly removed; removed album/song rows and mutation receipts are scrubbed/classified in the deletion and privacy-export paths.
4. Create accepts multimodal inspiration without silently changing the paid generation contract: an owned image, short video, voice memo or audio loop can be attached; the system produces an editable textual brief; the user reviews that brief before quote/confirm; rights declarations, size/duration limits, account fencing and deletion are explicit. The immutable generation snapshot stores the reviewed brief and attachment provenance, not an opaque mutable reference.
5. Studio offers a capability-gated conversational action surface for read-only project questions and deterministic local editor commands. While `magicBar` is false, its planner cannot emit generation, replacement or other Magic Bar-equivalent actions. Generative conversational actions require `magicBar` as well as the new `studioChat` capability and reuse existing quote/idempotency/recovery-safe operations. Unsupported plugin design, provider-only synthesis and dark runtime capabilities return an honest explanation. `magicBar`, `beatCloud`, `beatLibrarySave` and `beatV5Writes` remain off until their server capabilities are enabled.
6. Community parity includes a capability-gated daily song challenge and public album discovery. Challenge prompts are server-owned, date/time-zone deterministic, optional and reusable; participation never bypasses the normal quote/confirm path. No gamified credit reward is introduced without a separate economic decision.
7. Audio continuity extends the existing iOS Music player rather than creating a second queue: Music, Speech, Dialogue and the audio shelf can hand typed public-slug or owned-asset entries to it. The versioned storage key is account-scoped and purged on sign-out/account change. Expired URLs are refreshed through the existing mobile TTL boundary; deleted assets recover safely. Playback state never stores bearer URLs in durable client storage.
8. The final score is recalculated from the checked-in row rubric. `shipped` earns 1, `qualified` earns 0.5, `missing` and `externally_blocked` earn 0, and `intentionally_different` earns 1 only when the same user outcome is proved; otherwise it earns 0. Each area's row weights sum to 100, then area results receive the fixed product weights below. Provider health is scored only in `create.production-route-health`, `edit.cross-provider-format-fidelity` and `ios.release-build-route-health`; other rows measure feature contracts/UI and cite those health rows rather than being downgraded again. Simulator proof closes navigation, layout, deterministic state and accessibility-contract rows only. Physical hardware is mandatory for mic interruption/latency, audio fidelity/dropout, external MIDI/hot-plug and RevenueCat/App Store sandbox rows. Source-only and externally blocked rows are reported separately; scores and row weights cannot change after Slice 0.

## Fixed rubric

| Area | Weight | Current estimate | Target |
| --- | ---: | ---: | ---: |
| Creation and model controls | 25 | 70 | 90 planned; 80 currently evidenced |
| Song editing, stems, covers and extensions | 20 | 72.5 | 85 |
| Beats / generative DAW | 20 | 62.5 | 97.5 |
| Library, albums and discovery | 15 | 75 | 100 |
| Community and ecosystem | 10 | 60 | 100 |
| Production-ready iOS experience | 10 | 52.5 | 93 |
| Weighted total | 100 | 67.0 | 93.3 planned; 90.8 currently evidenced |

The eventual target arithmetic is `(25×90 + 20×85 + 20×97.5 + 15×100 + 10×100 + 10×93) / 100 = 93.3`. The iOS-only baseline arithmetic is `(25×70 + 20×72.5 + 20×62.5 + 15×75 + 10×60 + 10×52.5) / 100 = 67.0`. The earlier 69.5 baseline credited a web-only Lyricist profile; the owner's iOS-only scope correction removes those 2.5 weighted points until the same private reusable creative-direction outcome exists on iPhone. The machine-readable target currently computes 90.8 because target `intentionally_different` credit is also withheld without native outcome evidence. Row weights remain frozen; only evidence status changed. Subjective audio quality is excluded and reported separately.

Status update (2026-11-24): the default-off daily-challenge feed and editable iOS Create handoff now qualify `create.daily-challenge` at half credit from UTC, entitlement and source-contract evidence. The current inventory is Creation 72.5 and weighted total 67.625. This does not rewrite the frozen 67.0 iOS baseline above, activate the flag, or claim the required iPhone simulator proof; challenge participation and discovery-shelf rows remain missing. The score and row tables below are the immutable pre-implementation baseline; each row's separate `baseline` field in `lib/musicParityInventory.js` mechanically preserves it while `current` records dated progress.

Status update (2026-11-24, Studio actions): the shared deterministic planner and default-off iOS surface qualify both Studio chat rows at half credit. It supports bounded read-only questions and review-before-apply local tempo, mute, solo, view and pattern actions; the dual gate proves generation, stem, replacement, arbitrary-code and plugin intents never become executable local operations. Current DAW is 67.5 and the weighted total is 68.625. The flag remains off, phone Magic Bar remains hard-disabled, and no iPhone simulator proof is claimed, so local actions are not `shipped` and generative/plugin behavior remains excluded.

Status update (2026-11-24, Music MCP): the OAuth connector now exposes the owned Custom Music draft, exact quote and explicit-confirmation generation path, terminal two-candidate status with signed audio resources, and bounded playlist list/create/replace operations. Transport tests exercise the real MCP handler, trusted identity fence, no-charge approval refusal, frozen-credit guard, signed ready asset, mixed terminal candidates and the 75/76 playlist boundary. `community.music-mcp` is therefore shipped as an explicitly backend-routed ecosystem row, Community is 65 and the weighted total is 69.125. The connector omits the daily allowance capability, does not expose draft writes, and activates no runtime flag, provider spend, migration or production release by itself.

Status update (2026-11-24, persistent listening queue): the default-off native queue uses a versioned identifier-only contract for public slugs and account-fenced owned job assets. Native uses `userDocStorage`, synchronously disposes on owner change, fences late reads/writes and coordinates audio focus across queue, Music, public playback and inline audio. Focused storage/UI source checks qualify `library.account-fenced-audio-queue`; exact-build iPhone playback is still missing, so the row is not shipped. Library is 77.5 and the weighted total is 69.5. No flag, provider call, migration or release was activated.

Status update (2026-11-24, Albums): the already merged, default-off album package now has deletion-receipt scrubbing, serialized idempotency keys and authenticated viewer-filtered artwork resolution. Its backend contracts and native album list/editor/public routes qualify `library.albums-releases`, `community.public-albums` and `community.album-profile-shelves` at half credit. Current Library is 82.5, Community is 72.5 and the weighted total is 71.0. The `albums` flag and migration remain inactive, and no exact-build iPhone journey is claimed, so none of the three rows is shipped.

### Frozen row rubric

Status credits are `shipped=1`, `qualified=0.5`, `missing=0`, `externally_blocked=0`, and `intentionally_different=1` only when the same outcome is proved. Weights sum to 100 inside each area. `Target` is the planned closeout status; exceeding it may raise an area above its table minimum, but falling below it cannot be hidden by changing weights.

#### Creation and model controls — current 70, target 90 planned (80 currently evidenced)

| Stable row | Weight | Current | Target | Required proof |
| --- | ---: | --- | --- | --- |
| `create.simple-custom` | 15 | shipped | shipped | iPhone simulator |
| `create.advanced-musical-controls` | 15 | shipped | shipped | contract + iPhone simulator |
| `create.lyrics-instrumental` | 10 | shipped | shipped | contract + iPhone simulator |
| `create.quote-rights-recovery` | 10 | shipped | shipped | contract |
| `create.audio-reference-input` | 10 | shipped | shipped | contract + UI |
| `create.models-personalization` | 10 | missing | intentionally_different | native iPhone outcome evidence required |
| `create.production-route-health` | 8 | qualified | qualified | production route probe |
| `create.native-qualification` | 12 | qualified | qualified | simulator plus physical audio proof where applicable |
| `create.multimodal-inspiration` | 5 | missing | shipped | scan/quota/contract + iPhone simulator |
| `create.daily-challenge` | 5 | missing | shipped | UTC contract + iPhone simulator |

The web-only Lyricist profile in `app/veyrnox/_components/music/MusicLyricistProfiles.jsx` is supporting source but no longer earns app parity credit. `create.models-personalization` remains missing until an iPhone surface proves reusable private creative direction without claiming a trained custom model.

Currently evidenced target calculation: `60 shipped + 0.5×8 route qualified + 5 inspiration shipped + 5 challenge shipped + 0.5×12 native qualified = 80`. A native same-outcome personalization surface restores the planned 90. Restoring the route can raise the result later, but this plan does not depend on an owner-approved paid probe.

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
| `daw.conversational-local-actions` | 5 | missing | shipped | gate/parser + iPhone simulator |
| `daw.generative-chat-and-plugins` | 5 | missing | qualified | dual gate; plugin generation excluded |

Current calculation: `35 shipped + 0.5×55 qualified = 62.5`. Target calculation: all physical/native qualified rows and local conversational actions ship; generative chat remains qualified, producing `97.5`.

#### Library, albums and discovery — current 75, target 100

| Stable row | Weight | Current | Target | Required proof |
| --- | ---: | --- | --- | --- |
| `library.songs-history-hooks` | 15 | shipped | shipped | contract + UI |
| `library.playlists-workspaces` | 15 | shipped | shipped | contract + UI |
| `library.search-sort-filters` | 10 | shipped | shipped | iPhone simulator |
| `library.discovery-profiles` | 10 | shipped | shipped | block-filtered contract + UI |
| `library.publication-share` | 10 | shipped | shipped | moderation contract + UI |
| `library.queue-public-slugs` | 5 | shipped | shipped | existing contract |
| `library.native-signed-assets` | 10 | qualified | shipped | physical playback/account fence |
| `library.discovery-native-polish` | 10 | qualified | shipped | simulator + accessibility |
| `library.albums-releases` | 10 | missing | shipped | database/moderation + iPhone simulator |
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
| `community.public-albums` | 10 | missing | shipped | moderation + iPhone simulator |
| `community.daily-challenge-participation` | 5 | missing | shipped | UTC contract + UI |
| `community.album-profile-shelves` | 5 | missing | shipped | block-filtered contract + UI |
| `community.challenge-discovery-shelf` | 5 | missing | shipped | iPhone simulator |

Target calculation: all remaining missing rows and the two qualified rows ship, producing `100`. The frozen table preserves Music MCP as missing at baseline; its dated current row is credited by the later bounded connector contract and real-handler transport proof, without implying production provider or daily-allowance activation.

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
| Native private creative direction | `create.models-personalization` | 2.50 points |

Production route health is intentionally only qualified in the target and therefore contributes no hidden optimistic delta. Each shared package has one canonical evidence bundle referenced by every affected row.

The physical/device package exposure is 11.70 weighted product points: Editing fidelity rows 2.50, DAW audio/MIDI rows 4.50, Library signed assets 0.75, iOS signed assets/audio/mic/MIDI/RevenueCat 2.55, and DAW/iOS device accessibility rows 1.40. The planned 93.3 target also requires the native personalization outcome; until then the machine target is 90.8. Every shared package must earn its planned status, or the lower computed score is reported without a 93% claim.

### Static capability mapping

The drift test uses an explicit many-to-one map rather than inventing one weighted row per flag. `ui`, `schema` and `dispatch` are infrastructure prerequisites and are explicitly exempt from product-row coverage. All other current and planned names must map as follows:

| Flags | Disposition | Frozen row(s) |
| --- | --- | --- |
| `library`, `libraryTabs` | required | both `library.songs-history-hooks` and `library.search-sort-filters` |
| `sources` | required | `create.audio-reference-input` |
| `references` | dark evidence only; not required for shipped audio input | `create.audio-reference-input` |
| `generation` | required health boundary | `create.production-route-health` |
| `distribution`, `publication` | required | `library.publication-share` |
| `playlists`, `collaboration` | required | `library.playlists-workspaces` |
| `editing`, `reverse`, `cover`, `reuse`, `remix`, `stems`, `targetStems`, `trackAdd`, `extend`, `replace`, `addSection`, `lyrics` | required where the mapped row is shipped | the `edit.*` rows |
| `longSongs` | dark evidence only; absent production flag does not invalidate broad section editing | `edit.sections-extend-crop` |
| `studio`, `beatEditor`, `beatAi` | required where the mapped row is shipped | the `daw.*` rows |
| `magicBar`, `beatCloud`, `beatLibrarySave`, `beatV5Writes`, `blocks` | dark evidence only; a false value does not invalidate unrelated shipped rows | `daw.generative-chat-and-plugins` and the applicable gated evidence |
| `labs`, `ranking`, `bestOf` | required for ranking/best-of rows | `community.discovery-ranking` |
| `reactions`, `follows`, `comments`, `notifications`, `plays`, `songReports`, `rails` | required for their mapped social outcome | the `community.*` public/social rows |
| `albums` | required after owner activation | `library.albums-releases`, `community.public-albums`, `community.album-profile-shelves` |
| `inspiration` | required after owner activation | `create.multimodal-inspiration` |
| `studioChat` | required after owner activation; generative actions also require `magicBar` | `daw.conversational-local-actions`, `daw.generative-chat-and-plugins` |
| `dailyChallenge` | required after owner activation | `create.daily-challenge`, the `community.*challenge*` rows |
| `persistentQueue` | required only for owned-asset persistence | `library.account-fenced-audio-queue` only |
| `dailyCredits` | dark evidence only; no giveaway is activated | `create.quote-rights-recovery` |

The test fails when a flag is neither mapped nor explicitly exempt, or when a row claims shipped while a mapping marked required is off. Dark-evidence mappings are recorded but do not invalidate unrelated shipped outcomes. Adding a flag does not silently add or reweight a score row.

### Pre-activation and post-activation claims

New database migrations and production flags are external state changes. Each slice ends with an explicit owner activation checkpoint after code review, local/CI proof and migration dry-run evidence. The checkpoint names the exact migrations, flags, rollback and affected score rows; no activation is inferred from implementation authorization.

- Before those owner checkpoints are approved and observed, new flagged rows remain at most `qualified`. With the native personalization row still unproved, the inventory mechanically computes **86.675%**; after that outcome is implemented and proved, the planned pre-activation ceiling is **89.175%**. The checked-in production snapshot already observes `labs` and `ranking` true, so no additional ranking penalty is applied.
- The **93.3%** claim is post-activation only: migrations are observed in the production ledger, required flags are observed live, production routes return the expected capability projection, and the applicable exact-build iPhone proof is rerun against that state.
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

- Add the machine-readable parity inventory. Every row has a stable id, area, within-area weight, immutable baseline, dated current status, target, row-specific Veyrnox evidence, iOS/backend route, required proof class and any non-Music production gates. Encode the status-credit formula above, derive the 67.0 iOS baseline from rows, assert each area's row weights total 100, require native evidence for current shipped/qualified app rows, check `PERSONAS_ENABLED` for personalization, and make the drift test recompute baseline, current, target and pre-activation totals.
- Enumerate the static Music flag inventory from `LEGACY_FLAGS` plus the explicit `musicRuntimeFlag` allowlist. Add named default-off `albums`, `inspiration`, `studioChat`, `dailyChallenge` and `persistentQueue` flags to that inventory and the mobile capability projection, with tests. Freeze the many-to-one mapping above, exempt only `ui`, `schema` and `dispatch`, and fail when a flag is neither mapped nor exempt. Check in the dated production `MUSIC_RUNTIME_FLAGS` snapshot, assert it still matches `wrangler.jsonc`, and reject a `shipped` row whose required production flag is false; dark mappings are evidence only.
- Port PR #2665's still-needed Swift fixes and language-startup correction onto current main, resolve the two failing tests, and close/supersede the conflicting PR.
- Diagnose the failing fal song route with existing read-only logs, stored typed failure classes and configuration evidence. Fix a repository-owned defect when one is identified and safely testable. Keep `create.production-route-health` qualified until a successful production route probe exists; do not run the Crun paid probe or hide an external/provider failure to raise the score.
- Run targeted mobile tests, the full mobile suite through `with-build-slot`, local Xcode simulator build with two jobs, install and launch on simulator, then run the Music smoke journey.
- Do not bump the app version merely to close tests. Derive the OTA runtime test from the release metadata source of truth. Because `runtimeVersion` follows `appVersion`, any later version bump must be paired with an explicitly authorized store build and must state that older installed binaries will not receive that runtime's OTA updates.

### Slice 1: Albums and releases

- Add database tables/RPCs for album draft, ordered track membership, publication state, public lookup and playlist conversion. Use user-derived ownership in RPCs; never accept a caller-supplied owner id.
- Add bounded, exact-key API contracts and replay-safe publication operations.
- Serialize album mutations by owner and idempotency key before replay lookup. Deletion uses a minimal request receipt and scrubs earlier mutation request/result payloads so former title, description, artwork and track metadata do not persist in replay storage.
- Album publish must require an active, `status='published'` `music_publications` row for every included active song; it cannot publish a song implicitly or bypass its rights attestation. Public album, discovery and profile RPCs use `_for_viewer` variants and the existing private visibility/block boundary. Takedown, trash, sibling blocking and creator/viewer blocks are tested after album publication.
- Album artwork is selected from the creator's existing owned Library images, matching the Craft Anything APK evidence for SUNO's album draft flow. Only assets already admitted by the upload/generation boundary and marked `contentScan='clean'` are selectable or publishable; no raw or pending artwork becomes public. A dedicated direct artwork-upload path is deliberately out of this slice rather than implied. Public album metadata gains an album report/moderation path.
- Public artwork resolution requires that the album still has a publicly readable active/published track set. The viewer-specific resolver also applies the creator/viewer block boundary and returns `NOT_FOUND` for a blocked viewer.
- Playlist conversion excludes trashed or unpublished songs with an explicit result notice and preserves the playlist. It does not assume playlists already have artwork.
- Classify every new album table in the account-deletion guard, privacy export and deletion scripts. Add retention and purge tests so new foreign keys cannot silently block account deletion.
- Keep the existing web album routes as supporting source only; the current delivery scope adds and qualifies native iOS album list/editor/public screens.
- Reuse song cards and playlist interaction patterns where behavior matches; do not alias album lifecycle to playlist lifecycle.
- Owner activation checkpoint: review the exact album migrations, `albums` flag, rollback and moderation readiness; apply/enable only with explicit approval, then rerun public/filtering proofs.

### Slice 2: native personalization and reviewed multimodal inspiration

- Add a native Music-to-Chat lyric-assistant handoff using the existing owned Lyricist profile/Chat-persona contract. It creates, selects, edits and removes private reusable creative direction without claiming a trained custom model or exposing a public persona. The profile applies only inside Chat; its instructions never enter the Music provider contract or paid generation snapshot.
- Fence every profile read/write and handoff to the current account, clear selection and cached profile state on sign-out/account change, and verify the existing Chat persona records in privacy export, deletion classification and purge tests. No profile or handoff may cross accounts or survive a completed deletion.
- The lyric assistant returns lyrics to an editable Music review step. Only the exact lyrics the user reviews and accepts enter the existing Music draft/attempt snapshot; this does not introduce a new paid-generation input field or bypass quote/`CONTRACT_STALE` validation.
- Add a focused native handoff contract test and an iPhone simulator journey that creates/selects a profile, returns lyrics from Chat, reviews them into a Music draft, switches accounts and proves the profile/handoff is absent. Only after those paths exist may `apps/mobile/` source/test paths be added to `outcomeEvidence` and the row earn `intentionally_different` credit. `PERSONAS_ENABLED` is a required non-Music production gate and must be observed true in the checked-in production snapshot before credit is allowed.

- Reuse the owned upload admission, `contentScan`/CSAM escalation, media inspection and the exact existing vision/transcription boundaries identified during implementation. No attachment reaches inference before scan success. Introduce no new paid provider without a price/quote path and sub-processor disclosure.
- Brief generation is an explicitly free, account-rate-limited assist in this program: one cached brief per immutable attachment hash plus a bounded daily per-account quota. Retries reuse the cached result; quota exhaustion is honest and does not spend Music-generation credits. If existing provider economics cannot support that contract, move the assist behind a separate quote instead of shipping unmetered inference.
- Convert attachment content to an editable brief before the Music quote. The user must see and approve the exact brief that enters the immutable attempt snapshot.
- Validate the reviewed brief against the selected draft's immutable `provider_contract` limits. If the active contract changes, return `CONTRACT_STALE` and require review again; do not truncate silently.
- Support image and voice memo first. Add video only through bounded sampled frames plus extracted audio after the source contract is proved. Audio loops remain references, not automatic training material.
- Add iOS attachment pickers, clear provenance/rights copy, removal, retry and account-switch recovery.
- Define attachment retention, privacy-export inclusion and deletion/purge behavior, and test each lifecycle.
- Owner activation checkpoint: review the exact attachment/brief migrations, `inspiration` flag, quota/cost evidence, sub-processor disclosure and rollback; apply/enable only with explicit approval.

### Slice 3: Studio conversational actions

- Add a pure parser/planner whose typed actions are read-only project questions and supported deterministic local editor operations. The parser takes capability state and cannot emit gated actions.
- Present a reviewable action plan and price before any paid operation; reuse existing quote, confirm, idempotency and ambiguous-attempt recovery.
- Add `studioChat` to the static flag inventory and mobile projection, default off. When `magicBar` is false, prove the planner cannot emit generate, split, target-stem, extend, replace or any other action assigned to Magic Bar. Generative chat requires both flags and an owner rollout decision.
- Never synthesize executable plugins from arbitrary text. A later audited DSP graph format may be proposed separately.
- Add the native iOS conversational surface with history local to the project and no hidden activation of dark flags.
- Owner activation checkpoint: enable `studioChat` only for read-only/local actions after parser and UI proof. Generative chat remains unavailable unless a separate owner decision enables `magicBar`; that dark state does not block the planned qualified target for the generative-chat row.

### Slice 4: daily challenge, persistent queue and public discovery

- Add a deterministic server-owned daily challenge feed keyed to UTC, matching the daily check-in boundary, with locale-ready copy and no reward economics. Test DST transitions and both sides of the international date line.
- Add iOS challenge entry and route it into the normal Create draft.
- Extend the existing iOS player. Keep public-slug playback on its current `rails` gate. The native versioned account-keyed schema distinguishes `public_slug` and `owned_asset` entries, purges owned entries on sign-out/account change, and reuses the mobile refresh-before-TTL path. `persistentQueue` gates only owned-asset persistence and cross-Audio handoff. Existing web queue work is supporting source only and is not part of this row's proof. Test that disabling the flag leaves iOS public-slug playback unchanged.
- Classify any challenge/queue tables in privacy export, retention and account-deletion tests. Prefer no durable server queue table unless cross-device continuity is an explicit later requirement.
- Add public album discovery and creator-profile album shelves.
- Extend the existing Veyrnox MCP with Music estimate, create, status and playlist tools. Reuse the repository's existing MCP trust model: the connector presents the exact quote, asks the user, and then sends `user_approved: true` with the exact `confirmed_credits` and idempotency key. The Music schema additionally requires draft identity, immutable `provider_contract`, `CONTRACT_STALE`/`QUOTE_STALE` handling and Music rights attestation. Add transport-level tests through the real MCP handler.
- Qualify mobile social polish and capability-enabled discovery/ranking through their existing block, report and viewer-filtered contracts so their target rows can move from qualified to shipped.
- Owner activation checkpoint: review and explicitly enable `dailyChallenge`, the owned-entry `persistentQueue`, and any still-off `labs`/`ranking` dependencies after their migrations and rollback are proved. Existing public-slug queue behavior remains on `rails` throughout.

### Slice 5: qualification and score closeout

- Run the affected root and mobile unit/contract suites and the full mobile suite through `with-build-slot` with a small worker count.
- Use deterministic iPhone simulator journeys for album create/publish/public view, native Lyricist-profile create/select/account-switch, inspiration-to-reviewed-brief, Studio action review, daily challenge handoff and persistent player continuity. Physical-device-only rows require the connected iPhone and cannot be promoted from simulator evidence.
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

- Inventory/drift: `node --test tests/musicParityInventory.test.mjs`; it verifies row-specific evidence paths, native evidence for credited app rows, row weights, status credits, the immutable 67.0 iOS baseline, dated current/target/pre-activation arithmetic, static flag coverage and the committed production capability snapshot.
- Each root slice: exact affected `node --test` files plus `git diff --check`.
- Mobile targeted: run the exact affected Jest files from `apps/mobile`.
- Mobile full: `~/.local/bin/with-build-slot npm test -- --runInBand` from `apps/mobile`.
- Mobile typecheck: `~/.local/bin/with-build-slot npm run typecheck` from `apps/mobile`.
- Native build: first prove the canonical checkout is clean, not owned by another active task, and lockfile-compatible. Switch that checkout to the exact reviewed commit without overwriting work; if it is dirty or active, stop and leave native proof pending. Record the source commit and `git rev-parse HEAD`, plus a deterministic `git ls-tree` hash for `apps/mobile`, and fail the evidence step if they differ. Then build in the consolidated environment with `xcodebuild -jobs 2`, install and launch with `xcrun simctl`.
- Native UI: deterministic simulator walkthroughs and screenshots for each slice; device checks record exact build commit and simulator/device identifier.
- Claudex: Claude reviews this exact plan before code, then inspects each implementation batch against the approved plan in a fresh session. Codex owns dispositions and reruns affected checks after fixes.

## Remaining risks

- The local provider-backed Music path may still be operationally unavailable even when UI/source parity is high; route health must be shown separately from feature breadth.
- Multimodal brief generation can create privacy and rights risk if attachments are retained longer than necessary; the implementation needs explicit lifecycle tests.
- Albums add a public publication surface and require moderation/reporting coverage, not only CRUD.
- Persistent queues are vulnerable to account and signed-URL leakage unless identifiers and refresh boundaries are kept separate.
- Native audio fidelity and hardware behavior cannot be established by Jest or simulator-only evidence.
