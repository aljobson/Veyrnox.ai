# ADR-0224: Mobile Cinema Saved and Following, recovery and shared closure

**Status:** Proposed 2026-10-20

Highest ADR on main was 0221 when this was written; 0224 leaves room for open PRs. Rename the file if another PR took the number before this merges. This change hardens the existing Saved titles and Following screens (ADR-0178); it adds no new screen or client.

## Decision

Keep GET and POST retention traffic in the existing `cinemaSocial.ts` client.
A WeakMap keyed by the existing AuthProvider API client holds a closed bit and
mutation listeners, never saved titles or other personal collection data. Only
HTTP 503 with `retention_not_open` closes the session. All subsequent retention
reads and writes stop, including requests triggered by end-of-list events. Already
in-flight reads cannot reopen it. Successful in-flight writes still return their
real result and notify listeners; unrelated failures retain their original error.
Other 503 responses remain retryable.

Closure resets on the next app session, when AuthProvider creates a new API client;
it does not reset on focus, tab switches, sign-out/sign-in, or a timer. Lists clear
their cursor and show “Not available yet”. Title controls retain their last known
labels but become disabled; when no state has ever loaded, controls and the note
remain hidden on title pages (round 2 product disposition).

Each mounted list owns its view and subscribes to mutations of its collection.
Each mounted title control subscribes to changes to its title, creator, or series.
Successful writes trigger an immediate reload of matching mounted consumers,
including screens beneath the current route. Unmounted consumers read on mount.
Ordinary focus causes no extra calls. Mutation during a read discards its result
and queues a fresh read; disposal suppresses late results and removes listeners.

After every successful list removal, reload page one. A remote deletion producing
`invalid_cursor` discards the cursor, then attempts page one once. Existing rows
remain visible during mutation refresh and cursor recovery, and are replaced on
success. A failed recovery leaves no cursor for automatic pagination to retry.
Ordinary pagination failures retain rows, ready status and the cursor for a later
end-of-list retry, with an inline note. Full-screen errors apply before the first
successful page only.

The existing authenticated API transport rejects a missing access token before
fetch. Both components additionally skip work while auth is not signed in. No
layout, navigation, route, dependency, server, flag or migration changes are needed.

## Continue watching (not implemented)

`POST /api/v1/cinema/play/heartbeat` accepts `content_id` and a seconds delta (1–60).
`lib/cinema/unlockApi.js` returns recording/access, seconds and quota fields; these
are metered viewing usage, not a playback offset or a resume-history read API.
`lib/cinema/retentionApi.js` returns saved/follow booleans and paginated collection
metadata, with no progress fields. Neither route exposes resumable watch progress.

## Proof scope

Fake-response tests exercise the lifecycle objects used by the components, cursor
recovery, mutation races, shared closure and signed-out transport behavior. They
are not a native renderer or device test. Neither react-test-renderer nor
@testing-library/react-native is installed; shared lifecycle guards are tested
in the library as permitted by the round 2 disposition. The agreed proof is TypeScript plus the
complete mobile Jest suite. Independent final inspection remains with the host.
