# Create Best Cut — advisory implementation handover

Frozen order SHA256 verified:
`c482db9c073f7c486daef78284a053e03b2d494309a1ab4d61161186c91e25dc`.
All edits are in this checkout. Nothing was committed, pushed, published, deployed
or migrated. No production flags, Worker bindings, EAS profile, dependency manifest
or native module were changed. Independent review is still required.

## Implemented

- Server upload analysis, bounded streaming SHA256 verification, QuickTime admission,
  source-aware free preflight, catalogue-only prices and atomic cache-only approval.
- Receipt-owned no-speech capability, legacy-safe responses, compensating refund,
  once-only settlement, and atomic daily reservation accounting across UTC rollover.
- Owner-scoped upload transcript identity independent of the temporary file; 30-day
  retention and account-deletion classification/cleanup.
- Copy-only camera-roll import, Library selection, consent, price/balance display,
  per-clip progress/cancellation, receipt recovery, no-speech and Try Anyway paths.
- Deterministic local take/script planner, bounded alignment, frame/section/duration
  validation, editable captions, settings, and one-entry Undo application.
- Smart Cut and editor entries; read-only Before/After with selectable boundaries;
  all eleven app locales and generated equality/length reviews.
- ADR-0334, migration 0455, server unit tests and additional local-Postgres acceptance
  cases, including both legacy/Best Cut joining orders and three concurrent requests
  at nine used refund slots.

## Proof and validation

The agreed command is `npm --prefix apps/mobile run typecheck`. It exits **0**:

```text
> veyrnox-mobile@1.0.0 typecheck
> tsc --noEmit
```

Focused server command:

```text
node --test tests/bestCutServer.test.mjs tests/speechAnalysis.test.mjs tests/speechMigrationGuards.test.mjs tests/speechSourceProbe.test.mjs tests/uploadSource.test.mjs
66 tests; 66 passed; 0 failed
```

Focused existing mobile tests:

```text
npm --prefix apps/mobile test -- --runTestsByPath __tests__/speechCut.test.ts __tests__/speechAnalysisClient.test.ts __tests__/appTranslations.test.ts __tests__/i18nWiring.test.ts --maxWorkers=2 --watchman=false
4 suites passed; 463 tests passed
```

English registry, locale length reviews, web catalogue synchronization, server lint
for changed modules, and `git diff --check` pass. The existing localization test's
hardcoded plural-family count changes from 67 to 68 for the new clips family.

Full mobile lint was attempted. It reports 1 error and 733 warnings; the error is in
untouched `apps/mobile/src/components/smart-cut/SmartCutPreview.tsx:17`
(`react-hooks/immutability`: modifying a hook-returned value). Existing quick pacing
code was not redesigned to repair it. Focused lint of new modules is recorded in the
proof artifact.

## Denied or blocked checks

- `gh pr list` could not connect to `api.github.com`. Migration 0455 / ADR-0334 are
  locally available but require a live collision check before integration.
- ARTEMIS `mobile_diagnose(attempt_fix=true)` was denied: “MCP tool call requires
  approval, but approval policy is never.” The requested device exploration could
  not be completed. A waiver was requested for new pure mobile unit tests; without
  that waiver, the required new planner/captions/flow tests remain un-authored.
- `adb devices -l` could not start its socket listener (“Operation not permitted”).
  `xcrun simctl list devices available` could not connect to CoreSimulatorService.
  No device was booted, no screenshot/Arabic-shaping verification was obtained,
  and no Metro/mock server or native build was started.
- The consolidated native checkout exists. Existing dependency symlinks in this
  checkout point to `openjutsu-repo-usage-060bd0`; its mobile lockfile SHA256 exactly
  matches this checkout. They predated this work and were not replaced. The
  consolidated native checkout has a different mobile lockfile; no install/build
  was attempted there or in any original checkout.
- `~/.local/bin/with-build-slot npm test -- --test-concurrency=2` failed before tests
  started: permission denied opening
  `/Users/aljobson/.local/share/storage-guard/build-slot.lock`. The lock and its
  safeguards were not bypassed. Full server and mobile suites remain unrun.
- No disposable local Postgres answered at localhost:5432, and no test database URL
  is configured. `node --test packages/db/speechAnalysis.acceptance.test.ts` skips
  its suite. Migration application, SQL execution, ledger races and refund-once
  acceptance are unverified; the migration was never applied.

## Deviations and explicit interpretations

1. **Source monotonicity versus script order:** script-order assembly can move
   backwards through source footage. Output time is monotonic; source intervals
   are bounded, frame-aligned and non-overlapping. Requiring both source monotonicity
   and arbitrary script order is impossible.
2. **Object HEAD:** the existing adapter lacks a signed HEAD helper. A bounded
   signed GET range reads metadata plus magic bytes, then streams the real SHA256.
   ETag-conditional reads and create-only reservations bind the inspected object.
3. **Upload prerequisite/aggregate size:** upload analysis additionally requires
   the existing integrity switch and a reservation, because overwriteable PUTs
   cannot safely bind a verified hash to later provider bytes. The inherited
   200 MiB aggregate temporary-upload budget is disclosed and preserved. Ten
   simultaneous 100 MiB temporary files are therefore not supported.
4. **Try Anyway:** raw clips above 60 seconds cannot both remain unedited and fit
   the required output cap. The UI asks for fewer clips; it does not silently trim.
5. **Captions:** provider-timed CJK words/grapheme groups are preserved; no guessed
   timestamps are assigned within a provider word. Repeats embedded inside one
   provider-timed word are retained; removing part would require invented timing.
   If even groups of three cannot
   fit 150 text items, captions are omitted with a notice. Arabic shaping is unrun.
6. **One tap and review:** normal results apply automatically. A result truncated
   at the 60-second tail cap requires the prescribed review before application.
   The comparison is an isolated read-only modal, not a mutable document swap.
7. **Command compilation:** script reordering needs `insertMedia` and `move` as well
   as `remove`, `trim` and `addText`; all are existing validated editor commands.
8. **Test prerequisite:** new mobile test coverage cannot honestly claim prior
   ARTEMIS exploration. Existing tests were run; the new unit-test waiver and device
   acceptance remain outstanding. No new UI interaction tests were invented.

Short and punchy prefers the shorter take when fluency/completeness tie in a
repeat cluster. Vlog and the educational/keep-steps modes alter selection as
specified. With an explicit script, script-line matching takes precedence over
Vlog's every-clip coverage: a clip with no matching line cannot satisfy both
requirements. This precedence is a proposed interpretation for independent review. Free-text notes are intentionally not interpreted. Fillers,
on-device speech, B-roll, larger limits and a delete-transcripts action remain
follow-ups, as in the frozen plan.

## Independent review / activation work

Review the migration and source/receipt ownership boundaries first. Provision a
local database through the approved workflow, then run acceptance twice (including
migration idempotence), both complete suites and the planned new mobile tests.
Exercise picker consent, exact/free pricing, cancellation/recovery, mixed/all-silent
clips, tail review, Undo, Before/After and Arabic/CJK captions on an unused device.
Resolve the migration/ADR numbering check before integration. Owner activation of
server and phone flags is separate. No flags should be enabled on the strength of
this advisory report alone.

No worktree was created. No existing checkout was identified as safely unused, and
none was archived or removed.

## Files changed

The following list includes new files as well as tracked edits:
- `apps/mobile/__tests__/appTranslations.test.ts`
- `apps/mobile/src/app/(app)/account.tsx`
- `apps/mobile/src/app/(app)/editor/[projectId].tsx`
- `apps/mobile/src/app/(app)/smart-cut.tsx`
- `apps/mobile/src/components/editor/FullEditorScreen.tsx`
- `apps/mobile/src/lib/aiConsent.ts`
- `apps/mobile/src/lib/aiConsentStore.ts`
- `apps/mobile/src/lib/i18n/messages/app/ar.ts`
- `apps/mobile/src/lib/i18n/messages/app/de.ts`
- `apps/mobile/src/lib/i18n/messages/app/es.ts`
- `apps/mobile/src/lib/i18n/messages/app/fr.ts`
- `apps/mobile/src/lib/i18n/messages/app/hi.ts`
- `apps/mobile/src/lib/i18n/messages/app/ja.ts`
- `apps/mobile/src/lib/i18n/messages/app/ko.ts`
- `apps/mobile/src/lib/i18n/messages/app/pt.ts`
- `apps/mobile/src/lib/i18n/messages/app/ru.ts`
- `apps/mobile/src/lib/i18n/messages/app/zh.ts`
- `apps/mobile/src/lib/i18n/messages/en.ts`
- `apps/mobile/src/lib/i18n/review/ar-equal.json`
- `apps/mobile/src/lib/i18n/review/ar-length.json`
- `apps/mobile/src/lib/i18n/review/de-equal.json`
- `apps/mobile/src/lib/i18n/review/de-length.json`
- `apps/mobile/src/lib/i18n/review/es-equal.json`
- `apps/mobile/src/lib/i18n/review/es-length.json`
- `apps/mobile/src/lib/i18n/review/fr-equal.json`
- `apps/mobile/src/lib/i18n/review/fr-length.json`
- `apps/mobile/src/lib/i18n/review/hi-equal.json`
- `apps/mobile/src/lib/i18n/review/ja-equal.json`
- `apps/mobile/src/lib/i18n/review/ko-equal.json`
- `apps/mobile/src/lib/i18n/review/pt-equal.json`
- `apps/mobile/src/lib/i18n/review/pt-length.json`
- `apps/mobile/src/lib/i18n/review/ru-equal.json`
- `apps/mobile/src/lib/i18n/review/ru-length.json`
- `apps/mobile/src/lib/i18n/review/zh-equal.json`
- `apps/mobile/src/lib/speechAnalysis.ts`
- `docs/editor/SMART_CUT.md`
- `lib/editorRuntimeFlags.mjs`
- `lib/speechAnalysis.js`
- `lib/speechSourceProbe.js`
- `lib/uploadSource.js`
- `packages/db/speechAnalysis.acceptance.test.ts`
- `scripts/test-account-deletion.mjs`
- `tests/uploadSource.test.mjs`
- `app/api/v1/editor/speech-analyses/preflight/route.js`
- `apps/mobile/src/components/editor/BestCutEntry.tsx`
- `apps/mobile/src/components/editor/BestCutResult.tsx`
- `apps/mobile/src/components/editor/BestCutSettings.tsx`
- `apps/mobile/src/components/editor/BestCutSheet.tsx`
- `apps/mobile/src/components/editor/useBestCutAvailability.ts`
- `apps/mobile/src/components/editor/useBestCutEditor.tsx`
- `apps/mobile/src/lib/applyBestCut.ts`
- `apps/mobile/src/lib/bestCutCaptions.ts`
- `apps/mobile/src/lib/bestCutFlow.ts`
- `apps/mobile/src/lib/bestCutPlan.ts`
- `apps/mobile/src/lib/bestCutSettings.ts`
- `apps/mobile/src/lib/bestCutSpeechGate.ts`
- `apps/mobile/src/lib/i18n/messages/en/bestCut.ts`
- `docs/adr/0334-create-best-cut.md`
- `docs/editor/BEST_CUT_HANDOVER.md`
- `lib/speechUploadSource.js`
- `packages/db/schema/supabase/0455_best_cut.sql`
- `tests/bestCutServer.test.mjs`
- `docs/editor/BEST_CUT_PROOF.txt` (validation output)


## Host follow-up (2026-11-08)
After two independent inspections the host fixed: camera-roll media dimensions (validated before charge), script-reorder padding overlap, upload kept after a refunded failure, persistent caption/refund/warning notices, Cancel no longer shows a failure, After chip state and Undo clearing the comparison, QuickTime scoped to speech, one-source preflight, telemetry allowlist and route inventory. Changes after the last Codex inspection were reviewed by one more fresh Claude inspection (see ADR-0334 residuals). The simulator check was NOT completed: the installed Debug build cannot load a bundle from a non-default port without a native rebuild.
