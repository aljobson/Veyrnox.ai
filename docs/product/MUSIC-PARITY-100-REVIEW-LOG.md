# Music parity closeout review log

## Run configuration

- Started: 2026-11-23
- Host/coordinator: Codex
- Requirements and plan: Codex
- Independent plan reviewer: Claude CLI
- Builder: Codex
- Final inspector: fresh Claude CLI session
- Plan: `docs/product/MUSIC-PARITY-100-PLAN.md`
- Maximum plan-review rounds: 5
- Maximum build-fix rounds: 2
- Maximum inspection rounds: 2
- Research: targeted official Suno documentation and repository evidence; no deep multi-agent research
- Implementation authorization: user said "get it close to 100"
- Inspection: on
- Requested reviewer/inspector model: CLI default (observed identity will be recorded from runner results when available)
- Pre-build commit: `7ce2da37002155bae4a1a333748564422631c218`

## Plan review rounds

### Round 1 — REVISE

- Runner result: `/private/tmp/claudex-music-parity-round1/claudex-1et2448q/result.json`
- Plan SHA-256: `5a9514c44b0116fc244ce32d2a9b577ee58d2f2896ee31e000f2261bfd4a189d`
- Claude CLI: `2.1.309`
- Observed model: `claude-opus-5-5`
- Session: `313b7d34-f0f0-4eda-bce3-b036d57fdcc8`

Full reviewer response:

```json
{
  "verdict": "REVISE",
  "summary": "The plan is well-bounded on providers, payments and dark flags, but it has several material defects. The frozen rubric cannot reach the stated 93% goal. The way scorecard rows turn into area percentages is undefined. It is unclear whether simulator evidence counts as native device proof. Albums ignore the existing per-song publication, takedown, block-filtering and account-deletion machinery. The Studio chat surface would functionally bypass the intentionally gated Magic Bar. Brief generation is paid inference that sits outside the quote and has no scanning. The persistent-queue slice ignores the existing public-slug, sessionStorage-only queue. New capability flags would be silently false under musicRuntimeFlag's allowlist. The native build could come from a different checkout than the reviewed commit.",
  "findings": [
    {
      "id": "R1",
      "severity": "high",
      "path": "docs/product/MUSIC-PARITY-100-PLAN.md",
      "evidence": "Fixed rubric targets: 25×94 + 20×94 + 20×92 + 15×95 + 10×88 + 10×92 = 9295, which is 92.95, not the 93.1 shown in the table. The goal says 'at least 93%', so hitting every area target still fails the goal. The rubric is 'frozen' and weights cannot change after implementation, so this cannot be fixed later.",
      "fix": "Correct the arithmetic before freezing. Either raise one or more area targets so the weighted total is at least 93.0, or state the goal as 92.95. Add a test that recomputes the weighted total from the checked-in rubric."
    },
    {
      "id": "R2",
      "severity": "high",
      "path": "docs/product/MUSIC-PARITY-100-PLAN.md",
      "evidence": "Criteria 1 and 8 say the score is 'recalculated from the checked-in rubric' using row statuses (shipped, qualified, intentionally different, externally blocked, missing). The rubric only has area-level percentage estimates. No formula maps row statuses or row weights to an area percentage. The current 77% baseline is also not derived from rows. A final score of '93' therefore cannot be computed deterministically and could be adjusted by choosing row granularity, which defeats the 'frozen' guarantee.",
      "fix": "In Slice 0, before any implementation, check in each row's weight within its area and the credit each status earns (for example shipped=1, qualified=0.5, intentionally different=excluded or 1, missing/blocked=0). Derive the 77 baseline from those rows, and make the drift test recompute both the baseline and the final score."
    },
    {
      "id": "R3",
      "severity": "high",
      "path": "docs/product/MUSIC-PARITY-100-PLAN.md",
      "evidence": "Criterion 8 counts a row as shipped after 'native device proof'. The verification contract uses the iPhone 17 Pro simulator for all native journeys and treats the physical device as optional. Remaining risks admit that native audio fidelity and hardware cannot be established by simulator-only evidence. The gap matrix rows for MIDI, mic recording, mixer and export require device qualification. The iOS area goes from 60 to 92 and Beats from 80 to 92 largely on this proof, so simulator evidence could inflate both.",
      "fix": "Define which rows can close on simulator proof and which need physical hardware. Rows that need hardware stay 'qualified' or 'externally blocked' without trusted-device evidence. Recompute whether 92 for iOS is reachable under that rule."
    },
    {
      "id": "R4",
      "severity": "high",
      "path": "packages/db/schema/supabase/0576_music_publish_respects_takedown.sql",
      "evidence": "Public songs exist only through music_publications. Each publication has its own rights attestation and slug, a 'blocked' takedown status with sibling propagation, and an active-song filter. The _for_viewer variants in 0570_music_user_blocks.sql apply viewer blocks. The album slice says publication 'preserves song rights/provenance' but never says that public album reads must include only tracks that are published, not blocked and active, or that they must use viewer block filtering. Failure scenario: a creator publishes an album containing a track that is private or later taken down, and the public album page or album discovery plays it, bypassing moderation.",
      "fix": "Require album publish to fail or require explicit per-track publication through music_publish_song, with its attestation, for every track. Public album, discovery and profile-shelf RPCs must join music_publications with status='published' and music_songs with status='active', and need _for_viewer variants using private.music_visible_tracks or music_actor_blocked. Add tests for a takedown after album publish, a trashed track and a blocked creator."
    },
    {
      "id": "R5",
      "severity": "medium",
      "path": "packages/db/schema/supabase/0465_music_playlists.sql",
      "evidence": "Playlists have no artwork column, yet Slice 1 says 'Reuse playlist artwork'. music_list_playlists joins music_songs without filtering s.status, so a playlist can hold trashed songs. Album artwork and album title/description are also new user-supplied public content with no named content-scan or report path.",
      "fix": "Treat album artwork as a new owned upload that goes through the existing upload admission and contentScan pipeline before it can be public. Define how playlist conversion handles trashed or unpublished songs. Extend song reports or add album reports, and put album moderation and reporting in criterion 3."
    },
    {
      "id": "R6",
      "severity": "medium",
      "path": "packages/db/schema/supabase/0490_music_account_deletion_guard.sql",
      "evidence": "account_deletion_blockers fails closed for any new public.music_* table with an FK to users. Its comment says classification tests require an explicit retention decision. The plan adds album, inspiration-attachment, challenge and possibly queue tables with no step for deletion, privacy export or retention classification. Without that, new album rows block account deletion, and multimodal attachments are missing from the export.",
      "fix": "Add a step to each schema slice: classify the new tables in the deletion guard tests, add them to privacy export and account-deletion scripts, and define attachment retention and purge, with tests for the lifecycle."
    },
    {
      "id": "R7",
      "severity": "high",
      "path": "docs/mobile/MUSIC-BEATS-WEB-MOBILE-GAP-2026-11-22.md",
      "evidence": "Magic Bar is the existing natural-language prompt that generates Beat loop layers through a quote and is intentionally off in production. Slice 3 adds a conversational surface under beatAi, which is enabled. That ships Magic Bar's function while magicBar remains off.",
      "fix": "Either make the Studio chat surface require magicBar or a new server flag that defaults off and needs an owner decision, or exclude every action Magic Bar gates from the chat action set. Add a test that the chat planner cannot emit gated actions while magicBar is false."
    },
    {
      "id": "R8",
      "severity": "medium",
      "path": "lib/musicRuntime.js",
      "evidence": "musicRuntimeFlag returns false for any name that is not in LEGACY_FLAGS and not one of beatV5Writes, beatAi, longSongs or blocks. The plan relies on capability-gated albums, inspiration, Studio chat, daily challenge and persistent queue but names no flags. A new flag read only through MUSIC_RUNTIME_FLAGS would be permanently false. Criterion 1 also has no static source of truth because production enablement is in deployment env.",
      "fix": "Name each new flag. Add it to LEGACY_FLAGS or the allowlist, plus the mobile capability projection, with default-off tests. Have the drift test enumerate the static flag inventory and require a scorecard row per flag."
    },
    {
      "id": "R9",
      "severity": "high",
      "path": "docs/product/MUSIC-PARITY-100-PLAN.md",
      "evidence": "Slice 2 generates the textual brief from the attachment before quote and confirm. That inference is paid compute outside any quote, so users can repeat it without limit. The plan also does not require uploads to pass contentScan or CSAM escalation before content goes to a model, or the brief to fit immutable provider_contract limits.",
      "fix": "Name the exact upload, vision and transcription boundaries. Decide whether brief generation is free and rate-limited per account or quoted, and add per-user quotas. Require the upload to pass admission and content scan before inference. Validate the reviewed brief against provider_contract limits, failing with CONTRACT_STALE on mismatch. Disclose sub-processors."
    },
    {
      "id": "R10",
      "severity": "medium",
      "path": "app/veyrnox/_components/music/MusicQueue.jsx",
      "evidence": "A web cross-page queue already exists. MusicQueueProvider stores public slugs only, uses sessionStorage key veyrnox_music_queue_v1, is not account-keyed, and is enabled by the rails flag. Mobile has components/music/MusicQueue.tsx and lib/music/player.ts, which keeps URLs ephemeral with a 12-minute refresh. Slice 4 risks two competing queues or putting owned job ids into the existing un-fenced key.",
      "fix": "Specify extending the existing providers. Version the storage key, key it by account, and purge it on sign-out or account change. Keep public slug items and owned asset-id items as distinct typed entries. Reuse the mobile player's refresh-before-TTL path. Define the gating flag."
    },
    {
      "id": "R11",
      "severity": "medium",
      "path": "docs/product/MUSIC-PARITY-100-PLAN.md",
      "evidence": "Native builds and installs run from a different checkout from this source worktree. The plan only confirms lockfile compatibility; it does not ensure that checkout's source equals the commit under review.",
      "fix": "Specify how source reaches the build checkout. Record both the source commit and a tree hash of apps/mobile in the build evidence, and fail if they differ."
    },
    {
      "id": "R12",
      "severity": "low",
      "path": "apps/mobile/app.json",
      "evidence": "runtimeVersion uses policy appVersion. Slice 0 allows bumping the app version once. That changes the OTA runtime, so new OTA updates no longer reach installed binaries until a new store build ships.",
      "fix": "Bump the version only together with an authorized store build, or state the OTA consequence explicitly and get owner approval for the bump."
    },
    {
      "id": "R13",
      "severity": "medium",
      "path": "docs/adr/0376-crun-suno-music-supplier.md",
      "evidence": "Every production ace-step song pair failed provider_submit_failed on 2026-11-22, the fal root cause is unconfirmed, and Crun is dark. The plan only says route health is shown separately; it does not stop rows whose end-to-end outcome is unavailable in production from counting as shipped.",
      "fix": "Add a rule to the scorecard: a row whose user outcome needs a provider route that currently fails in production is counted as externally blocked or qualified, not shipped. Report route health next to the score."
    },
    {
      "id": "R14",
      "severity": "low",
      "path": "docs/product/MUSIC-PARITY-100-PLAN.md",
      "evidence": "The daily challenge is date/time-zone deterministic without saying whose time zone. Per-user local days mean users see different prompts at the same moment, and at DST boundaries a day can be skipped or repeated.",
      "fix": "Define the challenge day explicitly, for example UTC matching daily_checkin, with tests across DST and the international date line."
    }
  ],
  "coverage": [
    "Plan text and review log",
    "Rubric arithmetic recomputed by hand",
    "Playlist schema and RPCs and lib/musicPlaylists.js",
    "Song lifecycle, publication/takedown, user blocks, account deletion guard",
    "Account-deletion and privacy-export scripts",
    "Runtime flags and backend flag gates",
    "Beats gap matrix and ADR-0376",
    "Web MusicQueue.jsx and mobile lib/music/player.ts URL handling",
    "apps/mobile/app.json version and runtimeVersion policy",
    "Existing upload, content-scan and vision module names"
  ],
  "limitations": [
    "PR #2665 and its failing CI could not be inspected because the reviewer had no network or gh access.",
    "External Suno sources were not fetched.",
    "Several repository-wide searches timed out, so some callers were only partly traced.",
    "The Crun activation runbook and mobile parity execution plan were not read.",
    "No tests, builds or simulator runs were executed; the review was read-only."
  ]
}
```

Host dispositions:

- R1 accepted: corrected the target to 93.15 and added an arithmetic test requirement.
- R2 accepted: defined immutable row weights and exact status credits, including the 77 baseline derivation.
- R3 accepted: split simulator-closable rows from physical-hardware-only rows and prevented score inflation.
- R4 accepted: required published/active song joins, viewer filtering and post-publication takedown/trash/block tests.
- R5 accepted: made artwork a scanned owned upload, added reports/moderation and defined playlist conversion exclusions.
- R6 accepted: added privacy export, account deletion, retention and purge classification to every schema slice.
- R7 accepted: prohibited Magic Bar-equivalent actions while `magicBar` is false and required dual gating for generative chat.
- R8 accepted: named five static default-off capabilities and required mobile projection/drift coverage.
- R9 accepted: defined scan-before-inference, cached/rate-limited free brief generation, contract-limit validation and disclosure.
- R10 accepted: extended the existing queue with a versioned typed/account-fenced schema and mobile TTL refresh.
- R11 accepted: required an exact clean build checkout, commit/tree-hash match and a fail-closed native evidence step.
- R12 accepted: removed the unconditional version bump and tied any bump to an authorized store build.
- R13 accepted: production provider health now limits a dependent row to qualified/externally blocked.
- R14 accepted: daily challenge uses UTC and includes boundary tests.

### Round 2 — REVISE

- Runner result: `/private/tmp/claudex-music-parity-round2/claudex-0oilum1g/result.json`
- Plan SHA-256: `8cd986c7046d9ae95a3a8ee82ac515ba911f30e2662589530052a209a75e7493`
- Observed model: `claude-opus-5-5`
- Resumed session: `313b7d34-f0f0-4eda-bce3-b036d57fdcc8`

Full reviewer response:

```json
{
  "verdict": "REVISE",
  "summary": "The revised rubric fixes the arithmetic: 25×94 + 20×94 + 20×92 + 15×95 + 10×88 + 10×94 = 9315, so the target total is 93.15 and clears the 93% goal. The current total computes to 76.75, which rounds to the stated 77. However, the margin now rests on raising Production-ready iOS from 92 to 94. That is the area where the plan admits simulator evidence cannot prove audio fidelity or hardware behaviour. If even one point of that iOS target cannot be proved on a trusted device, the total falls below 93. Every other finding from the previous review is unaffected by this change and still stands.",
  "findings": [
    {"id":"R1","severity":"low","path":"docs/product/MUSIC-PARITY-100-PLAN.md","evidence":"The target total is 93.15 and the current total is 76.75; the revised table and recomputation test still need to be in the reviewed plan.","fix":"Commit the revised table, state the rounding rule, and add the recomputation test."},
    {"id":"R3","severity":"high","path":"docs/product/MUSIC-PARITY-100-PLAN.md","evidence":"The 0.15-point margin depends on raising iOS to 94 even though simulator evidence cannot prove the hardware rows.","fix":"Define hardware rows and show the target is reachable, or move margin to areas controlled by Reticle."},
    {"id":"R2","severity":"high","path":"docs/product/MUSIC-PARITY-100-PLAN.md","evidence":"Area percentages still need to be derived from frozen scorecard rows and status credits.","fix":"Check row weights and status credits into the plan before implementation."},
    {"id":"R4","severity":"high","path":"packages/db/schema/supabase/0576_music_publish_respects_takedown.sql","evidence":"Album reads must use published/active songs and viewer block filtering.","fix":"Require per-track publication and filtered viewer RPCs with takedown/trash/block tests."},
    {"id":"R5","severity":"medium","path":"packages/db/schema/supabase/0465_music_playlists.sql","evidence":"Playlists have no artwork, can contain trashed songs, and album public content needs scan/report paths.","fix":"Scan artwork, define conversion exclusions, and add moderation/reporting."},
    {"id":"R6","severity":"medium","path":"packages/db/schema/supabase/0490_music_account_deletion_guard.sql","evidence":"New tables need deletion guard, privacy export, retention and purge classification.","fix":"Classify and test each new table."},
    {"id":"R7","severity":"high","path":"docs/mobile/MUSIC-BEATS-WEB-MOBILE-GAP-2026-11-22.md","evidence":"Studio chat must not bypass the dark Magic Bar.","fix":"Dual-gate or exclude Magic Bar actions and test the planner."},
    {"id":"R8","severity":"medium","path":"lib/musicRuntime.js","evidence":"Unlisted flags are always false and drift needs a static inventory.","fix":"Name/register flags, project them to mobile and test inventory coverage."},
    {"id":"R9","severity":"high","path":"docs/product/MUSIC-PARITY-100-PLAN.md","evidence":"Brief inference needs cost/quota, content scan and provider-contract limits.","fix":"Name boundaries, rate-limit or quote, scan before inference and validate the immutable contract."},
    {"id":"R10","severity":"medium","path":"app/veyrnox/_components/music/MusicQueue.jsx","evidence":"The existing public-slug queue and mobile player must be extended, not duplicated.","fix":"Use typed account-keyed entries, purge on sign-out and reuse TTL refresh."},
    {"id":"R11","severity":"medium","path":"docs/product/MUSIC-PARITY-100-PLAN.md","evidence":"Native builds from another checkout need source equality evidence.","fix":"Pin the commit and compare the apps/mobile tree hash."},
    {"id":"R12","severity":"low","path":"apps/mobile/app.json","evidence":"An app-version bump changes the OTA runtime.","fix":"Pair a bump with an authorized store build or get explicit approval."},
    {"id":"R13","severity":"medium","path":"docs/adr/0376-crun-suno-music-supplier.md","evidence":"A failed production route cannot support a shipped Creation row.","fix":"Limit dependent rows to qualified or externally blocked and report health."},
    {"id":"R14","severity":"low","path":"docs/product/MUSIC-PARITY-100-PLAN.md","evidence":"The challenge day needs an explicit time zone.","fix":"Use UTC and boundary tests."}
  ],
  "coverage": ["Recomputed target/current totals", "Re-checked previous findings against the rubric change", "Reused the previous repository evidence"],
  "limitations": ["The reviewer did not re-read the revised plan file", "PR #2665, Suno sources and runbooks remained uninspected", "No tests or builds were run"]
}
```

Host dispositions:

- R1 accepted again: the plan now shows 76.75 and the explicit whole-number rounding rule; the test contract recomputes totals.
- R2 accepted and materially expanded: the plan now contains the complete frozen stable-id row matrix, within-area weights, current/target status and proof class.
- R3 accepted: iOS returns to a 92 minimum; the product target rises to 93.45 through Library 97 and Community 90. The iOS matrix shows that physical-device and RevenueCat sandbox proof are mandatory to exceed the minimum.
- R4–R14: the round-1 dispositions remain in the on-disk revised plan. They were reported unchanged because the resumed reviewer did not re-read the file; round 3 is instructed to inspect the new plan hash directly.

### Round 3 — REVISE

- Runner result: `/private/tmp/claudex-music-parity-round3/claudex-dzza3i23/result.json`
- Plan SHA-256: `57ab2fb439d899d6398b148b0aa891d8134b5066a7cd4d10c377ea20915d787d`
- Observed model: `claude-opus-5-5`

Full reviewer response:

```json
{
  "verdict": "REVISE",
  "summary": "The reviewer confirmed R1, R2 and R4-R14 were resolved, and every prior row total recomputed correctly. New findings were that the target scheduled no work for provider-dependent editing rows or route health; physical-device-dependent rows were over-credited in the baseline; shared packages were counted across areas without sensitivity; moving the existing queue to a new off flag would regress it; flag coverage needed a many-to-one mapping; two intentionally-different rows lacked same-outcome evidence; and account deletion wording contradicted the existing guard.",
  "findings": [
    {"id":"N1","severity":"high","path":"docs/product/MUSIC-PARITY-100-PLAN.md","evidence":"Advanced stem selection and surgical lyric change targeted shipped but had no delivery slice or approved provider contract.","fix":"Schedule approved provider work or leave the rows missing and rebalance."},
    {"id":"N2","severity":"high","path":"docs/product/MUSIC-PARITY-100-PLAN.md","evidence":"Production route health targeted shipped even though fal is failing and the Crun paid probe is a non-goal.","fix":"Schedule bounded diagnosis or keep the row qualified and rebalance."},
    {"id":"N3","severity":"high","path":"docs/product/MUSIC-PARITY-100-PLAN.md","evidence":"Physical-fidelity, mic, MIDI and signed-asset rows were marked shipped although the required proof is outstanding, inflating the baseline to 77 instead of about 70.","fix":"Set unmet physical rows to qualified, recompute and make physical proof mandatory."},
    {"id":"N4","severity":"medium","path":"docs/product/MUSIC-PARITY-100-PLAN.md","evidence":"Albums, challenges, route health and hardware packages affect several rows, so failures are correlated.","fix":"Use one row per outcome or declare shared proof and add sensitivity."},
    {"id":"N5","severity":"medium","path":"app/veyrnox/layout.js","evidence":"The existing public-slug queue is on `rails`; moving it to a new default-off flag would regress shipped behavior.","fix":"Keep public slugs on rails and use the new flag only for owned persistence."},
    {"id":"N6","severity":"medium","path":"lib/musicRuntime.js","evidence":"A one-row-per-flag rule conflicts with the frozen row set and infrastructure flags.","fix":"Freeze a many-to-one flag mapping and explicit infrastructure exemptions."},
    {"id":"N7","severity":"low","path":"docs/product/MUSIC-PARITY-100-PLAN.md","evidence":"Models/personalization and Music MCP lacked concrete same-outcome evidence.","fix":"Name evidence or score the rows zero."},
    {"id":"N8","severity":"low","path":"packages/db/schema/supabase/0490_music_account_deletion_guard.sql","evidence":"The guard blocks account deletion while Music rows exist, contradicting automatic removal wording.","fix":"State deletion remains blocked until Music content is removed, or specify purge-before-guard."}
  ],
  "coverage": ["Full current plan and all row arithmetic", "Earlier findings", "Queue gate", "Static flag inventory", "Beats gap matrix", "ADR-0376", "Account deletion guard"],
  "limitations": ["PR #2665, external Suno sources and activation runbook still uninspected", "Existing target-stem and section-replace support were not evaluated as substitutes", "No tests or builds were run"]
}
```

Host dispositions:

- N1 accepted: the provider-dependent rows remain missing; Editing targets only source-complete rows that can be physically qualified.
- N2 accepted: route health remains qualified. Slice 0 adds read-only fal diagnosis and permits only a repository-owned safe fix; no paid Crun probe is implied.
- N3 accepted: physical Editing, DAW and iOS rows now start qualified. The baseline falls to 69.5 and physical-device proof is mandatory for closeout.
- N4 accepted: a shared-proof sensitivity table shows the total loss for Albums, challenge, hardware, Studio chat, queue and MCP packages.
- N5 accepted: public-slug playback stays on `rails`; `persistentQueue` gates only owned-asset persistence.
- N6 accepted: the plan freezes a many-to-one flag mapping and exempts only `ui`, `schema` and `dispatch`.
- N7 accepted: Lyricist profile evidence is named; Music MCP is now missing and has a scheduled implementation slice.
- N8 accepted: account deletion remains blocked until Music content is explicitly removed.

The corrected baseline is 69.5. The revised scheduled target is 93.3: Creation 90, Editing 85, DAW 97.5, Library 100, Community 100 and iOS 93.

### Round 4 — REVISE

- Runner result: `/private/tmp/claudex-music-parity-round4/claudex-03k7lz0q/result.json`
- Plan SHA-256: `92b5e4ebf5afc3d04bfa693bcc8f2fbc76fdb652a663e216a5610daaf2617baa`
- Observed model: `claude-opus-5-5`

Full reviewer response:

```json
{
  "verdict":"REVISE",
  "summary":"N1-N8 were resolved and all area/weighted totals recomputed. Remaining findings: post-activation 93.3 depended on unscheduled owner operations; provider health was double-counted inconsistently; Music MCP confirmation wording conflicted with the existing trust model; physical sensitivity omitted Library/accessibility rows; and dark flags needed a distinct mapping disposition.",
  "findings":[
    {"id":"P1","severity":"high","path":"docs/product/MUSIC-PARITY-100-PLAN.md","evidence":"New flags default off and migrations require an owner operation, so without explicit activation the maximum is about 85.05.","fix":"Add approval-gated activation checkpoints and report pre/post activation scores."},
    {"id":"P2","severity":"medium","path":"docs/adr/0376-crun-suno-music-supplier.md","evidence":"Unhealthy fal routes conflicted with shipped feature-contract rows.","fix":"Score health only in dedicated rows or downgrade every dependent row."},
    {"id":"P3","severity":"medium","path":"lib/veyrnoxMcp.js","evidence":"Existing MCP paid tools trust connector-supplied user_approved and confirmed_credits, conflicting with 'never let connector assert approval'.","fix":"Choose the existing trust model or design out-of-band approval; require draft/provider contract/rights."},
    {"id":"P4","severity":"low","path":"docs/product/MUSIC-PARITY-100-PLAN.md","evidence":"Physical sensitivity omitted Library signed assets and device accessibility rows.","fix":"Correct the figure and state there is no contingency."},
    {"id":"P5","severity":"low","path":"lib/musicBackend.js","evidence":"Dark references/blocks/magicBar flags were mapped to otherwise shipped rows without a disposition distinction.","fix":"Mark mappings required versus dark evidence and validate accordingly."}
  ],
  "coverage":["All row and weighted arithmetic", "Sensitivity figures", "Complete static flag map", "MCP confirmation pattern", "Runtime gates"],
  "limitations":["Production flag values unavailable", "External sources/runbooks/PR #2665 uninspected", "No tests or builds"]
}
```

Host dispositions:

- P1 accepted: every new flagged slice now ends at an explicit owner activation checkpoint. Pre-activation maximum is 85.05; 93.3 is post-activation only.
- P2 accepted: provider availability is scored only in three dedicated health rows; UI/contract rows are not double-penalized.
- P3 accepted: Music MCP uses the existing connector trust model with exact quote, `user_approved`, `confirmed_credits`, idempotency, draft identity, provider contract, stale errors and rights attestation.
- P4 accepted: physical/device exposure is 11.70 points and there is no contingency.
- P5 accepted: flag mappings now distinguish required, dark-evidence and infrastructure-exempt dispositions.

### Round 5 — APPROVED

- Runner result: `/private/tmp/claudex-music-parity-round5/claudex-93h8mum0/result.json`
- Approved plan SHA-256: `02a4c29aec0e3d6ec8a229c62a829482942d42ce73f99d3b169e88ed7d123b62`
- Observed model: `claude-opus-5-5`

Full reviewer response:

```json
{
  "verdict":"APPROVED",
  "summary":"P1-P5 are resolved. Activation checkpoints, dedicated provider-health rows, the Music MCP trust model, 11.70-point physical exposure and required/dark/infrastructure flag dispositions are present. The 69.5 baseline and 93.3 target recompute correctly. One low-severity pre-activation wording error remains but is not material.",
  "findings":[
    {"id":"Q1","severity":"low","path":"docs/product/MUSIC-PARITY-100-PLAN.md","evidence":"85.05 is the pre-activation score when new rows earn zero. If source-complete unactivated rows earn qualified credit, the maximum is about 89.18 (or 88.68 if labs/ranking are off).","fix":"Report a range or have the inventory compute it."}
  ],
  "coverage":["On-disk round-4 text", "Physical/device exposure", "Pre-activation arithmetic", "P1-P5", "Earlier R1-R14 and N1-N8"],
  "limitations":["Production state, PR #2665, external sources and activation runbook were not inspected", "No tests or builds were run"]
}
```

Host disposition:

- Q1 accepted as unresolved low-priority wording advice. The approved plan bytes remain unchanged because approval is hash-bound and the five-round budget is exhausted. Implementation treats 85.05 as the missing-row floor and computes the actual pre-activation score from inventory state; final reporting will not call it a hard maximum.

## Build and inspection

Pending.
