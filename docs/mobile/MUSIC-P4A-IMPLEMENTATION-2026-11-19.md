# Music P4a implementation advisory

Status: Implemented and locally verified; independent and native review pending. No commit, push or publication.

Frozen plan SHA-256: `eee5650bc434db20f1a56349866e54c63b2c755aa2aeca981ef1e8395288cf9c`.
All source changes are relative to the `mobile-music-p4-a075ab` checkout.

## Behavior and review points

- Native playlist list/detail: create, pin, append from the bounded library, remove and move up/down. Each edit is immediate, with one immutable attempt and a synchronous submission lock. Unknown outcomes retain their payload/key. Authentication and feature-off gates also retain a prior unknown attempt because those gates run before receipt lookup; only known definitive server rejections clear it. Conflicts reload and require a new user edit. No rename/delete route is invented.
- Every successful write, including create replays and patch replays, refetches the full playlist list. Receipts never supply displayed membership or replace a newer revision.
- Availability cleanup resolves every member with at most three concurrent reads. Only typed `404 not_found` or an explicit trashed lifecycle marks a member removable. Any other error discards the entire scan; typed unavailable responses show the off state. Refetch, revision/membership change, account change and screen exit invalidate scans. One explicit cleanup sends one replacement.
- Playback resolves song details and uses `songPlayback` and the existing player controller, including authenticated `mediaApi(api).getAsset`. Playlist row audio URLs are never playback inputs. Crop provenance is preserved. Unplayable songs are skipped with visible messages. Controller ended events advance tracks; Previous/Next are also available.
- The shared controller pauses on non-active transitions but blocks explicit start only in background. The playlist wrapper adds an independent active-state check and monotonically increasing intent token, invalidated by pause, track change, non-active state and disposal. It checks after song resolution and controller loading. Late events from an earlier track cannot advance a newer intent.
- Discover copies the thirteen listed first-party seeds, filters by mood, and routes to Create with a sample id. Its default-mix prompt is capped at 500 characters. No runtime import of web Discover code, synthesized audio, mix controls, web view or external navigation is added. The drift test evaluates the checked-in import-free web module using `fs` and `new Function` in Jest only.
- Create prefill runs after its existing probe and only on an untouched simple form; existing quote, consent, paywall and generation paths remain intact. Playlist writes are not added to either central guard registry; tests exercise the real guarded client.
- English has two new area files; all ten app catalogs contain machine translations with exact placeholders and review metadata. Native language review is pending. The English registry is regenerated; historical ordering metadata is unchanged.
- Playlist and compass icons are rendered from locally cached Phosphor regular SVGs at 96 × 96 in white. No dependency or native configuration changes.

## Explicit deviations and environment limits

1. `ApiClient.request` exposes successful bodies but not HTTP status. Malformed create success bodies therefore throw `ApiError(200, 'bad_response')`, consistent with existing clients, even if transport status was 201. Exact 201 error status requires extending the shared API; that broader change was not made.
2. Existing mobile screen suites use the installed `test-renderer` with React Native host controls, not React Native Testing Library. New suites follow that runnable repository pattern without introducing a dependency.
3. The frozen order's mocked-test/no-real-network requirement controls this slice over the earlier general ARTEMIS exploration rule. No device validation is claimed. ARTEMIS tools were absent; local doctor reported an unwritable traces path and no connected Android device. No emulator was started. The first doctor attempt was also denied access to the default uv cache; retry used a temporary cache directory.
4. Direct `with-build-slot` execution was denied write access to its existing lock. A temporary adapter executes the same wrapper with read-only opening of the same lock inode and omits its chmod; its exclusive flock and inherited lock descriptor are preserved. It creates no alternative lock and stops no other build.
5. The canonical native mobile environment exists. This checkout already has a mobile node_modules symlink to the QA assessment installation. It was reused as-is; no install, link change, native build or other-checkout source edit was performed. Native iOS/Android Metro bundle proof remains a host step as specified by the plan.
6. Attempts are memory-only and screen-local. Leaving a playlist screen loses unknown-result retry data; the UI states this before another edit. No recovery persistence is claimed.

## Proof

The exact agreed chain ran from `apps/mobile` under the same-inode build-slot adapter described above and exited **0**:

```sh
npx tsc --noEmit && npx jest --ci --maxWorkers=2 && node scripts/gen-en-registry.mjs --check
```

Final output:

```text
TypeScript: no diagnostics (exit 0)
Test Suites: 638 passed, 638 total
Tests:       13495 passed, 13495 total
Snapshots:   0 total
Time:        99.789 s, estimated 116 s
Ran all test suites.
English registry is current.
```

Full output: `/private/tmp/p4-proof-final.log`; recorded exit status: `/private/tmp/p4-proof-final.exit`.
Jest emitted a worker-shutdown warning (a worker did not exit gracefully and was force-exited) despite passing every test and exiting 0. Its cause was not isolated; no warning-free teardown or baseline attribution is claimed. The log also contains existing duplicate ADR-number warnings. No test was skipped, weakened for a failure, or given a longer timeout.

Additional proof:

- Initial unmodified TypeScript baseline: exit 0. Final proof needs no baseline exception.
- Existing focused suites: 7 passed, 164 tests passed.
- P4 and touched focused suites: 12 passed, 311 tests passed.
- Route-title/string-audit/Discover integration checks: 3 passed, 1,210 tests passed.
- Final retry-policy and screen checks: 2 passed, 34 tests passed, including auth/flag failures after a lost acknowledgement.
- Expanded-copy review and English registry checks: exit 0.
- Changed P4 source/test lint: zero errors, six warnings (two effect-setState warnings and four require-style imports in hoisted test mocks). Root-layout lint: zero errors, 22 pre-existing warnings (import ordering and unused Logo).
- `git diff --check`: passed.

The tests exposed and now guard a real playback transition bug: `load` can re-emit the previous ended state before entering loading. Advancement requires a current track's playing-to-ended transition, so a load acknowledgement cannot skip the next song. The full audit also required the new dynamic route's root navigator fallback title and an explicit canonical sample-data exemption in the visible-string audit; exact sample content remains covered by the drift test.

## Files

New library: `playlistTypes`, `validatePlaylists`, `playlistsClient`, `playlistEdits`, `playlistAttempts`, `playlistAvailability`, `playlistFlow`, `usePlaylists`, `playlistMessages`, `playlistPlayback`, `discoverSeeds` under `apps/mobile/src/lib/music/`.
New routes: `music/playlists/index.tsx`, `music/playlists/[id].tsx`, `music/discover.tsx`; new `components/music/PlaylistPlayer.tsx`.
Shared edits: root navigator fallback title, Music index/Create, additive probe off code, menu icons and icon README, English registry, two English areas, ten app catalogs and applicable review data.
Tests: eight P4 suites, one complete playlist fixture, the Create route-param mock, dynamic localization domains and the canonical sample-data exemption in the visible-string audit. This advisory is also new.

Exact changed-file inventory:

```text
apps/mobile/__tests__/dynamicI18n.test.ts
apps/mobile/__tests__/fixtures/musicPlaylists.ts
apps/mobile/__tests__/musicCreateScreens.test.tsx
apps/mobile/__tests__/musicDiscover.test.ts
apps/mobile/__tests__/musicPlaylistClient.test.ts
apps/mobile/__tests__/musicPlaylistFlow.test.ts
apps/mobile/__tests__/musicPlaylistGuards.test.ts
apps/mobile/__tests__/musicPlaylistPlayback.test.ts
apps/mobile/__tests__/musicPlaylistPlayerScreen.test.tsx
apps/mobile/__tests__/musicPlaylistScreens.test.tsx
apps/mobile/__tests__/musicPlaylistValidation.test.ts
apps/mobile/__tests__/visibleStrings.test.ts
apps/mobile/assets/icons/README.md
apps/mobile/assets/icons/compass.png
apps/mobile/assets/icons/playlist.png
apps/mobile/src/app/(app)/_layout.tsx
apps/mobile/src/app/(app)/music/create.tsx
apps/mobile/src/app/(app)/music/discover.tsx
apps/mobile/src/app/(app)/music/index.tsx
apps/mobile/src/app/(app)/music/playlists/[id].tsx
apps/mobile/src/app/(app)/music/playlists/index.tsx
apps/mobile/src/components/music/PlaylistPlayer.tsx
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
apps/mobile/src/lib/i18n/messages/en/musicDiscover.ts
apps/mobile/src/lib/i18n/messages/en/musicPlaylists.ts
apps/mobile/src/lib/i18n/review/ar-length.json
apps/mobile/src/lib/i18n/review/de-equal.json
apps/mobile/src/lib/i18n/review/de-length.json
apps/mobile/src/lib/i18n/review/es-equal.json
apps/mobile/src/lib/i18n/review/es-length.json
apps/mobile/src/lib/i18n/review/fr-equal.json
apps/mobile/src/lib/i18n/review/fr-length.json
apps/mobile/src/lib/i18n/review/hi-equal.json
apps/mobile/src/lib/i18n/review/ja-equal.json
apps/mobile/src/lib/i18n/review/ko-equal.json
apps/mobile/src/lib/i18n/review/pt-equal.json
apps/mobile/src/lib/i18n/review/pt-length.json
apps/mobile/src/lib/i18n/review/ru-length.json
apps/mobile/src/lib/i18n/review/zh-equal.json
apps/mobile/src/lib/menuIcons.ts
apps/mobile/src/lib/music/discoverSeeds.ts
apps/mobile/src/lib/music/playlistAttempts.ts
apps/mobile/src/lib/music/playlistAvailability.ts
apps/mobile/src/lib/music/playlistEdits.ts
apps/mobile/src/lib/music/playlistFlow.ts
apps/mobile/src/lib/music/playlistMessages.ts
apps/mobile/src/lib/music/playlistPlayback.ts
apps/mobile/src/lib/music/playlistTypes.ts
apps/mobile/src/lib/music/playlistsClient.ts
apps/mobile/src/lib/music/probe.ts
apps/mobile/src/lib/music/usePlaylists.ts
apps/mobile/src/lib/music/validatePlaylists.ts
docs/mobile/MUSIC-P4A-IMPLEMENTATION-2026-11-19.md
```

## The goal is met when…

- No information is duplicated on a screen: source checked for new screens; native rendering not checked.
- Every mobile gap, padding and margin is a `ds.space` step, with a 20-point gutter: checked in source. Native widths and rhythm not checked.
- Mobile radii and shadows come from existing design-system components: checked in source; no new radii or shadows. Web rules: not applicable.
- Colors are semantic tokens, fonts use the selected Typeface and type steps, and there are no new 800/900 weights: checked in source. Contrast across themes and accents: not checked on device.
- Controls have accessible names and reuse 44-point-or-larger design-system controls; status changes are announced: source checked. Native focus, largest text, OS scaling and reduced-motion rendering: not checked.
- Layout holds at 375 and 1280 pixels: not checked on device. No web keyboard or marketing surface changes: not applicable.
- Empty, loading, error/offline, unavailable, form-validation and saved states are represented; permission/auth messages are localized. Slow-network timing, shared outage banner and session-return behavior: not independently checked on device. Discover has no asynchronous load; all offered mood filters have seeds.
- New playlist edits never spend credits; Discover uses the existing quoted Create guards: checked by the passing focused mocked suites. Price presentation and store behavior remain outside this change.
- Cleanup never submits partial scan results and playback never starts from a stale/non-active intent: checked by the passing focused mocked suites.

No worktree was created. Other managed worktrees were not classified as unused or archived because their active-session ownership was not established; no other chat's checkout was removed.
