# ADR-0056: Project media, quarantine and format inspection

Status: proposed 2026-09-26. Staging preview only; production rollout remains protected by ADR-0023.

Backlog item M02 (`docs/architecture/implementation-backlog.md`), which M03 (project-aware
generation) and M05 (editor timeline) both depend on. This ADR covers the first slice: the
durable project asset record and the gate that decides whether an uploaded file may be used.
Moderation, malware scanning, derivatives and any editor UI are explicitly out of scope.

## What already exists, and is reused rather than rebuilt

The two-gate upload model M02 asks for is already implemented for generation inputs in
`lib/uploadSource.js`: `checkDeclared()` judges what the client *claims* (an allowlisted media
type from `ALLOWED_UPLOAD_TYPES`, and a per-type byte ceiling) before a presigned PUT is issued,
and `sniffType()` judges what the bytes actually *are* afterwards. `r2.js#presignPutUrl` pins the
content type into the signature, so a client cannot upload under a type it did not ask for.
`lib/mediaLength.js#mp4Info` already reads duration and dimensions from an MP4. `upload_reservations`
(0129) plus `lib/uploadSweep.js` already reserve and expire pending keys.

None of that is duplicated here. What is missing is that `upload_reservations` is user-scoped,
stateless and expires in sixteen minutes — a reservation, not an asset. There is no project-scoped
record, no persisted inspection verdict, and no duration or dimension ceiling anywhere.

## Decisions

1. **`public.project_assets` is the durable record**, project-scoped, with `ENABLE`/`FORCE ROW LEVEL
   SECURITY`, column-limited `SELECT` for authorized readers, no client `INSERT`/`UPDATE`/`DELETE`,
   and an immutability trigger that also blocks privileged row rewrites — the shape 0140 uses for
   `project_document_versions`. The stored original is never mutated; a replacement is a new asset.

2. **State is one-way: `quarantined` → `inspected` | `rejected`.** A row is born `quarantined` when
   the upload is reserved. Only the server, after reading the bytes, may move it, and no transition
   leaves `inspected` or `rejected`. Nothing outside `inspected` is downloadable or referenceable.

3. **`inspected` means well-formed, not safe.** The verdict composes `sniffType()` against the
   allowlist, the per-type byte ceiling, and — for video and audio — duration and dimension bounds
   read with `mp4Info`. There is no malware scanning, because there is no vendor yet. The state is
   named `inspected` rather than `ready` or `clean` precisely so the name does not imply a
   guarantee this slice does not deliver.

4. **Object keys are opaque and server-derived**: `org/<org uuid>/project/<project uuid>/asset/<asset
   uuid>/v1.<ext>`, with the extension taken from the allowlist entry, never from a filename. No
   component is derived from client input, so a key cannot be steered across tenants or out of its
   prefix. This is the "opaque organisation/project/asset/version UUIDs" requirement in
   `docs/architecture/target-state.md`.

5. **Two functions, with different trust boundaries — not three of a kind.**

   `reserve_project_asset` is a public `SECURITY INVOKER` shell over a private `SECURITY DEFINER`
   function with `SET search_path = ''`, granted to `authenticated` and called with the user's
   bearer token, exactly as 0140 does. It takes the project row lock used by rename, delete and
   document save, rechecks the live project role, carries an idempotency key scoped to project and
   actor, and writes its audit event in the same transaction. The existing
   thirty-changes-per-minute actor limit covers it.

   `record_project_asset_inspection` is **granted to `service_role` only**, with no public shell.
   A verdict a client can assert is not a verdict: if the browser could name the sniffed type, the
   whole gate would be the claim it exists to replace. Only the Worker, having read the bytes out of
   R2, may settle an asset. This is a deliberate divergence from the tenant pattern for a value that
   is server-derived by nature, not a lapse back to service-role convenience.

   `audit_events.action` gains `PROJECT_ASSET_RESERVED`, `PROJECT_ASSET_INSPECTED` and
   `PROJECT_ASSET_REJECTED`.

6. **Uploading requires `OWNER`, `ADMIN`, `CREATOR` or `EDITOR`** — the same set that may save a
   document. **Reading excludes `BILLING`**, because target-state says billing roles cannot read
   creative data. That is deliberately stricter than 0140's `document_read` policy, which admits any
   non-null project role; a brief is not a face or a voice. If `BILLING` cannot be an effective
   project role, the exclusion is a harmless guard rather than a behaviour change.

7. **Downloads need no RPC at all.** Presigning requires server credentials, so the route is
   server-side regardless; authorization is therefore a plain `SELECT` through the user's own token,
   where RLS and the `state = 'inspected'` filter already answer "may this person have this object".
   If the row comes back, the route presigns for at most fifteen minutes — the ceiling target-state
   sets for the existing signed-download path. No public URL is ever produced for a project master.
   Adding a third function here would have duplicated in PL/pgSQL what the policy already decides.

8. **Quarantine is a key prefix in the existing bucket, not a separate bucket**, and **no R2 binding
   is introduced.** `wrangler.jsonc` records that there is deliberately no binding because `r2.js`
   signs plain fetch against the S3 endpoint; M02's wording says "R2 bindings", but changing that
   transport is a separate decision with its own blast radius. A dedicated quarantine bucket is
   stronger than a prefix and is an operational provisioning step, not a source edit.

## Consequences

- **Project-internal use is gated on inspection alone, not moderation.** M02's acceptance says "only
  inspected/moderated media usable" and target-state says "quarantine, then inspection and moderation
  before use", but moderation is `MISSING` in the gap map (brief sections 40–44) — there is no
  contract, vendor or review queue to call. This slice therefore narrows that acceptance: a
  well-formed file may be used *inside* a project, while publication (M08) still requires a separate
  moderated derivative and may never expose the private master. This is the one risk-bearing
  narrowing in this ADR and it is the thing to revisit first when moderation lands.
- A file that is well-formed and malicious will pass. Inspection raises the floor from "a client said
  so" to "the bytes agree"; it is not a safety verdict, and no copy anywhere should imply otherwise.
- `project_assets` rows outlive the `upload_reservations` row that created them, so the sweep that
  expires reservations must not be read as expiring assets. An asset stuck in `quarantined` because
  the bytes never arrived is a distinct condition and needs its own eventual reaper; until then such
  rows accumulate, visibly, in one state.
- Nothing is deleted by this change. Reaping quarantined and rejected objects from R2 joins the
  existing `asset_reap_queue` work in a later slice; this one must not silently leave orphaned bytes
  billable, so that gap is recorded rather than assumed handled.
- No UI ships. The preview flag `localStorage.veyrnox_projects` is not an authorization mechanism and
  is not extended here; the APIs authorize independently.
- Applied to AI staging (`yrqzwqywxfesmbvhzjgj`) only. Production (`xdxdzmsztyzbnzeforxx`) goes
  through the `apply-migrations` workflow after owner approval (ADR-0023), and
  `TENANT_PROJECTS_ENABLED` stays `"false"` in production regardless.

## Open questions

- Whether moderation must gate project-internal use, or only publication. Recorded above as a
  narrowing with the reasoning; it is a risk decision the owner can reverse.
- Which malware scanner, and whether it runs inline before `inspected` or asynchronously as a third
  state. Inline is simpler to reason about and slower; asynchronous needs a fourth state and a queue.
- Whether quarantine earns a dedicated bucket, which would let its lifecycle rules and access policy
  differ from the masters' rather than sharing them.
- Duration and dimension ceilings have no precedent in the codebase to inherit. They are a product
  limit, not a security one, and the first values will be a guess until there is usage to read.
