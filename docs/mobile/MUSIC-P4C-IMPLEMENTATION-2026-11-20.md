# Music P4c implementation advisory

Status: Source implemented; frozen work order **not fully complete**. New regression tests and parity-test updates are blocked by the session-provided ARTEMIS prerequisite. Independent review, complete test coverage and native validation remain required. No commit, push, PR or publication.

Frozen PLAN.md SHA-256 was verified as `128f5a329807d3e23b850149a91a921e140a93a8e99788779e44d28da4daa84c`.
All source edits resolve relative to this checkout. No source in an original/other checkout was edited.

## Changes for independent review

- Song detail has a native publication status card and modal. It probes publication availability, validates handle/name, reviews comment/remix permissions, requires the web's rights/terms declaration and publishes the current immutable version. Commercial-use copy follows the web. Policy refusal and handle-taken responses have distinct translated messages.
- Strict read and receipt validators follow the actual RPC projections: GET includes published_at; POST receipts do not. Receipts are acknowledgements only. Every attempted write is followed by a GET, including failures. Off hides the section. These endpoints remain absent from AI-consent and paid-action registries.
- An ambiguous POST retains its immutable input and key. Definitive 4xx responses other than 408/429 clear it. DELETE never retains a replay key: after any failure the flow refetches; a published result requires another explicit alert confirmation with a fresh key. Confirmation also checks the locally confirmed slug, so an outdated dialog cannot target a newer locally loaded publication. Flow disposal rejects late state updates.
- Native Share buttons build only validated production track/creator URLs. They appear on own published song detail and the existing P4b track/creator screens. Existing private-share creation is unchanged.
- `/music/listen/[token]` lives outside the signed-in route group. Its fetch has no authorization or identity headers, uses no-store/omit credentials, validates the relative asset route and sanitizes transport exceptions. Playback follows the anonymous asset redirect in the native player, with downloadFirst false; it never resolves, logs or persists the presigned URL in JS. Public and private players share bounded native readiness logic. Play intent is checked after each await; inactive app state, account changes and screen departure cancel playback.
- The listen screen has no Report action: the audited report contract requires a public slug, and no report endpoint accepts a private-share token. No endpoint was invented.
- New link mappings reject malformed identifiers, traversal, query strings, fragments and extra segments. Track/creator links use the existing pending-link and sign-in flow, retaining P4b blocked/unavailable/gone handling. Listen routes are excluded from pending-link and language/theme return-route writers. Stored listen returns are sanitized to `/` on read too.
- First-launch language choice and automatic direction repair are deferred while listening. Leaving the page resumes the existing language flow. An unavoidable explicit language/theme reload stores `/`; the person must reopen the secret link. A saved theme destination cannot replace an incoming listen link.
- Telemetry scrubbing covers absolute/relative shared API, asset, `/listen/` and `/music/listen/` paths, plus nested breadcrumb/event route parameters and transaction strings.
- 27 new strings are present in English and all ten other app locales. Non-English text is machine translated; native review pending. The English registry and expanded-copy review data are regenerated. Three distinct Phosphor regular icons were rendered from the existing cached package.

## Proofs actually run

The agreed command ran from this checkout's `apps/mobile`, under the existing same-inode build-slot adapter:

```text
npx tsc --noEmit
exit 0
No TypeScript diagnostics.
```

The final run waited for another build; its only wrapper output was:

```text
Waiting for the other heavy build to finish; existing work is preserved.
```

That run subsequently completed successfully, including the final source changes. The adapter executes the owner's `with-build-slot` code using read-only access to the same lock inode and exclusive flock; it does not create a separate lock or bypass serialization.

Existing Jest regression runs, with `--ci --maxWorkers=2` and the same build-slot adapter:

1. P4b playback/screens, appLinks, appConfig, scrub, languageDirection, appTranslations, dynamicI18n and visibleStrings: 8 suites passed, 1 failed; 1516 tests passed, 1 failed. The new flow's internal `message` codes triggered the visible-English scanner. The source property was renamed to `issue` and the scanner was rerun in batch 2.
2. visibleStrings, musicScreens, musicPlayer, pendingLink, nativeIntent, menu, languageReturnRoute, languageFirst and themeModes: **9 suites passed; 1420 tests passed; exit 0**. This clears the scanner failure. These existing tests do not provide the new P4c-specific coverage requested by the plan.

Root command:

```text
node --test tests/mobileAppLinks.test.mjs tests/appLinkTargets.test.mjs tests/routesOutsideGate.test.mjs
15 tests; 14 passed; 1 failed; exit 1
```

The failure is `apple file shape and paths`: its exact expected list has not been updated with `/music/tracks/*`, `/music/creators/*`, `/listen/*`. This is unresolved, not a passing parity proof. Test files were not modified pending the prerequisite decision below.

Other checks:

- `node scripts/gen-en-registry.mjs --check`: `English registry is current.`; exit 0.
- `node scripts/check-app-i18n.mjs`: all ten locale review files current; exit 0.
- Scoped ESLint: exit 0, no errors. Initial source scope reported 4 warnings. Final root-layout/listen/publication/link scope reported 19 warnings: 16 existing root-layout import-order warnings and 3 flow-recreation/reload dependency warnings. No lint rules were weakened.
- `git diff --check`: exit 0, no output.
- Full Jest and Metro iOS/Android bundles were not run; they remain the work order's independent host proofs. No native playback or share-sheet behavior is claimed verified on a device.

Validation environment caveat: the checkout already had `apps/mobile/node_modules` symlinked to the `veyrnox-qa-assessment-dfde27` installation. No dependency installation, symlink change or new shared environment was made. Its installed lock metadata differs from this checkout, including React 19.3.0 versus 19.3.1, Expo Router 58.0.23 versus 58.0.31 and SecureStore 58.0.2 versus 58.0.3. Thus the passing compiler and existing-suite results describe that pre-existing installation, not a clean locked install. The canonical mobile path was confirmed to exist; it was not changed or built.

## Blocked actions and proposed deviations

The session-provided AGENTS.md says: “Before writing any test code, you must use the ARTEMIS MCP tools to interactively run and explore the target application.” No ARTEMIS tools were available. The prescribed local doctor first failed on its unwritable uv cache; rerunning offline with a temporary cache worked and reported an unwritable ARTEMIS trace directory and no connected Android device. No emulator was booted and no native environment was installed.

A question was sent requesting a waiver to author mocked Jest/contract tests from the audited source. No answer was received before this report. **No new test code or test updates were authored.** Consequently the specified publication/dialog/replay/guard, shared-listen/privacy/first-launch, share-sheet, strict-link and extended parity tests remain missing. Proposed deviation: explicitly waive ARTEMIS for these mocked tests and add them, or restore ARTEMIS with an owner-selected device and perform the required exploration first. Do not treat the work order as complete until that coverage and the stale parity expectation are resolved.

Direct `~/.local/bin/with-build-slot` execution was denied write access to its shared lock outside the sandbox. The pre-existing read-only adapter successfully serialized and ran the proofs without changing permissions or stopping another build. This was a filesystem denial, not an automatic approval-review rejection.

The literal “files under 500 lines” cannot apply to the existing monolithic locale catalogs/review files: they already exceed that limit. They retain their established structure with small additive edits; every new implementation source file is below 500 lines. Proposed exception: apply the limit to new code and avoid an unrelated catalog redesign.

## Notes for an eventual PR/release (none created here)

- Android mapper and three autoVerify intent prefixes are implemented. **The app.json change needs an Android store rebuild.** Verified Android App Links still cannot work because `ANDROID_SHA256_FINGERPRINTS` is empty and assetlinks.json returns 404. The owner must add the signing-certificate fingerprints and deploy the server association file, in addition to shipping the rebuilt Android app. No working verified Android links are claimed.
- iOS already has `applinks:veyrnox.ai`; these path additions require the AASA server change to be deployed and propagated through Apple's CDN, with no new iOS associated-domain configuration. App-opening behavior is not claimed before deployment/native verification.
- Only `lib/mobileAppLinks.js` changed on the server. No publication policy, RPC, migration, report route or money behavior changed.
- No worktree, dependency environment, Metro/mock server or simulator was created. Other sessions were preserved. No checkout was established to be unused, so none was archived.

## Files changed (relative to this checkout)

```text
apps/mobile/app.json
apps/mobile/assets/icons/README.md
apps/mobile/assets/icons/broadcast.png
apps/mobile/assets/icons/globe-x.png
apps/mobile/assets/icons/share-network.png
apps/mobile/src/app/(app)/music/[id].tsx
apps/mobile/src/app/(app)/music/creator/[handle].tsx
apps/mobile/src/app/(app)/music/track/[slug].tsx
apps/mobile/src/app/_layout.tsx
apps/mobile/src/app/music/listen/[token].tsx
apps/mobile/src/components/LanguageGate.tsx
apps/mobile/src/components/music/MusicLinkShare.tsx
apps/mobile/src/components/music/MusicPublication.tsx
apps/mobile/src/lib/appLinks.ts
apps/mobile/src/lib/i18n/messages/app/ar.ts
apps/mobile/src/lib/i18n/messages/app/de.ts
apps/mobile/src/lib/i18n/messages/app/es.ts
apps/mobile/src/lib/i18n/messages/app/fr.ts
apps/mobile/src/lib/i18n/messages/app/hi.ts
apps/mobile/src/lib/i18n/messages/app/ja.ts
apps/mobile/src/lib/i18n/messages/app/ko.ts
apps/mobile/src/lib/i18n/messages/app/pt.ts
apps/mobile/src/lib/i18n/messages/app/ru.ts
apps/mobile/src/lib/i18n/messages/app/zh.ts
apps/mobile/src/lib/i18n/messages/en.ts
apps/mobile/src/lib/i18n/messages/en/musicPublication.ts
apps/mobile/src/lib/i18n/review/de-length.json
apps/mobile/src/lib/i18n/review/es-length.json
apps/mobile/src/lib/i18n/review/fr-length.json
apps/mobile/src/lib/i18n/review/hi-length.json
apps/mobile/src/lib/i18n/review/pt-length.json
apps/mobile/src/lib/i18n/review/ru-length.json
apps/mobile/src/lib/languageDirection.ts
apps/mobile/src/lib/languageTransition.ts
apps/mobile/src/lib/menuIcons.ts
apps/mobile/src/lib/music/listenPlayback.ts
apps/mobile/src/lib/music/musicLinks.ts
apps/mobile/src/lib/music/playbackReady.ts
apps/mobile/src/lib/music/publicPlayback.ts
apps/mobile/src/lib/music/publicationAttempts.ts
apps/mobile/src/lib/music/publicationClient.ts
apps/mobile/src/lib/music/publicationFlow.ts
apps/mobile/src/lib/music/sharedListenClient.ts
apps/mobile/src/lib/music/validatePublication.ts
apps/mobile/src/lib/music/validateShared.ts
apps/mobile/src/lib/pendingLink.ts
apps/mobile/src/lib/scrub.ts
apps/mobile/src/lib/secretRoutes.ts
apps/mobile/src/theme.ts
docs/mobile/MUSIC-P4C-IMPLEMENTATION-2026-11-20.md
lib/mobileAppLinks.js
```
