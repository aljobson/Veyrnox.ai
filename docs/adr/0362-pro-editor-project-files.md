# ADR-0362 — Durable Pro editor project files

Status: Proposed. Implementation for review, flag absent/off. No production migration or UI wiring; the migration must not be applied before the owner decisions below.
Date: 2026-11-19. Extends ADR-0358. Frozen work order: PLAN-P2b.md, SHA256
`e3739301a5bd20f2b973e30a10993de7abe2f6aacd64174aa0f7b905a5a02563` (rev 3 amendments prevail).

`project_files` stores immutable `.fcproj` JSON under opaque organisation/project/file
keys in R2. It is separate from media assets and all credit/ledger paths.
`project_pro_heads` stores append-only revisions. All tenant operations use the
caller's JWT and explicitly granted public invoker/private definer pairs; inspection
and cleanup are service-only RPCs. Both tables force RLS, revoke direct writes,
retain historical actor UUIDs without user foreign keys, and refuse deletion/truncation.

Routes under `/api/v1/projects/:id/pro` require both `TENANT_PROJECTS_ENABLED`
and the strict `EDITOR_RUNTIME_FLAGS` key `proEditor: "true"`. The key ships absent.
No UI or host code constructs the adapter. As explicitly chosen in the work order,
JSON is independent of the media-upload and CSAM admission gates. This is an
intentional document-only boundary for review, not general binary upload acceptance.

The shared byte scanner caps input at 8 MiB, nesting at 64, tokens at 1,500,000,
string tokens at 1 MiB, and envelope key tokens at 1 KiB. It rejects duplicate
(encompassing escaped) envelope keys. The server never decodes or parses the whole
document: after the linear syntax and complexity scan, UTF-8 is validated in 64 KiB
chunks with the output discarded, and only the `format` and `schema_version` members
are parsed, from their recorded byte ranges; the `project` member must start with `{`.
Schema acceptance is 1 through 19 in the scanner (`MAX_SCHEMA`, the pinned current
17 plus two); the database only requires `schema_version >= 1`, so the two cannot
disagree. The fingerprint hashes the original `project` value bytes,
including internal whitespace, and excludes envelope/view metadata. Client and
server use the same module. The inspection semaphore allows one active read/parse
per loaded Worker module; busy calls return 503 without retaining queued buffers.
The R2 read uses a preallocated, exact-size buffer; transport failures never settle
a rejection. Inspection performs a fresh caller-JWT read after recording a verdict.

The adapter uses `<sessionId>-<instance>-<candidateUid>-<attempt>`, where `<instance>`
is 8 random hex characters per adapter and `<candidateUid>` is `<tracker nonce>-c<N>` (candidate ids restart at c1 in every tracker), so neither a remount nor two trackers sharing one adapter collide, retaining the
attempt after ambiguous failures; head keys add `head-<revision>` the same way. The
presigned upload goes only through a separate `uploadFetch` (required, never the API
fetch) and carries no credentials. Labels are made server-safe (separators and control
characters removed, 120 code points, fixed fallback). Strict PUTs include signed content size, application/json and
`If-None-Match: *`; 412 proceeds to inspection. Three inspection attempts back off by about 1 s, 2 s and 4 s (jittered), of the order
of one inspection. Only expired/unavailable reservations allocate a new key, at most three.
Success requires an inspected, live file with matching identity, byte count and
SHA256. Failed persistence retains tracker bytes. Head CAS errors use the standard
error envelope with kebab-case codes; the tracker receives `revision-conflict`.
`FILE_UNAVAILABLE` extends the rev-2 tenant error allowlist as required by rev 3.

Quota is 200 MiB and 100 non-purged objects per organisation, including claimed
objects, with at most 20 non-purged quarantined objects. Reserve and inspection
requests have separate 30/min and 10/min actor limits, kept in the private prunable table
`private.project_file_requests` (not in `audit_events`, whose 30-per-minute budget
other tenant functions share); only a head change writes an audit row. Head revisions
stop at 1,000. Cleanup releases quota only on confirmed R2 deletion. Failed deletes
retain the claim, attempt count and a fixed error; expired one-hour claims are
retryable. Every sweep reports the claimed-but-unpurged count and deletes in batches
of four. Cleanup depends only on the tenant gate, so disabling Pro does not stop it.

Read access to `project_files` (list and download included) is limited to the write
roles OWNER, ADMIN, CREATOR and EDITOR. Viewers and reviewers can read head revisions
only. This deliberately deviates from plan P2b acceptance criterion 2 (which let them list
and download inspected files): no upload-admission gate covers this JSON surface, so letting
every member download arbitrary project bytes needs the owner's explicit sign-off first.
The scanner also refuses more than 32 top-level members before decoding or storing any key.

Promotion locks the project then the file. Cleanup selects bounded candidates,
locks each file with SKIP LOCKED, and rechecks eligibility in a separate SQL
statement with a fresh READ COMMITTED snapshot. It never locks a project. Live
head references protect inspected bytes; tombstones preserve history after purge.
Quarantined/rejected objects age out at 24 hours; unpromoted inspected files at
30 days. Deleted projects permit even referenced files to be claimed after 30 days.

Recon resolved deletion before migration authoring: `private.mutate_project` in
0135 soft-deletes `projects.deleted_at`; `private.project_role` excludes deleted
projects, so the same mutation cannot currently undelete them. There is no existing
project-asset deletion sweep: 0163 only reaps old quarantined/rejected media.
The new file sweep adds the deleted-project coverage required by the work order,
retaining the 30-day grace without claiming an existing undo UI or modifying media.

## Explicit qualifications and deviations for review

- Main and open-PR metadata were checked read-only on 2026-11-19 using the GitHub
  connector after CLI networking failed. Main has 0561; PR #2452 reserves 0560.
  Migration 0562 was free then (renumbered to 0568, see the note below). All overlapping migration blobs match main, including
  the latest audit-action definition (0141). ADR-0359 is already used by Music and
  PR #2461 reserves ADR-0360 and PR #2469 reserves ADR-0361, hence ADR-0362 here.
- **OWNER DECISION NEEDED before 0568 is applied or the flag is enabled: the quota can
  stall saving.** Every Save, Save a Copy and upgrade backup is a stored file. With
  100 non-purged files and 200 MiB per organisation, unpromoted files kept 30 days
  and promoted files never freed while their project lives, an active organisation
  can hit the cap (about 3.3 saves a day across all members) and every further save
  fails with `storage-quota-exceeded`; the app keeps the bytes and blocks leaving. The
  requested 200-unpromoted-files-per-project eviction is unreachable under this
  stricter cap and is not implemented. Choose the caps and whether to evict the
  oldest unpromoted files when a reservation would exceed them.
- The server holds the 8 MiB input buffer and the scanner's small bookkeeping; it no
  longer builds an object graph or a decoded copy of the document. The remaining
  memory is therefore close to the input size, but it is reasoned, not measured:
  Worker heap/CPU qualification against adversarial inputs remains a rollout
  prerequisite (this isolate has hit its 128 MB limit before, see `worker.js`).
- One module-scoped semaphore is the available implementation within the current
  route bundle. A build must confirm there is only one loaded inspection module per
  isolate; this cannot be established without the blocked Worker build/size checks.

## Verification contract

`node --test tests/proEditor*.test.mjs` is the agreed proof. Additional targeted
project/tenant suites exercise existing behavior. `scripts/test-project-files.mjs`
runs against the local full migration replay, replays 0568 twice inside rollback,
checks roles/RLS/grants/guards/caps/replays/reaping and no user FKs, then runs three
real two-session races from `test-project-files-concurrency.mjs`. The first race
uses a session-local copy of the actual cleanup function with one advisory barrier
inserted between selection and locking; production functions are never modified.
The concurrency script removes only its committed file/head fixtures in the local
throwaway database; identity/audit fixture records remain, like existing concurrency
acceptance scripts. The full-replay CI job includes the entry point.

Production application remains exclusively through the owner-approved
apply-migrations workflow. No staging probe, publication, or rollout is part of
this implementation.

Executed (2026-11-19): `node --test tests/proEditor*.test.mjs` (127 tests); on a
throwaway local PostgreSQL 18.6 the full migration replay including 0568, and the
project documents, project assets, privileges and account-deletion suites and the
concurrency script; `scripts/test-project-files.mjs` after a corrected truncate
assertion (see the SQL run notes in the PR). NOT executed: `npm run build`, the
Worker size budget, the full `npm test` and lint, PostgreSQL 16 (CI), and any
staging or production probe.

## Amendment 1 (2026-11-19): migration renumbered 0562 to 0568

The production plan refused to run (`out of order: 0562_pro_project_files.sql not applied, but production has migration 0564`) because 0563 and 0564 were applied first. 0562 had never been applied, so the file was renamed to `0568_pro_project_files.sql`; the SQL is unchanged. The internal function name `telemetry_path_allowed_pre_0562` stays as written: it is a stored identifier, not a file reference.
