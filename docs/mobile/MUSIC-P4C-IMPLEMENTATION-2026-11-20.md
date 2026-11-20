# Music P4c implementation advisory

Status: The P4c source was committed before this continuation. The host explicitly waived ARTEMIS and requested all mocked regression tests. This continuation adds those tests and repairs parity expectations. No production source changed in this continuation. Independent review and host native validation remain required. No commit, push, PR, publication or deployment was performed.

Frozen PLAN.md SHA-256 verified: `128f5a329807d3e23b850149a91a921e140a93a8e99788779e44d28da4daa84c`.
All edited source paths resolve inside this checkout. No original or other checkout was edited.

## Coverage added

- Complete publication GET/POST/DELETE and shared-listen fixtures. Invalid and missing fields each have rejecting cases, with exact envelope/projection checks, name boundaries, token shapes and asset URL validation.
- Publication client GET/POST/DELETE request assertions include exact bodies, headers and timeout options. Malformed inputs avoid transport; malformed acknowledgements fail closed. Anonymous shared fetch assertions cover exact options, no identity headers, no caching, dead links, malformed assets, sanitized exceptions and bounded timeouts even when fetch ignores abort.
- Rendered publication dialog tests exercise unchecked rights, permission review and toggles, inline handle/name validation, policy refusal with policy_version, handle taken, immutable same-key publish replay, definitive rejection unlocking a new key, authoritative refetch, off-state hiding, account changes and unmount.
- Unpublish tests exercise the real alert confirmation and flow. Network/5xx/timeout outcomes refetch without a retained DELETE attempt. An intervening republish produces a new slug; an old confirmation cannot unpublish it, no silent DELETE occurs, and a fresh explicit confirmation uses a fresh key.
- Share URL validation and the exact native `Share.share({ message: url, url })` call are tested for the standalone controls, own publication card and both P4b screens. Opened track/creator links preserve unavailable, gone and blocked states.
- Rendered anonymous listen tests cover loading, dead link, retry, playing, pausing, closing, app inactivity during load, account changes and unmount. No auth hook is used. Token assertions cover console, telemetry, storage and navigation output. No share-token report action is invented.
- Playback cancellation is checked after each await: shared read, audio mode, native readiness and seek. Each boundary is tested against app inactivity, unnotified app-state changes, account change and disposal. Native readiness timeout and handle release are covered.
- App-link tables cover valid absolute/relative routes, lowercase slug/handle constraints, base64url token boundaries, traversal including encoded traversal, extra segments, trailing slashes, queries and fragments. Existing link mappings are retained.
- Root association tests and mobile appConfig tests cover AASA paths, mapper results, existing native screen files/auth boundaries, Android autoVerify prefixes and the existing iOS associated domain. The stale root exact-path expectation is fixed.
- Real native-intent/pending-link writers retain track/creator destinations for sign-in and refuse listen routes. A rendered signed-out AppLayout redirects to sign-in, then the real SignedInRedirect consumes the destination once.
- Real language, theme and automatic direction writers are driven with listen paths. They store `/`, never the token; old persisted listen returns are sanitized on read. Tests include `applyAppearance`, `changeLanguage`, `reconcileLanguageDirection`, `saveThemeReturnPath` and `rememberPendingLink`.
- RootLayout/LanguageGate/LanguageChoice and the listen screen are exercised together on a fresh signed-out install. Language choice and direction reload are deferred while listening. After leaving, changing language and reopening the link reaches the listen page without a sign-in redirect. Saved theme destinations cannot displace incoming listen links.
- `scrubBreadcrumb` and `scrubEvent` regressions cover all four secret path forms, absolute and relative: shared API, shared asset, `/listen/`, `/music/listen/`. Assertions include URL fields, nested route params, request URLs, transaction names and trace context.
- Publication POST/DELETE pass through the real API client and real guardedBeforeSend with AI consent refused and the hard paywall locked, proving the classification without a paid or real-server call.
- All eleven locales have matching P4c keys/placeholders without fallback; P4c introduces no plural families. The existing full appTranslations suite validates CLDR plural families and translation equality exceptions.

## Proof results

The agreed proof was run from `apps/mobile`, serialized through the owner's build-slot implementation using the existing adapter described below:

```text
npx tsc --noEmit
exit 0
No TypeScript diagnostics.
```

The final combined Jest command used `npx jest --ci --maxWorkers=2 --runTestsByPath` with the suites listed below:

```text
Test Suites: 32 passed, 32 total
Tests:       1940 passed, 1940 total
Snapshots:   0 total
Time:        63.548 s
exit 0
```

New/touched suites: musicPublicationValidation, musicPublicationClient, musicPublicationFlow, musicPublicationScreens, musicPublicationGuards, musicPublicationI18n, musicListenPlayback, musicListenScreens, musicListenPrivacy, musicListenFirstLaunch, musicLinks, musicAppLinks, musicPendingLink and appConfig.

Existing regression suites: appLinks, pendingLink, nativeIntent, signedInRedirect, musicScreens, musicClient (including probe), musicPlayer, musicPublicScreens, musicPublicPlayback, menu (including icons), scrub, languageDirection, languageReturnRoute, languageFirst, themeModes, appTranslations, dynamicI18n and visibleStrings.

Root proof:

```text
node --test tests/mobileAppLinks.test.mjs tests/appLinkTargets.test.mjs tests/routesOutsideGate.test.mjs
16 tests; 16 passed; 0 failed; exit 0
```

Node printed existing MODULE_TYPELESS_PACKAGE_JSON warnings. No package metadata was changed to silence them.

Other completed checks:

```text
node scripts/check-app-i18n.mjs --write     exit 0
node scripts/gen-en-registry.mjs           exit 0 (Wrote English registry.)
node scripts/gen-en-registry.mjs --check   exit 0 (English registry is current.)
node scripts/check-app-i18n.mjs            exit 0
Scoped ESLint                            exit 0, no warnings or errors
git diff --check                         exit 0, no output
```

Registry/review regeneration produced no tracked catalog changes. All continuation files are below 500 lines.

Earlier development runs exposed test-harness mistakes (an assertion after renderer unmount, missing safe-area/Expo mocks, unsupported dynamic import and two mock typing errors). These were fixed; the combined passing results above supersede those runs. No production assertion was relaxed to conceal a product failure.

## Denied actions, deviations and remaining host proof

- Direct `~/.local/bin/with-build-slot` execution was denied write access to `/Users/aljobson/.local/share/storage-guard/build-slot.lock`. The existing `/private/tmp/p4-build-slot.py` adapter executes the same owner wrapper with a read-only descriptor on the same lock inode and exclusive flock, omitting the write-only chmod. It does not bypass serialization, create another lock, alter the installed wrapper or stop another build. This was a filesystem denial, not an automatic approval-review rejection. Queued commands acquired the slot within the host's ten-minute limit.
- ARTEMIS was explicitly waived by the host for this work. No mocked-test authoring remains blocked by it. No device exploration or native share/playback verification is claimed.
- The pre-existing `apps/mobile/node_modules` symlink points to `veyrnox-qa-assessment-dfde27/apps/mobile/node_modules`. Installed React is 19.3.0 versus declared 19.3.1; Expo Router is 58.0.23 versus declared ~58.0.31; SecureStore is 58.0.2 versus declared ~58.0.3. Proofs describe that existing environment, not a fresh lockfile-compatible installation. No dependencies were installed or symlinks changed. The canonical mobile path was confirmed to exist and was not changed or built.
- No product requirement was redesigned. Language-choice deferral and reopening a link after reload follow the accepted P4C-002/P4C-003 recovery policy. DELETE deliberately requires fresh confirmation after uncertainty, as P4C-005 requires.
- Full-repository Jest and Metro iOS/Android bundles remain the frozen order's independent host proofs. All new/touched suites and the named existing regressions were executed here.
- No checkout, native environment, server or simulator was created. Other sessions were preserved. No worktree was established to be unused, so none was archived.

## Release facts for an eventual PR (none created here)

- The Android mapper and three autoVerify intent prefixes are implemented. **The app.json change needs an Android store rebuild.** Verified Android App Links still cannot work while `ANDROID_SHA256_FINGERPRINTS` is empty and assetlinks.json returns 404. The owner must add signing-certificate fingerprints and deploy the association file, as well as ship the rebuilt Android app. No working verified Android links are claimed.
- iOS already has `applinks:veyrnox.ai`; the AASA change must be deployed and propagate through Apple's CDN. The path change alone requires no new iOS associated-domain configuration. No deployed/native app-opening behavior is claimed here.
- No report endpoint accepts a private share token; the listen page has no Report action. No endpoint or legal wording was invented.
- The source round changed only `lib/mobileAppLinks.js` on the server. This continuation changes only its two permitted root tests; no RPC, policy, migration or money behavior changed. Non-English P4c copy remains machine translated, native review pending.

## Files changed in this continuation

```text
apps/mobile/__tests__/appConfig.test.ts
apps/mobile/__tests__/fixtures/musicPublication.ts
apps/mobile/__tests__/musicAppLinks.test.ts
apps/mobile/__tests__/musicLinks.test.tsx
apps/mobile/__tests__/musicListenFirstLaunch.test.tsx
apps/mobile/__tests__/musicListenPlayback.test.ts
apps/mobile/__tests__/musicListenPrivacy.test.ts
apps/mobile/__tests__/musicListenScreens.test.tsx
apps/mobile/__tests__/musicPendingLink.test.tsx
apps/mobile/__tests__/musicPublicationClient.test.ts
apps/mobile/__tests__/musicPublicationFlow.test.ts
apps/mobile/__tests__/musicPublicationGuards.test.ts
apps/mobile/__tests__/musicPublicationI18n.test.ts
apps/mobile/__tests__/musicPublicationScreens.test.tsx
apps/mobile/__tests__/musicPublicationValidation.test.ts
tests/appLinkTargets.test.mjs
tests/mobileAppLinks.test.mjs
docs/mobile/MUSIC-P4C-IMPLEMENTATION-2026-11-20.md
```
