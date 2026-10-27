# ADR-0271: Consent-first mobile product analytics

Status: Active

Date: 2026-10-27

Related: ADR-0099, ADR-0106, ADR-0264, ADR-0270.

## Decision

Mobile analytics are off by default. A build without an `EXPO_PUBLIC_POSTHOG_KEY`
starting with `phc_` has no analytics prompt, Account row, runtime SDK import or
client. The owner sets the production public key on EAS after merge.

SecureStore holds `veyrnox.analytics.consent.v1`, containing
`{ "v": 1, "choice": "granted" | "denied", "at": <milliseconds> }`.
Unreadable and malformed records are undecided. This device preference survives
sign-out and account deletion. Storage failures never imply consent. A failed
Allow write leaves the choice undecided and displays a retry message without
starting collection. Decline blocks the current client immediately and continues
navigation even if saving fails; an unsaved initial choice is asked again next launch.
If an older grant remains on disk after a failed overwrite, the next launch can
still read that grant. An in-memory decline cannot guarantee revocation across
process restarts when durable storage fails.

Inside the signed-in two-factor gate, FirstRunGate asks before Vey's welcome.
Existing users are asked on their next launch. Allow and Decline have equal
secondary button styling. Both continue to welcome if unseen, otherwise home.
There is no bypass control; Android back leaves the choice undecided. A shared
launch signal suppresses paywall and check-in components before the asynchronous
gate read, throughout consent and native Privacy Policy navigation, and until
welcome completes. The gate recomputes on account changes and releases suppression
on sign-out; stale reads from the previous account cannot redirect. Language
selection runs earlier, outside this flow.

Account → Privacy choices exposes Allow/Decline chips and the native policy
link. Both screens explain that events are linked to the account ID, rather than
the person’s name or email. The copy is translated in all eleven catalogs, with
German du, Spanish tú,
French vous and Brazilian Portuguese under the app's existing `pt` code.
The frozen English order is untouched. Generated legal documents are unchanged.

## Collection and identity

Only `src/lib/analytics/` owns PostHog. The root host runs after language selection, including signed-out screens for
returning devices that already granted consent. A grant dynamically imports SDK 4.81.0 and
constructs one client, using `${config.apiBase}/ingest` and the existing file-backed
appStorage under a dedicated `veyrnox.posthog.<grant timestamp>.` namespace. No new native module,
provider autocapture, touch capture or automatic screen tracking is introduced.

Only the opaque Supabase user ID is identified. Sign-out, account deletion and
account switching reset the previous identity before another ID is identified.
Signed-out cold starts preserve the stored anonymous ID.
No email, name or person properties are supplied. The before-send SDK allowlist
preserves `$identify` identity-linking fields and our `$screen` pattern while
removing person properties and all unapproved metadata, including URLs/referrers.
Application events have a separate allowlist with event-specific properties and
bounded values. The primitive-property sanitizer shares test fixtures with the
website implementation without modifying website files.

Screens use expo-router filesystem segments, such as `/(app)/job/[id]`, never
concrete IDs, queries or fragments. Events cover onboarding, successful sign-in,
generation submission/completion, purchase start/result, language and appearance.
Job IDs correlate submission/completion only in local grant- and account-scoped
files and are never sent. Analytics storage never blocks generation submission or
completion polling. Completion can be observed after an app restart; a small
completed marker prevents duplicate reports. Revocation deletes the namespace;
account changes wipe the cache and prevent old records from producing events.

SDK lifecycle capture is off because its cold-open event includes the initial
URL. Our host emits only `app_opened { cold }` and `app_backgrounded`.
Replay, surveys, remote feature flags, flag preloading and exception autocapture
are disabled. The transport gate blocks remote configuration requests. Sentry is
separate and unchanged; there is no
PostHog exception capture. The proxy strips client IP headers, so disableGeoip
remains at its default. Flush thresholds and intervals remain SDK defaults.

## Revocation boundary

SDK reset/opt-out are not security boundaries: reset preserves queues, and SDK
listeners can survive dropping a reference. This installed SDK has no constructor
fetch option. The module therefore wraps the global transport used by the SDK,
as allowed by the work order. Each instance has a private local
request tag and its own consent token; the tag is stripped before network I/O.
Only that instance's exact proxy batch endpoint is allowed. All its other requests
receive a synthetic 200. This also blocks the SDK's observed remote-config request
because SDK 4.81.0 has no `disableRemoteConfig` option. Malformed tagged headers
are discarded without throwing into the SDK. Unrelated fetch calls pass through
unchanged.

Declining first invalidates the token, blocking transport and future storage
writes synchronously, then opts out, resets identity and drains the queue through
the blocked transport. Already-started file writes settle before the namespace is
deleted. A fresh saved grant has a separate namespace, so a deletion failure
cannot revive an old persisted queue. The old instance stays blocked permanently; re-grant waits for cleanup
and creates a fresh instance. A request already handed to the OS before revocation
cannot be recalled. No request initiated by the old instance after revocation is
allowed through.

## Owner tasks and limits

No IDFA, cross-app advertising, ad sharing or App Tracking Transparency prompt is
introduced. The owner must update App Store privacy labels to **Product Interaction /
Analytics, linked to user via user ID, not used for tracking** and set the public
EAS token after merge. No EAS configuration, deployment or publishing is part of
this implementation.

The work order's blanket 500-line limit conflicts with the existing monolithic
translated catalogs and their data-only parser contract. Existing catalog/review
formats are retained; all newly authored source and test files are below 500 lines.
Splitting the catalogs would require a separate localization-tooling change.

## Verification

Mobile tests cover consent parsing/storage, kill switch, launch gate order,
modal suppression during policy navigation, equal consent controls, identity
reset and SDK ownership. The installed SDK is exercised with mocked network and
storage: cold URL exclusion, `$identify` linkage, absence of flags/decide calls,
queued-event revocation, background/foreground after decline, delayed SDK writes,
an in-flight storage write, and fresh re-grant. Existing translation, design-system and ADR index checks apply.

Proof: from `apps/mobile`, `npx tsc --noEmit && npx jest --silent` (two Jest workers
for the shared build budget). ADR validation uses `scripts/adr-index.mjs`'s
`validateIndex()` plus the mobile ADR index tests. Neither the frozen ADR README
nor its baseline is edited.
