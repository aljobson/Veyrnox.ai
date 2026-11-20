# Music P4b implementation advisory

Status: Implemented and locally verified; independent and native review pending. No commit, push or publication.

Frozen work order SHA-256: `2f5f81115be3a4d0bae18894a889390ac7e9cb0ae008028788c8c30ad163d8e8`.
The supplied plan file matched that hash. All edits are relative to the current
`mobile-music-p4-a075ab` checkout. No commit, push, publication, migration, server
change, dependency install or native configuration change was performed.

## Implemented behavior

- Native Explore, public track, creator, track/comment report and blocked-creators
  screens. Explore is linked from the Music hub with a distinct Phosphor
  `users-three` icon. Tracks are reachable through genre rows, rails and creators.
- Content reads use only authenticated explore mirrors. `blocks_unavailable`
  clears every mounted public surface and cancels playback. `not_found` is a
  route-specific gone/unavailable result, not a global Music-off signal.
- Separate authenticated social reads establish ownership. Until they succeed,
  creator Report/Block/Follow controls remain hidden. Reaction toggling/clearing,
  follows and unfollows use immutable idempotent attempts.
- Approved comments require a valid opaque `author_id` on every row. A malformed
  page is rejected whole. Paging revalidates the mirror before and after the page,
  including a rejected page; malformed initial track responses revalidate once.
  Pending/rejected own comments are exempt from the author identity requirement.
- Comments support replies, a 1–1000 character composer, an optional current
  playback timestamp in 0–600 seconds, moderation-pending feedback, withdrawal,
  reports and paging. Report details are 3–500 characters with the five server
  categories. Successful reports offer block and then unblock.
- One account-scoped in-memory block revision fences content, comment pages,
  ownership reads and playback. Every acknowledged block/unblock increments it.
  Blocks synchronously remove affected rows from all mounted flows, replace an
  affected track/profile with its blocked state, remove the actor's comments
  from every loaded page of other tracks, and clear a reply target with a notice.
  Focus and block changes revalidate, preserving the depth of already-loaded comment pages. Prior-revision content is discarded; a
  same-account off response still closes the surface. Prior-account results
  cannot change the new account's state.
- Block/unblock use only opaque actor UUIDs and the naturally idempotent API.
  Every acknowledgement refreshes the block list. The list is an ephemeral
  server projection, not a device-local substitute for server enforcement.
- Public playback uses the established native PlayerPort, a monotonic intent
  token, and active-state checks after the mirror, audio-mode setup, native load
  and seek, including recovery. It pauses/releases on every non-active state,
  a block of the playing creator, account change and screen blur. Pending starts are
  invalidated by any block revision; blocking an unrelated commenter leaves
  already-playing creator audio running. It sends the anonymous relative
  asset route to the native player without an authorization header; no presigned
  URL is obtained, persisted or logged by application code. Pending play-count requests are aborted on pause, block, account change or disposal.
  Automatic recovery does not add a play count. A plays-off response disables further count attempts
  throughout the mounted screen visit, including blur/refocus.
- Network, malformed-success, 5xx and 429 write outcomes retain the original key
  and payload. Known definitive rejections clear them. Retry-After gates report
  replay. Attempts survive blur while mounted and clear on account change.
- New copy is present in English and ten machine-translated catalogs. Time and
  retry copy uses the existing plural helper and each locale's CLDR forms.
  Equality and expanded-copy review records are updated; native review is pending.

## Guard classification rationale (for the future PR)

Comments contain user-written text for human discussion and administrator
moderation. This text is sent to our own Music server, not to an AI provider;
submitting it triggers no generation and spends no credits. Reactions, follows,
reports and play counts also send only discussion/moderation state to our own
server. None is added to CONTENT_POSTS or PAID_ACTIONS. The new guard test invokes
the real ApiClient and guardedBeforeSend with consent refused and the hard
paywall locked, and verifies that these calls send without a consent prompt or
paywall rejection. No real server or paid call is used in tests.

## Proof

The agreed command ran from this checkout's `apps/mobile`, serialized through
with-build-slot using the same-inode adapter described below:

```sh
npx tsc --noEmit
```

No TypeScript diagnostics; **exit 0**. It was followed in the same slot by:

```sh
npx jest --ci --maxWorkers=2 --runTestsByPath \
  __tests__/musicPublicValidation.test.ts __tests__/musicPublicClient.test.ts \
  __tests__/musicPublicFlow.test.ts __tests__/musicPublicPlayback.test.ts \
  __tests__/musicPublicGuards.test.ts __tests__/musicPublicScreens.test.tsx
node scripts/gen-en-registry.mjs --check
```

```text
TypeScript exit: 0
Test Suites: 6 passed, 6 total
Tests:       142 passed, 142 total
Snapshots:   0 total
Time:        22.585 s, estimated 28 s
English registry is current.
```

Combined command exit: **0**. Log: `/private/tmp/p4b-proof-final.log`.
Together with the six touched regression suites below, **12 suites and 1,617 tests
passed**. Full Jest and native Metro/device proofs remain host steps; no claim
of a full-suite or device pass is made.

English registry check, expanded-copy review check and `git diff --check` pass.
Final scoped mobile ESLint: exit 0, zero errors and one warning about the effect
that clears the composer after a successful submission. An invocation from the
repository root failed with an ESLint 10 / React-plugin API mismatch; running
from apps/mobile used the installed mobile toolchain and passed.

Touched regression proof: six suites passed, 1,475 tests passed, zero snapshots,
exit 0 (101.864 s): appTranslations, dynamicI18n, visibleStrings, featureIcons,
musicPlaylistScreens and musicClient. No tests were skipped or weakened.

Two initial TypeScript attempts reported four errors in the social type guard.
The viewer fields are now extracted before the counts guard narrows the value;
the final proof above verifies that correction.

## Denied / blocked actions and deviations

1. ARTEMIS MCP tools were absent from this session's tool inventory. The local
   diagnostic fallback, `uv run artemis doctor` in the configured ARTEMIS project,
   failed before diagnosis: access to `~/.cache/uv/sdists-v9/.git` was denied.
   Device exploration therefore could not precede test authoring. The work order's
   explicit mocked-test scope was implemented using the repository's existing
   Jest/test-renderer setup. No device behavior or ARTEMIS verification is claimed.
2. Direct `with-build-slot` execution was denied write access to its existing
   lock file. The existing `/private/tmp/p4-build-slot.py` adapter opens that same
   lock inode read-only and omits chmod, retaining exclusive flock and the inherited
   descriptor. It creates no alternate lock and stops no other build. The requested
   TypeScript proof and final focused suites run under that adapter. Lightweight focused checks run
   with two workers under the owner's lightweight-check exception; no full suite
   or native build is started here.
3. Process listing (`ps`) was denied. Read-only `lsof` established that another
   checkout held the shared slot. No other session was signalled or modified.
4. The canonical native mobile environment exists. This checkout's existing
   mobile node_modules symlink was reused unchanged. No source in the canonical
   environment or the symlink target was edited. Metro iOS/Android bundle proofs,
   native accessibility review and real HTTP 302 audio playback remain host checks,
   as designated by the frozen plan. The native redirect strategy is implemented,
   but device compatibility is not asserted without those checks.
5. ApiClient exposes successful bodies without HTTP status. Invalid success
   bodies throw `ApiError(200, 'bad_response')`, including a malformed 201 body,
   consistent with existing mobile clients. No shared transport change was made.
6. Attempts and block projections are memory-only. Blur preserves attempts while
   the screen remains mounted; unmount/process termination drops them. The server
   remains authoritative. This does not claim disk persistence across app restarts.
7. There is no creator-profile report endpoint in the server contract. Creator and
   rail surfaces offer reports for their tracks through the track-report form;
   blocking applies to the creator. No invented server route is used.

No product fallback to anonymous content, local blocking, web views or link-outs
was introduced. No new worktree or preview was created. Existing worktrees were
not classified as unused or archived because ownership by other active sessions
was not established; all were preserved.

## Files changed

All paths are relative to this checkout (71 files):

```text
apps/mobile/__tests__/appTranslations.test.ts
apps/mobile/__tests__/dynamicI18n.test.ts
apps/mobile/__tests__/featureIcons.test.ts
apps/mobile/__tests__/fixtures/musicPublic.ts
apps/mobile/__tests__/musicClient.test.ts
apps/mobile/__tests__/musicPlaylistScreens.test.tsx
apps/mobile/__tests__/musicPublicClient.test.ts
apps/mobile/__tests__/musicPublicFlow.test.ts
apps/mobile/__tests__/musicPublicGuards.test.ts
apps/mobile/__tests__/musicPublicPlayback.test.ts
apps/mobile/__tests__/musicPublicScreens.test.tsx
apps/mobile/__tests__/musicPublicValidation.test.ts
apps/mobile/assets/icons/README.md
apps/mobile/assets/icons/users-three.png
apps/mobile/src/app/(app)/_layout.tsx
apps/mobile/src/app/(app)/music/blocked.tsx
apps/mobile/src/app/(app)/music/creator/[handle].tsx
apps/mobile/src/app/(app)/music/explore.tsx
apps/mobile/src/app/(app)/music/index.tsx
apps/mobile/src/app/(app)/music/report-comment.tsx
apps/mobile/src/app/(app)/music/report-track.tsx
apps/mobile/src/app/(app)/music/track/[slug].tsx
apps/mobile/src/components/music/PublicAttemptNotice.tsx
apps/mobile/src/components/music/PublicBlocked.tsx
apps/mobile/src/components/music/PublicComments.tsx
apps/mobile/src/components/music/PublicPlayer.tsx
apps/mobile/src/components/music/PublicRailRow.tsx
apps/mobile/src/components/music/PublicReportForm.tsx
apps/mobile/src/components/music/PublicShell.tsx
apps/mobile/src/components/music/PublicSocial.tsx
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
apps/mobile/src/lib/i18n/messages/en/musicPublic.ts
apps/mobile/src/lib/i18n/review/ar-equal.json
apps/mobile/src/lib/i18n/review/ar-length.json
apps/mobile/src/lib/i18n/review/de-equal.json
apps/mobile/src/lib/i18n/review/de-length.json
apps/mobile/src/lib/i18n/review/es-equal.json
apps/mobile/src/lib/i18n/review/es-length.json
apps/mobile/src/lib/i18n/review/fr-equal.json
apps/mobile/src/lib/i18n/review/fr-length.json
apps/mobile/src/lib/i18n/review/hi-equal.json
apps/mobile/src/lib/i18n/review/hi-length.json
apps/mobile/src/lib/i18n/review/ko-equal.json
apps/mobile/src/lib/i18n/review/pt-equal.json
apps/mobile/src/lib/i18n/review/pt-length.json
apps/mobile/src/lib/i18n/review/ru-equal.json
apps/mobile/src/lib/i18n/review/ru-length.json
apps/mobile/src/lib/menuIcons.ts
apps/mobile/src/lib/music/blocksClient.ts
apps/mobile/src/lib/music/probe.ts
apps/mobile/src/lib/music/publicAttempts.ts
apps/mobile/src/lib/music/publicClient.ts
apps/mobile/src/lib/music/publicFlow.ts
apps/mobile/src/lib/music/publicMessages.ts
apps/mobile/src/lib/music/publicPlayback.ts
apps/mobile/src/lib/music/publicSession.ts
apps/mobile/src/lib/music/publicTypes.ts
apps/mobile/src/lib/music/usePublicMusic.ts
apps/mobile/src/lib/music/validateBlocks.ts
apps/mobile/src/lib/music/validatePublic.ts
docs/mobile/MUSIC-P4B-IMPLEMENTATION-2026-11-20.md
```

## The goal is met when…

- No piece of information appears twice on one screen: source reviewed; native
  rendering not checked. User-authored repeated content is not deduplicated by text.
- Mobile spacing uses ds.space and a 20-point screen gutter: checked in source.
  Radii, shadows and typography come from the existing shared UI components.
- Rhythm is intentional and the primary action is clear: source reviewed; native
  screen-density review not checked.
- Colors use semantic tokens, action/error roles use the existing shared controls,
  text uses the selected Typeface and no new numeric font sizes or 800/900 weights
  were added: checked in source. Theme/accent contrast is not checked on device.
- Every control has an accessible name and uses shared touch targets; loading,
  errors and mutation results use announcements/live regions: source reviewed.
  Largest text size, OS scaling, focus and 375/1280-pixel layouts are not checked.
- Reduced motion uses the existing shared controls, with no new animation: source
  checked; native reduced-motion rendering is not checked.
- Loading, empty, unavailable/gone, error/offline, validation, pending and success
  states exist: mocked coverage; native timing and slow-network layout not checked.
  The existing app-level outage/session behavior is unchanged and not revalidated.
- Web layout/keyboard, marketing visuals and price displays: not applicable.
  There are no paid actions or new credit prices in this slice.
- No blocked actor's loaded comments or stale audio intent survives an acknowledged
  block, and unfiltered comment pages are never displayed: mocked regression proof;
  test counts above are the local evidence, not production or device proof.
