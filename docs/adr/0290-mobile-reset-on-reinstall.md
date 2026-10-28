# ADR-0290: A fresh mobile install starts fresh

Status: Accepted for implementation (TestFlight)

## Decision

The custom `apps/mobile/index.js` runs a synchronous install reset before requiring Expo Router. A sandbox document file, `veyrnox.install.v1`, contains `{v:1,state:'pending'|'complete',installId}`. The sandbox is removed on uninstall; iOS Keychain items may survive. A valid complete marker preserves state. A pending marker resumes the wipe. Missing/invalid markers require a new random install id and a pending write verified by synchronous read-back before any wipe. Existing TestFlight installations have no marker and intentionally reset once on update: language selection, sign-in, consent (when analytics is enabled), then welcome.

SDK 58 SecureStore has synchronous get/set but only asynchronous deletion. Each fixed key is synchronously overwritten with an empty string (all current readers treat it as absent/falsy), then asynchronously deleted. This precedes theme/i18n module evaluation. The sandbox `appStorage` welcome file is also synchronously removed, so signing back into the same account cannot suppress onboarding. Complete is written only after successful cleanup. No native build or dependency is added.

The authoritative exported list is `INSTALL_RESET_KEYS` in `src/lib/installReset.ts`:

- `veyrnox_refresh_token`
- `veyrnox.welcome.seen.v2`
- `veyrnox.language.v1`, `veyrnox.language.direction.v1`
- `veyrnox.theme`, `veyrnox.accent`, `veyrnox.typeface`, `veyrnox.textSize`, `veyrnox.theme.return`
- `veyrnox.analytics.consent.v1`, `veyrnox_push_pref`
- `veyrnox.celebrate.submissions.v1`, `veyrnox.celebrate.owner.v1`, `veyrnox.celebrate.first.v1`, `veyrnox.celebrate.video.v1`, `veyrnox.celebrate.onboarding.v1`
- `veyrnox.vibe.v1`, `veyrnox.reviewAsk.v1`, `veyrnox.editorPrivacyNotice.v1`

`INSTALL_KEPT_KEYS` explicitly retains `veyrnox_push_device`, a random device id rather than personal data. Paywall seen/depleted, AI consent and Oddlings keys remain per-account state. Source inspection also found a fixed Oddlings migration key, `veyrnox.oddlings.legacy.v1`, accessed through an injected SecureStore adapter. It is explicitly kept as an ownership fence: removing it could permit another account to claim surviving legacy data. This qualifies the work order's assumption that all Oddlings keys are per-user. MFA is the exception: persisted enrolment now includes the verified marker's install id, so old unenrolled flags cannot open the gate if the remote check fails or times out. An unavailable install id means unknown enrolment (fail closed).

## Failure and session handling

A pending write/read-back failure never wipes, never writes complete and retries on the next launch, preserving today's behavior. Failed deletion leaves pending and retries. A native synchronous overwrite failure cannot guarantee absence for that slot; startup still continues and reports failure, rather than pretending cleanup succeeded. If writing complete repeatedly fails after a successful wipe, subsequent launches repeat the idempotent wipe and can sign out a session established between those launches. This edge is accepted; a pending-write failure cannot repeatedly sign someone out.

At most one sanitized failure per launch (`install_reset_failed`, step `marker_write`, `marker_read` or `delete`) is buffered before Sentry initialization. The layout flushes it immediately after successful initialization and installs the reporter for later asynchronous failures. No values, keys, native errors or tokens enter the report. Development/no-DSN builds retain the existing reporting guard.

A discarded refresh token is kept only in module memory with a 30-second lifetime from reset. After startup, an anonymous connectivity probe must succeed before exchanging it. Only the resulting access token is used, only for `POST /auth/v1/logout?scope=local`; the rotated refresh token is ignored. It never reaches AuthProvider, storage, push registration or other authenticated APIs. Success, failure, offline detection or deadline drops the token; there is no durable retry. Normal phone sign-out also uses `scope=local`, preserving web and other-device sessions.

## Push delivery and accepted limitation

Push preference resets to off; registration still waits for opt-in. Push registration code is unchanged. The frozen work order assumes iOS notification permission is forgotten after deletion; this change does not implement an OS permission reset. The Expo token may survive reinstall. When push is enabled again, `0348_push_tokens.sql` uses `ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id`, moving the row to the current account (verified by source inspection and regression test).

For the one-time update reset, permission can remain granted and the old account's server row is not cleaned up. It may continue delivering notifications until push is re-enabled (moving ownership) or the same account signs in. This is an accepted TestFlight limitation. Server generation guards and server changes are out of scope.

## Verification and plan interpretation

Jest covers entry ordering with real theme/i18n readers in an isolated registry while async deletion remains pending, reset/resume/failure markers, sandbox welcome clearing for the same account, MFA fail-closed behavior, real Sentry initialization gating, local logout and expiry. A mounted AuthProvider stays signed out throughout discarded-session revocation and never persists either old or returned credentials. A TypeScript AST inventory resolves fixed key constants, templates and SecureStore method declarations through aliases/adapters; unresolved dynamic expressions require explicit review.

R7's explicit retention of the random push device id takes precedence over R4's earlier deletion list. R1's custom entry takes precedence over the older test wording placing the reset itself in the layout; the layout's first import is the reset reporting module, but execution occurs in the entry. ADR number rechecked against GitHub main (through 0289) and open PRs (none returned) on 2026-10-28; 0290 remains available.
