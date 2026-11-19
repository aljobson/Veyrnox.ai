# ADR-0357: Extend and cover music on the phone

Status: Built; independently inspected and host-bundled for iOS and Android. Number assigned by the host.

## Decision

Expose Extend this song and Make a cover only when a fresh, active song advertises `extend` or `cover`. Both routes use a shared form and the existing P3a/P3b quote, attempt, flow and poll framework. A trimmed description is required; cover influence is an integer from 10 to 90, initially 50. Description, influence and rights edits invalidate an unsubmitted quote. Review refreshes the source version and sends the exact quote body. The server measures duration and supplies the two-candidate price, per-candidate price, balance projection, expiry and operation-specific fields. Shared backend constants supply limits; mobile never evaluates server feature-flag helpers.

The four handlers were read in this checkout: `songs/[id]/{extend-quotes,cover-quotes,extends,covers}/route.js`. Quotes have no `outputs` field. Attempt storage now preserves all fields and freezes `outputs` only when present. Existing stem response validation still requires its outputs. Confirmations use the existing generation response validator through a small wrapper: initial acceptance requires a finite balance; a replay with a non-finite, absent or null balance drops that field. P2's validator remains strict. Extend/cover explicitly display only a finite balance from the confirmation response, including the replay's current balance; they never substitute a quote projection.

Each quote owns one prefixed idempotency key. `pair_acceptance_unknown` remains ambiguous and replays that key after quote expiry or a balance reduction. New quotes and edits are blocked during recovery. Explicit source changes, holds, duration errors, prompt-policy rejection (`prompt_not_allowed`) and other applicable stem rejections clear the attempt. Local consent/paywall rejection preserves the phase and key. A shared confirmation lock prevents double spend. No request or prompt is logged or persisted.

Only `/extends` and `/covers` are registered as paid content submissions. The existing P2 consent guard does not register `/generation-quotes`; these quote routes mirror that policy and remain free/unguarded. The real client still guards every confirmation. Connectivity probing follows the same guarded-before-probe pattern as target stems.

## Results and playback

Confirmation returns an ordinary music generation. `actionPoll` reuses `getGeneration` and P2's `MusicGenerationView` validation, pauses off-active, stops on terminal/account change/disposal and offers manual refresh after five foreground minutes. Read errors remain transient. Terminal results with a ready candidate notify song listeners. Candidates render P2's card with their own state, job and validated asset path. Selecting A or B mounts the existing MusicPlayer keyed to that selection and opts into playback; P2's default manual behavior remains unchanged.

The projection RPC can create two versions of the same source song. Each candidate therefore plays its own job, independently of the shared song ID. The secondary Open song (current version) link requires a UUID. SongDetail still plays the current version only. A version selector is explicitly a later item; opening SongDetail is not a substitute for candidate playback.

The existing P2 tracker can adopt accepted generations at small cost. Its existing account-scoped session was extracted without changing ownership or reset behavior. Accepted extend/cover results are added to that queue and keep polling after this screen is left. Queue entries retain their action origin, use the current-version link copy and omit P2-only lyrics metadata. The action screen's five-minute manual-refresh ceiling does not change P2's independent account-session queue polling policy. The queue is bounded to its existing 20 entries. Account changes clear it. App restarts lose this memory. An ambiguous confirmation without a generation ID cannot be adopted: leaving that screen loses its recovery key and tracking. No second attempt scheme, persistence or status endpoint was added.

## Localization and scope

`musicGenerationActions.*` is a new English area, with a regenerated English registry and machine translations in all ten app catalogs. Placeholder strings remain exact; expanded-copy review records are updated. Native language review is pending. Shared candidate/player changes are additive opt-ins for this slice. No package, native config, server, flag, migration, beat editor or ADR index changes are included. No paid call or real server was used.

The work order lists inline audio playback as a non-goal while acceptance criterion 3 expressly requires MusicPlayer playback on this result screen. This implementation follows that specific acceptance criterion by reusing MusicPlayer; it does not introduce a new audio engine or a SongDetail version selector.

## Proof and limitations

Mocked executable tests cover complete response fixtures and missing fields, exact request bodies, prompt/influence validation, quote invalidation, same-key ambiguous replay, current/absent replay balances, initial acceptance, double confirmation, source changes and duration failures, central consent/paywall guards, terminal states, off states, notifications, account cleanup, tracker adoption, screen controls, per-candidate playback, UUID navigation and localization. P2/P3a/P3b suites are retained unchanged.

The supplied plan says the host will separately confirm the P3c ARTEMIS/build-slot waiver; no separate confirmation was supplied. Its explicit fallback was followed: write mocked tests without ARTEMIS. No device, simulator or ADB was used. Native audio and platform bundles remain for host validation.

The installed dependency symlink points to the confirmed existing canonical mobile checkout; no dependency install was attempted. The default `with-build-slot` invocation was denied because its shared lock opens for writing outside the sandbox. Proof commands instead use a temporary read-only adapter acquiring an exclusive advisory lock on the exact same existing lock inode. This retains cross-build serialization without altering the owner wrapper, lock, safeguards or other sessions. The final advisory report records the exact proof output and environment failures; a passing native build is not claimed.

Completed source proof: TypeScript exits 2 with 22 diagnostics in untouched files and none in changed files. Full Jest exits 1: 597 suites pass, 15 fail to load missing packages, and all 12,807 executed tests pass. English registry check exits 0 (`English registry is current.`); `git diff --check` passes. Changed-file lint cannot load the missing `eslint-config-expo/flat` dependency. No dependency installation was attempted to alter this baseline.
