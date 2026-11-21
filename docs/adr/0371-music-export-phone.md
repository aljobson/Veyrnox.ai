# ADR-0371: Download stored song audio on the phone

Status: Implemented. Plan review and independent code inspection approved; no device or paid test has run.

## Contract and scope

P3e1 adds download review, confirmation and device sharing for the current song version. Tempo/key, reverse, speed, local rendering, the native beat editor, playlists, discovery and public pages are unchanged. No server, migration, package, flag or native configuration changes are needed.

Verified in this checkout: `app/api/v1/music/songs/[id]/export-quotes/route.js`, `songs/[id]/exports/route.js`, `exports/[id]/route.js`, `songs/[id]/route.js`, `lib/musicBackend.js`, and migrations `0467`, `0505`, `0506`. Responses are no-store. Quotes expire after five minutes. The server returns the stored MP3, WAV or FLAC, never transcodes. `download_mp3` advertises all three formats. The mobile detail type exposes `version_id` but no stored MIME, so MP3 is the initial choice; format rejection asks the person to choose another format. Review refreshes the song and uses that current `version_id`.

Every response field is validated, including canonical MIME matching, requested format, allowance arithmetic, finite expiry, positive safe integer size, requested export identity and credential-free HTTPS URLs. Both POSTs use only their specified fields. IDs in paths are encoded. A successful start currently always has `state: ready`, as inserted by `music_start_audio_export`.

## Allowances and recovery

A dedicated small `exportFlow` is used under the frozen plan's explicit alternative. The existing generic `MusicActionQuoteBase` still requires `total_credits`, `balance`, `balance_after` and `affordable`; `actionAttempts` enforces affordability and `actionFlow` requires rights and starts generation polling. Faking those fields would obscure the allowance contract and import irrelevant spending and polling behavior. Export therefore owns its allowance-only attempt state, while reusing the API client, song reader, account subscription and file-sharing helper.

Each quote receives one `export`-prefixed UUID key. Review never starts an export. Confirm locks synchronously against double taps. Before submission, expired quotes are blocked; after an ambiguous response (including HTTP 502, a lost network response or malformed success), the same quote/key is replayed even after expiry. The RPC checks replay before expiry. Ambiguous attempts block review and format changes. Explicit server rejection clears the attempt. Format edits invalidate unsubmitted quotes and late review results. Account replacement or disposal invalidates all late results and native share callbacks.

The server grants non-subscribers seven downloads and debits no credits. `api.ts` preserves the server's HTTP 402 code and does not itself open billing. `hardPaywall.ts` matches only enumerated paid POSTs; its editor-export comment concerns server rendering, not stored music files. `aiConsent.ts` matches requests carrying content to AI providers. Neither music export POST qualifies for either list. No guard edits were needed. Tests send both POSTs and the read through the real `guardedBeforeSend` API client with the hard paywall locked and consent refused; they also pin allowance exhaustion at both POSTs without consent prompts or locked-attempt notifications.

Distribution-off 404 responses clear the flow and hide Download audio for the account session. This export-specific availability state resets on account change. Share links keep their independent `probeMusic` handling; no share-link behavior is changed. Ordinary not-found responses remain errors, not switch-off signals.

## Saving and privacy

The existing `shareStemFile` accepts an additive `export` kind. MP3 uses `audio/mpeg` / `public.mp3`, WAV uses `audio/wav` / `com.microsoft.waveform-audio`, and FLAC uses `audio/flac` / `org.xiph.flac`. Existing unique cache staging, exact-size verification, availability check, URL-free errors, stale-cache sweeping and attachment retention are reused. Existing stem tests remain intact and additional export tests pin all three mappings and failure behavior.

Every Save re-reads the same export ID for a fresh five-minute URL, then transfers once and opens the native share sheet. It never posts another export. The URL exists only during the operation; it is not stored in flow state, persisted or logged. Failed transfers preserve the export and allow Save again. The share API resolves on dismissal, including cancel, so closing it returns to ready with neutral copy. There is no saved-success state or claim. Tests verify dismissal and repeat Save with one new GET, one new transfer and zero POSTs.

Export IDs and ambiguous keys are screen-local memory. Leaving the screen or restarting loses recovery tracking; returning can review the same version again, and server claims prevent an additional allowance debit within that period. A share already handed to the operating system cannot be recalled by an account change. No device or simulator verification is claimed.

Expo SDK 58 documentation was consulted for the existing APIs: [Sharing](https://docs.expo.dev/versions/v58.0.0/sdk/sharing/) and [FileSystem](https://docs.expo.dev/versions/v58.0.0/sdk/filesystem/). No additional animation is introduced; existing UI components own reduced-motion behavior.

## Localization and deviations

`musicExport.*` has its own English area and generated registry entry. Ten app catalogs contain machine translations with preserved placeholders, locale plural forms and equality/expanded-length review data. Native-language review is pending. The locale-sync script is unchanged.

Existing catalog and review data files already exceed the frozen 500-line ceiling. They retain their established format with additive entries; splitting or redesigning localization would exceed this slice. All new code files stay below 500 lines. The work order explicitly permits the dedicated flow and explicitly waives ARTEMIS for mocked tests; no device, simulator or ADB was used.

## Proof environment

The installed dependency symlink reuses the canonical mobile checkout, whose existence was confirmed. No installation or new checkout was created. The exact `with-build-slot npx jest --ci --maxWorkers=2` command was attempted but denied while opening the existing owner lock for writing outside the sandbox. As in ADR-0357, a temporary read-only adapter acquires an exclusive lock on the same existing inode and holds it throughout the child process. The owner wrapper, shared lock contents and safeguards remain unchanged. This is a reported proof-command deviation, not a claim that the exact command passed.

TypeScript, full Jest, registry and targeted lint results are recorded in the advisory implementation report. No commit, push or publication is performed.

## Changed-file manifest

All 50 paths are relative to this checkout. This is an advisory handoff for independent review.

- `apps/mobile/__tests__/appTranslations.test.ts`
- `apps/mobile/__tests__/audioHub.test.ts`
- `apps/mobile/__tests__/dynamicI18n.test.ts`
- `apps/mobile/__tests__/fixtures/musicExport.ts`
- `apps/mobile/__tests__/musicExportClient.test.ts`
- `apps/mobile/__tests__/musicExportFlow.test.ts`
- `apps/mobile/__tests__/musicExportGuards.test.ts`
- `apps/mobile/__tests__/musicExportI18n.test.ts`
- `apps/mobile/__tests__/musicExportScreens.test.tsx`
- `apps/mobile/__tests__/musicExportValidation.test.ts`
- `apps/mobile/__tests__/stemsFiles.test.ts`
- `apps/mobile/src/app/(app)/music/export.tsx`
- `apps/mobile/src/components/music/MusicExportBody.tsx`
- `apps/mobile/src/components/music/MusicSongActions.tsx`
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
- `apps/mobile/src/lib/i18n/messages/en/musicExport.ts`
- `apps/mobile/src/lib/i18n/review/ar-equal.json`
- `apps/mobile/src/lib/i18n/review/de-equal.json`
- `apps/mobile/src/lib/i18n/review/de-length.json`
- `apps/mobile/src/lib/i18n/review/es-equal.json`
- `apps/mobile/src/lib/i18n/review/es-length.json`
- `apps/mobile/src/lib/i18n/review/fr-equal.json`
- `apps/mobile/src/lib/i18n/review/fr-length.json`
- `apps/mobile/src/lib/i18n/review/hi-equal.json`
- `apps/mobile/src/lib/i18n/review/hi-length.json`
- `apps/mobile/src/lib/i18n/review/ja-equal.json`
- `apps/mobile/src/lib/i18n/review/ko-equal.json`
- `apps/mobile/src/lib/i18n/review/pt-equal.json`
- `apps/mobile/src/lib/i18n/review/pt-length.json`
- `apps/mobile/src/lib/i18n/review/ru-equal.json`
- `apps/mobile/src/lib/i18n/review/ru-length.json`
- `apps/mobile/src/lib/i18n/review/zh-equal.json`
- `apps/mobile/src/lib/music/exportAvailability.ts`
- `apps/mobile/src/lib/music/exportClient.ts`
- `apps/mobile/src/lib/music/exportFlow.ts`
- `apps/mobile/src/lib/music/exportMessages.ts`
- `apps/mobile/src/lib/music/stemFiles.ts`
- `apps/mobile/src/lib/music/validateExport.ts`
- `docs/adr/0000-music-export-phone.md`
- `docs/mobile/MUSIC-P3-SLICES-2026-11-18.md`

## Advisory proof results (2026-11-21)

- `cd apps/mobile; npx tsc --noEmit`: exit 2. Final diagnostics contain no changed-file errors: 21 TS2307 missing-module diagnostics and seven TS7006 implicit-any diagnostics in unchanged files. Missing modules include `expo-audio`, `expo-clipboard`, `react-native-purchases-ui`, `posthog-react-native` and Google font packages. The seven inferred-type errors accompany unavailable dependencies. This exceeds the work order's literal allowance for only missing-package diagnostics; those unrelated files were not edited and dependencies were not installed. Diagnostic capture: `/private/tmp/music-p3e-tsc-diagnostics.log`.
- Exact `~/.local/bin/with-build-slot npx jest --ci --maxWorkers=2`: exit 1 before Jest started, `PermissionError: [Errno 1] Operation not permitted` opening `/Users/aljobson/.local/share/storage-guard/build-slot.lock` for writing. Capture: `/private/tmp/music-p3e-jest.log`.
- Read-only same-inode adapter: remained queued for over 15 minutes. Its waiter alone was interrupted (exit 130); Jest never started. Other builds and the shared lock were preserved. Full-suite proof is **blocked, not passed**. Capture: `/private/tmp/music-p3e-jest-adapted.log`.
- Lightweight focused Jest used one worker and existing installed binaries. Ten unique suites / 411 tests pass across their final per-suite runs: six new export suites plus existing stem files, audio hub, dynamic i18n and app translations. Initial test-mock isolation failures were corrected with an explicit quote-request checkpoint and mock resets. Catalog tests then identified unused Japanese/Korean/Chinese singular forms and the new plural-family count; those were corrected and rerun. The final locale run reports `Test Suites: 2 passed, 2 total; Tests: 63 passed, 63 total`. Captures: `/private/tmp/music-p3e-focused.log` (contains superseded flow failures), `/private/tmp/music-p3e-regression.log` (flow/stem/icon/dynamic suites pass; contains superseded catalog failures), `/private/tmp/music-p3e-i18n-final.log` (catalog and export i18n pass). These captures are partial-suite evidence, not substitutes for the blocked full suite.
- `node scripts/gen-en-registry.mjs --check`: exit 0, `English registry is current.` Catalog length review check and `git diff --check` also pass.
- Targeted ESLint was attempted, but exited 2 because the existing installation cannot load `eslint-config-expo/flat`. Capture: `/private/tmp/music-p3e-lint.log`.

No commit, push, publication, package install, native build, device, simulator or ADB action occurred. No new worktree or preview was created, and no worktree was retired. The shared installed environment and other chats' work remain intact. A process-list diagnostic was also denied by the sandbox; read-only `lsof` confirmed the build lock was occupied. The 500-line exception is limited to existing locale/review data files. The dedicated flow is the plan's expressly allowed alternative, not an unapproved scope change.
