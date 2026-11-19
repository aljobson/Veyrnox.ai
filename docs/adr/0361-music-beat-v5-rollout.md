# ADR-0361: Beat v5 readers and legacy-client fences

Status: Proposed
Date: 2026-11-19

## Decision and rollout order

1. Apply the prepared migration through the owner-approved workflow: widen the
   project CHECK to versions 1–5, add required client-version save/remove RPC
   overloads, and replace both public/private legacy signatures with adapters
   declaring version 4. The private guarded functions lock the owner's mutations
   and inspect the saved version before writes, stash, replay, pruning or deletion.
   Refusals are HTTP 409 / `BEAT_CLIENT_OUTDATED`; project, versions and takes stay
   intact. Explicit ACLs cover all eight full signatures. Old signatures remain
   necessary for loaded bundles and direct PostgREST clients.
2. Deploy compatibility readers and the IndexedDB version fence. Unsupported
   versions (>5) are distinct from damaged records and have no delete action.
   Open `veyrnox-beat-projects` at version 2, preserving the projects store and all
   records. Existing connections close on `versionchange`. A blocked opening
   displays reload-to-update; the pending native request waits for closure, then
   notifies subscribers to retry the read. Never erase or force-close another tab.
   Old `open(NAME, 1)` fails with `VersionError` after upgrade.
3. Only a later, explicitly approved writer release may enable v5 persistence.
   `BEAT_WRITE_VERSION` stays 4; the reader maximum and cloud client declaration
   are 5. The prepared SQL admits v5 for the future rollout, but this application
   refuses v5 creates, updates, cloud payloads, account materialization and version
   restore. Valid v5 reads and explicit pure upgrades preserve the schema. The
   server also refuses a silent downgrade of an existing v5 document to v4.

A marker in a document cannot retrofit already-loaded JavaScript. An old tab
would classify v5 as damaged and offer deletion, so the database version is the
local fence. Cloud account deletion bypasses IndexedDB and cascades to versions
and takes, which requires a separate server fence. Declared version is a client
capability contract, not an authorization credential; owner RLS and authenticated
RPC identity remain the authority.

## P0 scope and constraints

Pure ripple, marker and clip-search operations live beside `beatOps.mjs` and use
its immutable edit/refusal conventions. Each ripple edit is one history entry.
Existing `snapTick` is reused. Ripple results must satisfy the existing 240-tick
region grid; marker ticks are integers bounded to the song limit. Legacy regions
have no persisted name property; search also uses MIDI clip and asset names.

There is no v5 writer in this release. Account open and version restore cannot both
persist v5 and obey that prohibition. They parse without changing the document,
then explicitly refuse persistence and display the update-required message. This
is the proposed deviation from a successful v5 account-open/restore requirement;
no silent downgrade or marker loss is permitted.

Numbering was checked on 2026-11-19 against `origin/main` (e41b045fd) and the open PRs.
Migration 0564 is used because 0560 is drafted by open PR #2452, and 0561 and 0563 are
already on main; a number below main's latest migration also risks being skipped by the
apply workflow. ADR 0361 is used because 0357 and 0359-0360 are on main and 0358 is
claimed by open PR #2458. Both numbers can move again before this merges, so re-check
them against main and open PRs immediately before applying the migration or publishing.

## Proof and manual two-tab checklist

Automated store tests use exact pre-change HEAD source snapshots for the old
store, validator and record decisions. They exercise version negotiation, blocked
upgrade recovery, old-bundle refusals and unchanged bytes. Pure, route, hook and
UI harness tests cover readers, write admission and non-retryable error states.
`scripts/test-music-beat-v5.mjs` follows the disposable-local-Postgres transaction
pattern: replay twice, inspect every overload/ACL, save/checkpoint/stash/restore
v1–5, then verify old public/private calls leave projects, versions and takes intact.
It is wired into ledger CI. The companion `scripts/test-music-beat-v5-rest.mjs`
tests real local PostgREST legacy overload selection and compares all rows after
each refused HTTP request. It is in the ledger workflow's path filter and run list,
but CI has no PostgREST service, so the job reports it as SKIPPED unless
`MUSIC_BEAT_TEST_REST_URL` and `MUSIC_BEAT_TEST_JWT_SECRET` are set; until a
PostgREST service is added to CI, run it locally against the disposable database
before enabling any version-5 writer. Real Postgres and PostgREST acceptance were not run
here (no installed pg dependency or configured disposable DB); route tests mock
PostgREST's typed HTTP 409. No dependency installation is authorized.

One refusal reads oddly and is intended: once a project's stored version is 5, the
fence also refuses a save from a current client that declares 5 but writes a version-4
document, because that would downgrade a version-5 document. The client then shows the
same "update the app" message and `BEAT_CLIENT_OUTDATED`. The refusal is correct; the
wording is shared on purpose. Nothing writes version 5 yet, so it cannot occur today.
Before the writer phase, decide whether to add a distinct code (for example
`BEAT_DOWNGRADE_REFUSED`, which would also need classifying in `tenant-client.js` and
`beatCloudRules.mjs`) and whether `stash` should be exempt from the downgrade check.

A valid local version-5 record is readable but not writable by this app. The editor
opens it in the update-required state (the same message as a refused save) and never
loads it as an editable document, so edits cannot be made and silently lost.

Manual checklist, not run in P0:

- In a disposable browser profile, load the pre-compat bundle in tab A and retain
  a version-1 database connection. Load this compatibility bundle in tab B.
- Hold A's connection temporarily: B shows reload-to-update. Release it via the
  normal `versionchange` handler; B upgrades to 2 and reads all existing records.
- In a future writer-enabled test build or fixture harness, place a v5 document
  with markers in B. Capture its complete stored bytes; P0 cannot create it.
- In A explicitly attempt list/open, replacement and damaged deletion. Its next
  version-1 open fails and the normal store-unavailable state is visible.
- Reload A onto the compatibility bundle: compare complete bytes and marker
  content. Version-6/999 fixtures say “Needs a newer app” and have no delete.
- With the old cloud client (omitted declaration), attempt PUT/checkpoint/stash and
  DELETE of v5 through both Worker and authenticated PostgREST RPC requests.
  Expect HTTP 409 `BEAT_CLIENT_OUTDATED` and unchanged project/version/take rows.
- With this bundle, check update-required presentation and absence of automatic
  retry requests. Confirm newly created and saved application documents are v4.

No mobile files or Metro/native environments are part of this work order.
