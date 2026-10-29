# ADR-0295: Phone editor save conflicts, drafts and versions

Status: Proposed; implementation awaiting independent review.

The native editor uses the same project document, history and restore endpoints as the web editor. This work builds after `session-fence`: the shared API client captures the session before awaiting consent or tokens, and refuses sends and refresh retries after a switch. This change neither wraps nor modifies that client. No server, migration, flag, dependency or deployment changes are required.

The session UI remains in `useFullEditorSession`; `useEditorSaveSync` owns save outcomes, operation tokens, draft serialization and replacement choices. The project bar reports saving, an unresolved restore, conflict, the mapped failure, recovered work, ordinary unsaved work, or the saved revision, in that order. Conflicts and recovery use modal choices. Versions load paginated history and validated previews; restoring creates a new server revision.

## Binding safety rules

- **R1 — session lifetime.** Capture the cache owner at mount and subscribe to owner changes. Invalidate epochs, locks and timers, clear the document, and tear down the navigation guard on a switch. Check ownership after awaits. A `401 account_changed` is a quiet drop: no error mapping, retry, conflict choice or draft removal. Other 401s pause saving and keep the draft. The API fence is the authority on whether a request can leave the phone; editor checks also stop subsequent work.
- **R2 — one draft queue.** Writes and removals share one promise chain. Each operation checks its captured replacement epoch when it reaches the front. Replacements cancel draft debounce, advance the epoch and await removal. Post-save removal additionally checks snapshot identity and clean state when executed. A rejected storage call does not poison the chain.
- **R3 — logical save identity.** Retain the key, expected revision and exact document while an outcome is unknown. Later edits wait for that save to resolve. Success or a definite refusal (400/403/404/409) resolves it. Retry status 0, 429 and 5xx at 5, 10, 20, 40, 60, 60 seconds, continuing at 60; use a positive 429 Retry-After capped at 600 seconds. Edits and Retry now can trigger the retained save immediately. New snapshots get a new key.
- **R4 — frozen copy.** Freeze the copy name, workspace, merged document and both keys on the first attempt. Remember the created project ID, so a PUT retry does not create another project. A backup arriving while the sheet is open is recorded without mutating the frozen snapshot. Keep the original draft when the merged document differs from that snapshot.
- **R5 — durable leave.** Every edit invalidates the draft receipt. Flush the 400 ms debounce through the queue, await an in-flight save, then try the latest eligible save. A dirty leave prompt promises recovery only after storage acknowledged the current identity. Backgrounding flushes the draft. The native leave guard covers Done and removal gestures; copy navigation and owner teardown bypass it deliberately.
- **R6 — replacement exclusion.** Import tokens capture the replacement epoch, cache owner and authentication session task. Imports increment a count and end once in `finally`. Replacements cannot start while an import or save is active; new imports cannot start while replacement holds its token. Check identity again after a replacement request. `beginImport` is exposed for the subsequent editor-ai generated-media insertion work.
- **R7 — explicit discard.** Version restore requires a clean document. Use saved and Recovery Discard instead ask for destructive confirmation, then capture the identity the user agreed to discard. An edit after confirmation prevents replacement and retains the remote head as conflict information.
- **R8 — copy exclusion.** Keep copy waits for all imports. Once copying begins, imports are refused. Before navigation, compare the raw local identity with the identity frozen at confirmation. If it changed, keep the copy operation and sheet, flush the draft, and explain that the project changed.
- **R9 — local base versus remote head.** The local revision advances only when adopting a server document or acknowledging a save from which the current local document derives. A head merely observed by watch, conflict fetch or a rejected replacement never changes the draft base. This preserves conflict detection on reopening.
- **R10 — watch generations.** Watch every 15 seconds while active and on return to active. A GET captures the operation generation and replacement epoch; drop its result if either changed, an operation started, or a sheet opened. Do not start watch while an ordinary save outcome is unknown. A closed sheet with an ambiguous restore is the one exception described below.
- **R11 — start, own, retry.** Pure predicates distinguish a new operation, continuation under its own token, and retry of a retained ambiguous operation. Restore retries retain key, current revision and target revision. Close hides the sheet without resolving the operation; the project status remains unknown, autosave waits and automatic replay continues. Only an answer to the same-key restore itself, or a head above its expected revision, can resolve the uncertainty. A higher head opens conflict without advancing the local base. A definite restore refusal clears it; account change or unmount drops it without claiming success.
- **R12 — deferred backup mappings.** Adopt the exact server document as a clean baseline and remove the old draft first. After releasing replacement, merge only backup mappings for media still in that document. Any difference is a new dirty edit: persist its draft against the adopted revision before saving it. An unchanged merge sends no PUT.
- **R13 — recovery gate.** During initial draft read or an unanswered recovery choice, do not write drafts, autosave or watch. Background does nothing; leaving preserves the stored draft without an alert. Restore makes the draft the dirty local document and opens the gate. Discard removes it before opening the gate. Entry `jobId` import waits for the draft decision and runs only on the head when no draft exists or after discard.
- **R14 — complete Library import fence.** The optional `alive` callback is checked around media-info, export-link fallback and duration probing. Return `LIBRARY_STOPPED` when the token is no longer current. Rethrow `account_changed` from the fallback instead of converting it to an unknown-duration error. The existing media-info helper still swallows its errors, so the token check after it is essential. Session/owner changes are quiet; only a replacement epoch mismatch reports a dropped import.

## Why an unchanged head cannot resolve a restore

A timeout only means the phone stopped waiting. The server or database may still commit the original restore after a GET returns the old revision. Dropping the operation on that GET would allow a new save to race the late commit. A same-key replay instead waits on the server's project-row lock and either replays the original result or commits it once. A head strictly above the expected revision also settles the outcome: that expected revision can never pass again. An equal head, a failed GET, and an invalid restore reply all leave the operation retained.

## Draft decision table

| Stored draft | Decision |
| --- | --- |
| Absent, or document identical to head | Open editing; remove an identical draft |
| Different document, same base as head | Load head; offer Restore / Discard without touching storage |
| Different document, older base | Load draft with its original base; open conflict |
| Different document, unexpected newer base | Treat conservatively as conflict; never silently discard |

Draft receipts describe successful device storage, not successful cloud saving. File metadata alone cannot recover a backup `assetSource`; its mapping must remain in the draft until a PUT acknowledges it.

## Copy and compatibility

Create a project with the frozen create key, then PUT the frozen document with the copy's `project_id`, `expected_revision: 0` and its own retained save key. Best-effort copy each available `l-` device file using `editorDeviceMedia.files` and `copy`. An `assetSource` in the copied document still points at assets of the original project. Its mapping may lag a backup that completed during copying; the copied device file and retained original draft preserve recovery options.

Documents keep their existing `schema_version`, project ID and shared validation contract. Historical previews and restore replies must pass `validDocument`. Malformed restore replies trigger a head read while retaining uncertainty unless a higher head proves it resolved.

## Verification and scope notes

The frozen work order names this ADR-0295 path explicitly. It also names a historical base, while the supplied checkout is at 007564a2f with session-fence already integrated; paths are resolved here. The implementation and regression tests stay in the whitelist. Existing locale catalogs already exceed 500 lines and retain their required formats; the ceiling applies to handwritten implementation files. No original checkout is edited, and no commit, push or publish is part of this work.

The literal requirement to retain an old account's draft across a switch cannot be guaranteed by this whitelist. Existing `appCache.sweepUserDocs` deletes foreign-owner durable records during `bindCacheUser`; `editorDrafts.readDraft` also removes foreign-owner records, and an in-progress `writeDraft` removes its record if the owner changes before completion. All three files are explicitly frozen. The implemented guarantee is that this editor queues no removal on `account_changed` and starts no further draft writes; global cache cleanup remains authoritative. Preserving old-account drafts across that cleanup requires a separately reviewed change to the storage/ownership policy.

Verification uses the agreed command. The sandbox denies the stock build-slot launcher's write-open of its existing lock; a temporary read-only adapter executes that launcher using the same exclusive lock, preserving wait and signal behavior without modifying the launcher or lock permissions. `expo lint` is additionally attempted, but the installed ESLint does not meet Expo's minimum version. No dependency installation is made to bypass that limitation. The `origin/main` diff contains pre-existing branch differences; the task's whitelist is checked against the starting checkout as well.
