# ADR-0234: Mobile Cinema progress ownership and ordering

Status: Proposed.

Cinema's merged progress route (ADR-0232 and migration 0355) stores absolute positions. Writes inside its ten-second floor return the previous position, and the app's shared API client refreshes and replays a 401 with the currently signed-in account. Screen-local timers alone cannot safely own final writes after unmount or across account changes.

## Decision

Use one in-memory progress client per app API object, following retention's WeakMap session pattern. Only `503 watch_progress_not_open` closes it for the remainder of that app session. Closure hides lists, aborts outstanding progress requests and cancels retry timers. Turning the server flag on after that response takes effect in a new app session.

A `403 profile_required` or `403 account_not_active` from any progress request marks the current user ineligible. Lists become empty and ready without error copy, and pending work is cancelled. GET, PUT and DELETE remain suppressed until identity changes; this does not set the session-wide closed flag.

`AuthProvider` sends synchronous identity notifications on adopt/drop, before asynchronous cache and storage work. This is the necessary exception to the work order's Cinema-only file scope: there is no synchronous identity getter or subscription in the existing auth context. No shared auth/refresh logic changes. The progress wrapper checks the captured owner before and after token acquisition and forced refresh, and immediately before fetch. Each request owns an AbortController; a user change or sign-out aborts every outstanding request and cancels every retry. A playback recorder captures the identity epoch, so even a late teardown after account switch cannot write to the new account.

PUT and DELETE share a per-title serial queue. A dismiss immediately advances the generation and suppresses subsequent saves; it sends DELETE only after an already-dispatched PUT settles. Even a completed PUT cannot invalidate the queued DELETE. Failed dismisses remain visible and can be retried. An explicit new playback can start recording that title again.

Final positions are captured by the playback session on pause, background, block, and stop, including navigation blur/unmount after listeners are removed. Source renewal retains the captured pre-swap position. Periodic writes run about every fifteen seconds of visible playback. A final `recorded:false` schedules exactly one retry at least ten seconds after the response; periodic floor responses are dropped. Each timer captures `{userId, contentId, generation}` and rechecks identity, title ownership, generation and closure. New saves, dismisses and completed responses cancel an older retry. A 429 imposes the server's Retry-After (60 seconds by default); final saves deferred during backoff retain their captured position and the same cancellation rules. Network failures never stop playback. No JavaScript timer promises execution after process death or while the OS suspends the app.

Mounted lists retain existing rows/cursors on pagination errors, recover an invalid cursor once, and coalesce mutation refreshes without blanking remaining rows. Completed/dismissed titles have in-memory suppression markers, so stale responses cannot restore them. Focus cleanup clears the rendered rows. The client clears personal state on identity change; it persists nothing to disk.

The player keeps its original mount effect for the initial play grant and existing token renewal. Router focus cleanup only requests a final progress save; refocus does not start a new session or mint another initial grant. Repeated final notifications with an identical position less than one second apart share the first save, including background followed by the native pause event.

## Verification and limits

Fake-response tests cover owner changes during PUT and forced refresh, aborts, per-title ordering, cancellation, floor retries, backoff, closure, pagination and stale completion responses. Playback-session tests cover seek after source load, cadence, pause/background/stop and renewal teardown. The requested TypeScript/Jest proof is run in the supplied checkout using its existing dependency symlink. Native visual playback and production activation are outside this source-only proof; the production flag and migration remain untouched.
