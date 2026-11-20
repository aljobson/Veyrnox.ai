# Native beat N2 advisory implementation report

Frozen plan SHA256 verified: `f34c7111001f05e6af0a1e01efe2f2200c49aaf159d075a463eff0aaec856006`.
Branch: `claude/beat-native-n2-save-versions`.
All source edits are relative to this checkout. No commit, push, publication, simulator action, or native build was performed. **No device result.** This report is advisory for independent review, not an acceptance certificate. Final result: all accepted inspection fixes are implemented; 1,832 Jest tests pass; TypeScript reports no errors in changed files and 22 errors in untouched files excluded by the host disposition.

## Accepted round-2 inspection revision

- N2R-001: opening a clean local revision 2 with account revision 3 now fast-forwards through the replacement barrier, persists the new doc and cloud link together, and shows synced without a conflict. An edit arriving during the GET instead opens the conflict; a mutation while the replacement waits is rejected by a captured-document check. Failed replacement persistence leaves the controller eligible to retry the account read.
- N2R-002: paused_conflict disables Save version now and shows the paused note inside the versions sheet.
- N2R-003: unchanged background/inactive autosave returns before altering view, timers, or backoff. Explicit checkpoints still write. A fake-timer regression checks the original retry deadline survives.
- N2R-004: a missing userId immediately shows signed_out without a probe, on both home and controller; a 401 collection response also maps to signed_out. Local controls remain available.
- N2R-005: after a version edit applies, a local flush failure remains a local save error. The restored document stays applied and the sheet closes without showing a failed-restore error.

Seven additional Jest cases cover these dispositions, including clean fast-forward relaunch and an edit during the account read. No new translation keys or dependencies were needed. This round changes cloudSync.ts, probe.ts, BeatVersionsSheet.tsx, beats/index.tsx, beatNativeCloud.test.ts, beatNativeScreens.test.tsx, and this report; the full cumulative file list remains below.

## Accepted inspection revision

The host's N2-R-001 through N2-R-006 and the three identified beat-file type errors were addressed in this checkout. The fallback-only locale implementation and prior wrapped-proof blocker were superseded by this revision.

- N2-R-001: all ten app catalogs now include all English beat keys. Updated permanent-delete, saved-beat, and missing-beat meanings; added locale/placeholder parity coverage. Regenerated length review data with the repository script, including fr/de/ar and the other affected locales.
- N2-R-002: home badges require a nonremoved projectId and the current token's userId; account-generation changes immediately hide stale badges.
- N2-R-003: per-file read and quarantine failures preserve that file and allow other beats to hydrate; list failure still rejects hydration. Regression tests cover read, quarantine-write, quarantine-remove, and list failures.
- N2-R-004: removed beats expose Save to my account again. Screen coverage asserts relinking sends expected_revision 0.
- N2-R-005: unexpected local exceptions become ApiError(500, LOCAL_ERROR); invalid account documents become ApiError(500, INVALID_BEAT) and stop automatic retries until explicit Retry. Actual network ApiError(0) retains offline/backoff behavior.
- N2-R-006: Decide later enters paused_conflict with dedicated translated copy and Choose version, retaining the fetched conflict without automatic network retries.
- Type errors: modal ref uses ComponentRef<typeof View>; cloud response guard checks doc_json before narrowing; version label helpers have an explicit typed native seam.

The renewed work order explicitly authorizes the unwrapped proof command. No build lock or guard was modified. Required existing locale catalogs and affected review files already exceed 500 lines; their requested in-place updates are an explicit size-limit exception. New beat implementation and test files remain below 500 lines.

## Implemented source

- Injectable document-storage adapter, web-format records, recoverable temporary writes, invalid-file quarantine, one-time hydration, serialized per-beat writes, 800 ms debounce, local status, and background/inactive/unmount flushing.
- Validated cloud client and normalized real server error envelopes; collection-specific availability probing; local controls remain available when cloud is off. Item NOT_FOUND is re-probed before marking a link removed.
- Plain sync controller with expected revisions, stable payload idempotency keys, account cancellation, shared error/backoff rules, take-asset refusal, conflict fetching, checkpoint Keep mine, and stash-before-replacement Load theirs.
- Replacement barrier rejects editor mutations, waits for existing persistence, captures the latest document, rechecks account/revision after stash, and writes document/link together before releasing the barrier.
- Native conflict modal and versions sheet, shared version labels/validation/migration/restore operation, and shared editor history with accessible Undo/Redo. History mutations advance updatedAt monotonically and increment the local revision, retaining the dirty marker across relaunch.
- English copy, all ten app locale catalogs, dynamic i18n fixtures, explicit beat-key parity, and regenerated length review data. The earlier fallback-only implementation was corrected by N2-R-001.
- Added executable Jest coverage for storage/relaunch/quarantine/debounce, recovery files, replacement races/failures, cloud envelopes/probes/retries/account changes, takes, versions UI/restore, undo/redo durability, and lifecycle flushing. Updated the N1 off-state assertion.

## Explicit deviation: Expo replacement is not literally atomic

The installed Expo SDK 58 implementation in `expo-file-system/ios/FileSystemPath.swift`, `move(to:options:)`, removes an existing destination before moving its replacement. Consequently the required `File` API cannot promise a single atomic overwrite. No native API or dependency was added.

The proposed and implemented deviation is a recoverable protocol: fully write `name.tmp`, move it to `name.pending`, then move it over `name`. Startup promotes completed pending files before reading records; incomplete temp files are ignored. Normal completion leaves one JSON record per beat. An interruption between deletion and move retains the completed pending file for recovery. This is recovery-based replacement, **not a claim of atomic rename or power-loss/fsync durability**. A passing Jest adapter test models this failure window; it is not a native-device durability result. True atomic replacement would require changing the native implementation or relaxing the adapter constraints.

Quarantine uses copy-then-remove through the required four-method adapter, retaining existing `.bad` files with numbered suffixes. It never removes the invalid source before its quarantine copy succeeds.

The explicit no-device work order takes precedence over the general ARTEMIS exploration instructions. Tests use mocked native surfaces; interactions have no device verification.

## Latest proof and blocked actions

The renewed work order authorizes this exact unwrapped command:

```sh
cd apps/mobile && npx jest __tests__/beatNative --runInBand && npx tsc --noEmit -p .
```

Latest Jest output:

```text
Test Suites: 6 passed, 6 total
Tests:       99 passed, 99 total
Snapshots:   0 total
Time:        22.479 s, estimated 23 s
Ran all test suites matching __tests__/beatNative.
```

After the final adjustment to mark an account document opened only after successful replacement, `npx jest __tests__/beatNativeCloud.test.ts --runInBand` also passed: 1 suite, 31 tests, 3.012 s, exit 0. These are a repeat subset of the 99 tests, not additional unique tests.

The exact combined command exited **2** at TypeScript. There were **zero diagnostics in any beat file or changed locale file**. Per the host disposition, the following 22 diagnostics in untouched files were left unchanged:

```text
src/app/(app)/paywall.tsx(5,26): TS2307 missing react-native-purchases-ui
src/app/(app)/paywall.tsx(88,32): TS7006 event
src/components/editor/useVoiceoverRecorder.ts(34,58): TS7006 status
src/components/editor/useVoiceoverRecorder.ts(144,73): TS7006 status
src/components/music/MusicLyricsPanel.tsx(3,32): TS2307 missing expo-clipboard
src/components/ui/FontCatalog.ts(5,34): TS2307 missing @expo-google-fonts/inter/400Regular
src/components/ui/FontCatalog.ts(6,33): TS2307 missing @expo-google-fonts/inter/500Medium
src/components/ui/FontCatalog.ts(7,35): TS2307 missing @expo-google-fonts/inter/600SemiBold
src/components/ui/FontCatalog.ts(8,44): TS2307 missing @expo-google-fonts/instrument-serif/400Regular
src/components/ui/FontCatalog.ts(9,40): TS2307 missing @expo-google-fonts/space-grotesk/500Medium
src/components/ui/FontCatalog.ts(10,38): TS2307 missing @expo-google-fonts/space-grotesk/700Bold
src/lib/analytics/client.ts(1,30): TS2307 missing posthog-react-native
src/lib/analytics/client.ts(59,78): TS2307 missing posthog-react-native
src/lib/analytics/client.ts(69,26): TS7006 key
src/lib/analytics/client.ts(70,33): TS7006 key
src/lib/analytics/client.ts(70,38): TS7006 value
src/lib/analytics/client.ts(81,26): TS7006 event
src/lib/clipboard.ts(1,28): TS2307 missing expo-clipboard
src/lib/instrumentPlayer.ts(1,72): TS2307 missing expo-audio
src/lib/music/useMusicPlayer.ts(4,54): TS2307 missing expo-audio
src/lib/voiceoverRecorder.ts(2,70): TS2307 missing expo-audio
src/lib/voiceoverRecorder.ts(11,156): TS2307 missing expo-audio
```

TS2307 is “Cannot find module … or its corresponding type declarations”; TS7006 is “Parameter … implicitly has an 'any' type.” The output above preserves every diagnostic path, position, code, and subject. This is not a claim that the whole-project typecheck is green.

Supplementary proof from `apps/mobile` (exit **0**):

```sh
npx jest __tests__/appTranslations.test.ts __tests__/dynamicI18n.test.ts __tests__/i18nWiring.test.ts __tests__/i18n.test.ts __tests__/i18nLazy.test.ts __tests__/i18nDevice.test.ts __tests__/i18nTableCell.test.ts __tests__/visibleStrings.test.ts --runInBand
```

```text
Test Suites: 8 passed, 8 total
Tests:       1733 passed, 1733 total
Snapshots:   0 total
Time:        280.275 s
```

This includes full app-catalog coverage/placeholder/equality/expanded-copy checks, dynamic-key parity, registry wiring, translator/device/lazy-loading checks, and the full visible-copy guard. Together with the beat run, **14 suites and 1,832 tests pass**.

Earlier verification found a queued timer retrying LIMIT_REACHED and a lifecycle test selecting an unrelated AppState listener. The timer is now cancelled on sync entry and terminal failures halt automatic retries. The test broadcasts background to registered listeners and supplies a fresh AppState subscription mock per case. The final 99-test run includes these corrections.

Early exact-command attempts were interrupted (exit 130) after delayed output. A diagnostic direct Jest run used `--watchman=false`; its failures were fixed. Delayed output later showed the default runner was executing, so a temporary Watchman configuration change was removed. **No Jest configuration change remains.** The passing run above uses the exact requested command and original configuration.

Prior-turn build-slot permission denial is no longer a proof blocker because the renewed work order explicitly requests unwrapped execution. The lock and storage safeguards were not changed. `ps` process inspection was denied by the sandbox during diagnostics. ESLint is absent from the reused installation; no dependency installation was attempted. No source edit, commit, push, publication, or device action was denied or attempted outside the authorized scope.

Completed lightweight checks: English registry current; generated web i18n catalogs up to date; length-review data regenerated with the repo script; `git diff --check` clean. The required large existing locale/review files are the documented size-limit exception; new implementation/test files stay below 500 lines.

## Changed files

42 files differ from the starting branch (including the existing N2 implementation and this advisory report):

- `apps/mobile/__tests__/beatNativeCloud.test.ts`
- `apps/mobile/__tests__/beatNativeFileAdapter.test.ts`
- `apps/mobile/__tests__/beatNativeFixtures.ts`
- `apps/mobile/__tests__/beatNativeI18n.test.ts`
- `apps/mobile/__tests__/beatNativePersist.test.ts`
- `apps/mobile/src/components/beats/BeatCloudConflictModal.tsx`
- `apps/mobile/src/components/beats/BeatModal.tsx`
- `apps/mobile/src/components/beats/BeatSaveControls.tsx`
- `apps/mobile/src/components/beats/BeatVersionsSheet.tsx`
- `apps/mobile/src/lib/beatNative/cloud.ts`
- `apps/mobile/src/lib/beatNative/cloudSync.ts`
- `apps/mobile/src/lib/beatNative/history.ts`
- `apps/mobile/src/lib/beatNative/persist.ts`
- `apps/mobile/src/lib/beatNative/rules.ts`
- `apps/mobile/src/lib/beatNative/useBeatSession.ts`
- `apps/mobile/src/lib/beatNative/useLocalBeatLifecycle.ts`
- `apps/mobile/src/lib/beatNative/versions.ts`
- `docs/mobile/BEAT-NATIVE-N2-IMPLEMENTATION-2026-11-20.md`
- `apps/mobile/__tests__/beatNativeScreens.test.tsx`
- `apps/mobile/__tests__/dynamicI18n.test.ts`
- `apps/mobile/src/app/(app)/beats/[id].tsx`
- `apps/mobile/src/app/(app)/beats/index.tsx`
- `apps/mobile/src/lib/beatNative/probe.ts`
- `apps/mobile/src/lib/beatNative/store.ts`
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
- `apps/mobile/src/lib/i18n/messages/en/beat.ts`
- `apps/mobile/src/lib/i18n/review/ar-length.json`
- `apps/mobile/src/lib/i18n/review/de-length.json`
- `apps/mobile/src/lib/i18n/review/es-length.json`
- `apps/mobile/src/lib/i18n/review/fr-length.json`
- `apps/mobile/src/lib/i18n/review/hi-length.json`
- `apps/mobile/src/lib/i18n/review/pt-length.json`
- `apps/mobile/src/lib/i18n/review/ru-length.json`

## Design-goal criteria disposition

Applies to beats home/editor, local/cloud save controls, conflict modal, and versions sheet. “Checked (source)” means code inspection or the named static guard only; it does not assert a rendered/device result. No PR was created, so these dispositions are recorded here for the eventual PR body.

| Criterion from docs/design-goal-criteria.md | Disposition |
| --- | --- |
| Information appears once per screen | Checked (source): one local status and one account status; device presentation not checked. |
| Mobile spacing uses ds.space; gutter 20 | Checked (source): new modal/list spacing uses ds.space.gutter/lg/sm/hero. |
| Web spacing scale | Not applicable: no web edits. |
| Mobile/web radius sets and nested radii | Not applicable to new containers: no custom radii introduced; shared controls retained. |
| Light shadows e1/e2, none in dark/OLED | Checked (source): no new shadows; semantic background tokens. Theme rendering not checked. |
| Intentional rhythm and one primary action | Not checked visually; conflict choices and editor actions need independent design review. |
| Mobile semantic colors; no literal hex/rgb | Checked (source): new UI uses themed bg and Text tones. |
| Web vx colors and both themes | Not applicable. |
| Money/warning, accent and danger meanings | Checked (source): no money/warning added; error text uses danger. |
| Feature hues name features only | Not applicable: no new feature hues. |
| Contrast in all themes and five accents | Not checked: no rendered/device validation. |
| Selected Typeface and type ramp, no numeric font sizes | Checked (source): shared Text variants only. |
| No weight 800/900 | Checked (source): none introduced. |
| No failing-provider marketing visuals | Not applicable: no marketing visuals. |
| No wallet/on-chain wording | Checked (source): none introduced. |
| Touch controls >=44 pt, primary 52 | Checked (source): shared Button defaults to lg/52; existing small delete uses shared hit target. Device measurement not checked. |
| XL and OS 1.5 text scaling | Not checked: no device result. |
| Accessible names and announced status changes | Checked (source): t() labels, polite live regions, alert errors, modal heading focus. Assistive-technology behavior not checked. |
| Web focus rings/keyboard reachability | Not applicable. |
| Reduced motion | Checked (source) for new modal: animationType none; shared-control behavior not checked on device. |
| Layout at 375/1280 without horizontal scroll | Not checked: no visual run. |
| Empty state explains content and next action | Checked (source): local New beat and versions Save version now; Covered by the passing beat Jest run. |
| Loading placeholder within 100 ms and stable layout | Not checked: loading text exists; timing/layout not measured. |
| Error explains failure, offers retry, no raw payload | Checked (source and Jest): translated errors, retry and paused-conflict recovery; no server detail/stack rendered. |
| Offline notice preserves content | Checked (source): local list/editor remain available; controller backoff tests passed. |
| Slow-network progress after about 3 seconds | Not checked: busy text exists; no timing or long-network UI result. |
| Global service-outage banner from /api/status | Not checked: existing app-level service banner was not changed or exercised. |
| Search-result recovery | Not applicable: no search in this slice. |
| Permission-denied explanation and recovery | Not checked: cloud errors currently use generic retry copy; account mismatch has dedicated local-preservation copy. |
| Session-expired input retention and sign-in recovery | Checked (source) for retention/account abort only; sign-in navigation not checked. |
| Form validation beside fields | Not applicable to the added save/version controls; existing edit refusal behavior retained. |
| Success confirmation and next step | Checked (source): local/account saved statuses and restored editor; announcements not device-tested. |
| Catalog/API prices and balances | Not applicable. |
| Exact Credit cost and refund flow | Not applicable. |
| Paid action prevents duplicate submission | Not applicable: no paid action. Cloud mutations nevertheless use idempotency keys and busy state. |

## Checkout and storage

Reused this checkout and its existing mobile node_modules symlink to the installed N1 sibling. No dependency directory, native environment, build cache, preview server, or worktree was created. No other checkout was edited or retired. No newly unused worktree exists from this task; this checkout remains active for independent review.

The goal is met when… saved beats survive relaunch, cloud-off preserves all local controls, conflicts preserve the latest local document under the replacement barrier, restored versions undo and persist, the agreed Jest/TypeScript proofs pass, and the unverified design/device criteria above are independently dispositioned. The beat Jest gate passes and no beat-file compiler errors remain. Whole-project typechecking still exits 2 on the untouched diagnostics explicitly excluded by the host disposition. Device/visual criteria remain unverified as required by this work order.
