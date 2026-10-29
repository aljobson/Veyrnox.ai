# ADR-0297: Project document editing on the phone

Status: Proposed; implemented for independent review. The host assigns the final ADR number.

Builds on ADR-0051 (tenant projects call PostgREST with the user's JWT), ADR-0055 (project document
history: every save is a revision, a restore writes a new revision) and ADR-0131 (the phone's read-only
projects screen). It depends on the session fence (ADR-0291): a request whose 401 retry would use another
account throws `ApiError(401, 'account_changed')` instead of being re-sent.

## Decision

The phone project screen edits the brief and canvas (aspect ratio, frame rate) of a schema 1, 2 or 3 project
document, autosaves 3 s after the last edit, reviews a 409 the way the web does, and previews a version before
restoring it. The draft lives in memory only; nothing goes to device storage.

- **Conflict save keeps the remote timeline.** "Save my draft instead" sends `expected_revision` = the remote
  revision with the remote document's `schema_version`, `project_id` and `timeline`, plus this screen's brief and
  canvas. This deliberately differs from the web project page, which resends its own copy: the phone screen never
  edits the timeline, so it must never revert one the editor saved elsewhere.
- **No schema 4 on the phone.** An Oddlings document (schema 4) fails `validDocument` and is shown as "can't be
  edited or restored on the phone". A restore is only sent against a loaded, editable head, so a schema 4 project is
  never restored from the phone even though the route does not check a restore's kind.
- **`LIMIT_REACHED` on the document route.** `PUT /api/v1/projects/:id/document` passes `limitAware: true` to
  `tenantRequest`, as the Film Studio routes do. The two permanent caps of `save_project_document` (1,000 revisions
  per project, 2,000 saves per person per day) now arrive as 429 `LIMIT_REACHED`; the per-minute limit stays 429
  `RATE_LIMITED`; status and `Retry-After: 60` are unchanged and the RPC's DETAIL is never forwarded. The web keys
  on status only, so it is unchanged. The phone tells the caps apart by revision: the RPC checks the revision cap
  after the stale-head check, so a `LIMIT_REACHED` with `expected_revision >= 1000` is the revision cap and any
  other `LIMIT_REACHED` is the daily cap. Three consecutive `RATE_LIMITED` replies hold autosave until Save now, which
  bounds the loop against an older server that hides a cap behind `RATE_LIMITED`.
- **Restore lock.** From the confirmed restore until it settles, the brief and canvas are locked (in the hook, not
  only the UI), autosave, Save now and the hand-off are off. A restore needs a clean draft, an idle hook, no
  conflict and a target other than the head; it sends `expected_revision` = the loaded head, and the reply's document
  becomes both head and draft. This is stricter than the web.
- **One writer.** A single hook owns every document write on the screen (autosave, Save now, the conflict save,
  restore, the save before opening the editor, deletion). Delete waits for a write in flight and suspends autosave
  before sending. Every result after an await is applied only while the hook is mounted, its session task is
  current and the cache user is the one it started with; an `account_changed` result is dropped quietly and the
  screen re-keys by owner, so another account's draft is never sent or shown.
- History is one `{versions, next}` state with a sequence number; a refresh blocks paging until it commits, and a
  page that started from another cursor is dropped whole.
