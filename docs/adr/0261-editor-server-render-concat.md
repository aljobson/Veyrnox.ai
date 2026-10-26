# ADR-0261: Server render for editor export (Concat runner)

Status: Accepted; slices 2–4 web built, production flag off
Date: 2026-10-25

## Context

The browser editor renders and exports on the user's device (ADR-0080, ADR-0097,
ADR-0247 D5), which is why editing and export are free. That limits export to
what a browser can do: 720p or 1080p, ten minutes, and whatever the device
survives. Phones are the weak case (ADR-0247 slice 3: a 25 MiB cap and a
device test gate).

PR #1652 measured [Concat](https://github.com/jub0t/concat) (AGPL-3.0-or-later)
as a headless render service. `concat-cli serve` exposes a token-guarded
JSON-RPC API; a pinned upstream build with Mesa lavapipe renders with no GPU.
Measured on a Fly performance-4x machine (4 CPU, 8 GB, amd64), 5 s 720p clip:
640x360 in 3.1 s (0.61x realtime), 1080p in 12.1 s (2.42x). A proof of concept
(`services/concat-render/poc/translate.mjs`) turned a schemaVersion 2 editor
timeline into Concat calls and rendered trim, clip order, text, a 0.5 s dissolve,
per-clip volume and a separate audio clip correctly. Not covered: pixel
comparison with `editorRender.mjs`, schemaVersion 3, other transitions.

## Decision

Add an opt-in **Export on server** path for editor projects, rendered by Concat
running unmodified in its own container on Fly Machines. Browser export stays the
default and stays free. Nothing changes for a user who does not choose it.

1. **Runner.** One Docker image, built from a pinned upstream commit, one Machine
   maximum and one render at a time (Concat refuses a second export with `busy`).
   It follows the OpenMontage runner pattern (ADR-0074): the Worker never runs
   ffmpeg and reaches the wrapper at its public `https://<app>.fly.dev` address
   (Cloudflare Workers cannot join Fly's private network, as with the Montage runner)
   with a shared, direction- and path-bound HMAC secret; unsigned requests get 401. The wrapper reaches local Concat with a freshly generated per-render
   token. The runner holds no Supabase key and no R2 write key.
2. **Job.** A new `jobs` kind. The Worker validates the project document, asks
   for fresh presigned GET links (at most 15 minutes) for every source, and
   persists a random-UUID output key scoped to the job. Immediately before upload,
   the runner requests a fresh strict presigned PUT (at most 15 minutes, signed
   Content-Length and If-None-Match). The runner
   downloads sources to a scratch disk, translates the document, renders,
   uploads, and reports through a signed callback (HMAC-SHA256 over timestamp,
   POST path and raw body, 300 s tolerance, `webhook_events(source, external_id)`).
3. **Result.** The file becomes an editor-render in the Library through the
   existing byte-inspection helper and a service-role-only, job-bound finalize
   RPC. It links one canonical asset to the editor-render in the same transaction
   that settles the job as `STORED`; it never forwards a user JWT.
4. **Money.** One `model_catalog` row prices server render (credits per output
   second, by resolution). Debit once at start through `ledger_debit` with the
   job's idempotency key; `ledger_refund` on runner failure, cancel or timeout.
   A liveness sweep refunds a lost run, as in ADR-0074's amendment. The app
   computes no price.
5. **Flag.** `EDITOR_SERVER_RENDER_ENABLED`, `"false"` in `wrangler.jsonc`. The
   export dialog shows nothing while it is off. Staging first.
6. **Limits.** A queue depth limit returns `{error: "render_busy"}`. Input
   documents are bounded by the existing project schema (16 tracks, 40 clips,
   ten minutes). Sources are only the user's own Library media and uploads; the
   runner fetches no other URL.

## Not yet decided (blocks any user-facing release)

1. **AGPL.** Concat is AGPL-3.0-or-later. The plan is to run it unmodified, as a
   separate process behind an API, and to publish the Dockerfile and pinned
   commit (this repository is public). Any change to Concat, or a decision to
   link it into our code, needs the owner's legal read first. Until then the
   flag must stay off in production.
2. **Fidelity.** The server render and the browser preview are drawn by
   different engines. Text, fonts and other transitions may differ. The
   dialog must say so, or a pixel-comparison gate must pass before release.

## Slices

1. Runner repo or folder, image, fake-source smoke test (done in #1652).
2. Translator as a tested module for schemaVersion 2 and 3, with fixtures (built, supported subset below).
3. `jobs` kind, callback, refund path, idempotency tests, behind the flag (built; SQL/runtime acceptance outstanding below).
4. Export dialog option (web built below); mobile entry remains out of scope.
5. Owner-approved price (built), fidelity decision, owner flip.

## Consequences

- A second render engine to keep in step with the browser one. Every new editor
  feature needs a translator rule or an explicit "not supported on server".
- A single-Machine service with no autoscaling; its idle and render costs must
  be measured on a real bill before changing the v1 capacity policy.
- Long and high-quality exports stop depending on the user's device.

## Slices 2–3: lifecycle trace and decision (2026-10-25)

The work order with SHA256
`01ee562528ba5286d2ff12240e26dcefeadad26f183e14f1f5f18b9dd10ac35d`
originally required in R2 both settlement like other jobs and an atomic finalize RPC that
moves the job to `SUCCEEDED`. Those are different states in this checkout.
The first attempt stopped before application or migration changes under R2.
R8 of the revised work order resolves that stop in favor of `STORED`.

Evidence from the current definitions:

- `packages/db/schema/supabase/0077_asset_content_hash.sql`, `job_stored`:
  atomically moves the job to `STORED` and records its asset. `SUCCEEDED` is an
  input state, not the settled output state.
- `packages/db/schema/supabase/0329_provider_spend_and_submit_guards.sql`,
  `sweep_stuck_jobs`: a `SUCCEEDED` job without an `assets` row is changed to
  `FAILED` and refunded after 60 minutes. An editor-render row alone does not
  satisfy that check.
- `packages/db/schema/supabase/0206_free_allowance_jobs.sql`, `ledger_refund`:
  locks the job and refuses both `SUCCEEDED` and `STORED`. The shared sweep can
  refund the former only because it first changes its state to `FAILED`.
- `packages/db/schema/supabase/0038_free_credit_sweep_fixes.sql`,
  `expire_free_credits`: waits on jobs that spent free credits unless their
  state is `STORED` or `REFUNDED`. Adding an asset to a terminal `SUCCEEDED`
  job would not resolve this condition.
- `packages/db/schema/supabase/0351_delete_user_job.sql`, `delete_user_job`:
  rejects `SUCCEEDED` as `IN_PROGRESS`; `lib/jobState.js` likewise presents it
  as `running`. An asset row alone does not make that job settled.

Decided by R8 of the revised frozen work order: the successful finalize transaction ends
in `STORED`, rather than terminal `SUCCEEDED`. Keep the debit in `ledger_debit`
and refunds in `ledger_refund`. Following ESR-016, the service-role-only finalize
RPC acquires the shared owner advisory capacity lock, then the job lock and
balance lock, and rechecks its live state and owner availability. ESR-016
replaces the 0285 user-row capacity lock in browser reservation too, so no user
row lock is held across a money call. Finalization binds the persisted
output key and Worker-inspected size/hash to one canonical asset and a linked
editor-render, settling the job in that same transaction. A completed replay
returns the existing result. Cancel/refund and finalize arbitrate on
the job lock; neither can reverse the other's terminal outcome.

The canonical asset and editor-render use coordinated removal and expiry. The
render's unique asset link cascades when the canonical asset is removed;
Library removal calls `delete_user_job`, preserving its hold and use checks.
An escalation deletes the asset/render metadata and preserves bytes solely in
`evidence_holds`. The existing Library authorization path and its RLS policy
check the canonical asset and active holds before delivery. Both enqueue and
the reaper recheck active holds. An issued upload grant also delays reaping
until its 15-minute lifetime plus one minute has passed, including user deletion
immediately after finalization. This prevents a late PUT recreating an orphan.

Browser admission, server admission before debit, and final-size reconciliation
count reservations under the same owner lock. Active server jobs reserve one
item and 25 MiB against the shared 100-item/200-MiB limits. The dedicated sweep
re-inspects uploaded bytes after a lost callback, invokes the same finalize
RPC, and refunds failed/lost/timed-out runs. It also queues closed output keys
with `not_before` preserving outstanding grant expiry. `STORED` jobs never enter the shared no-asset
failure branch. Auto Short excludes both montage and concat-render providers.

### Built status and acceptance limits

Slices 2 and 3 are implemented, including the round 4 corrections below.
Admission uses `EDITOR_SERVER_RENDER_ENABLED`; recovery independently uses
`EDITOR_SERVER_RENDER_RECOVERY_ENABLED`. Both ship explicitly false as
`serverRender` and `serverRenderRecovery` in `EDITOR_RUNTIME_FLAGS` in production
and staging, without adding text bindings or changing other flags. Only
POST create is gated; status, cancellation and signed callbacks keep working
when the switch is off. Refunded create replays return HTTP 409 with
`render_refunded` and `retry_with_new_key: true`.
Migrations `0396` and `0397` follow main's `0395`; the open-PR check found only
ADR-only PR #1656. No migrations were applied to a shared environment. The
catalog row is active with the owner's final price: 1 credit per 10 output
seconds at 1080p and per 15 seconds at 720p, rounded up, minimum 1 credit.
`credits_5s=1`, `cost_unit=per_second`, `billing_seconds=10` describe the base
1080p rate; `editor_render_rates` supplies exact resolution-specific
`billing_seconds` divisors (10 and 15). SQL computes the quote and debit, with
no approximate 1/15 rate and no application price arithmetic. Exposure stays
behind the flag. V1 eligibility limits are 120 seconds for 1080p and 300 seconds for 720p,
and both SQL and inspection enforce the 25 MiB output ceiling.

The translator ports the measured PoC and supports v2 sequences and v3 explicit
starts on one video, audio and text lane. It supports trim, placement, dissolve,
volume and vertically positioned centered text. It explicitly rejects other
transitions, extra lanes/overlaps, nondefault visual/audio edits, custom text
styling, horizontal text offsets and nonstandard source aspect ratios. These
are `editor_render_unsupported` before debit, not dropped edits. Sources are
owned generated assets, saved editor-renders, Film Library masters and recorded
cloud uploads; device-only files require a cloud source first. No UI was added.

The runner is implemented but has not been built or exercised against Concat
in this sandbox. The old PoC measurements above remain the only real-render
evidence; no new fidelity or performance claim is made. New tests exercise the
pure call plan, signed HTTP boundaries, replay/refund behavior, upload grants,
recovery, provider isolation and preservation-aware reaping. The PostgreSQL
acceptance suite includes actual settlement/escalation functions and concurrent
capacity/cancel cases; it requires an empty disposable local database. Sandbox
shared-memory restrictions prevented starting Postgres, so these SQL cases and
a full migration replay remain host acceptance work. No production credentials,
flags, deployments or publications were changed outside this checkout.

Configuration correction (HOST-1): the unrelated `CLIP_EDIT_SLOW_ENABLED` and
`WEBHOOK_DELIVERY_LOG_ENABLED` entries are restored exactly to their main values.
One standalone new flag would make 63 production vars against the existing
62-var budget. Only the new flag is therefore added to the existing editor
group, following ADR-0145; no existing flag is moved or changed. The separate
sweep flag is removed, superseding the original two-flag requirement as directed
by the host. A separate explicit `EDITOR_SERVER_RENDER_ENABLED` value remains
the standard grouped-flag rollback override. ESR-018 below supersedes the
shared admission/recovery switch by adding an independent grouped recovery key.

### First inspection fixes (ESR-009 through ESR-015)

The first inspection used an owner row lock with `FOR NO KEY UPDATE` for
admission, finalization, browser reservation, removal and failure. ESR-016 below
supersedes that lock with shared owner advisory serialization. Tests cover both
winners of cancel/finalize and an existing
key-share lock during admission. Browser reservation refuses new `server-` keys;
existing browser reservations using that prefix can still replay.

The reaper defers disallowed keys by one day and counts them as skipped, so held
or still-referenced keys cannot occupy every batch. An authorization RPC error
skips without incrementing deletion attempts. Migration 0397 supplies the reaper
authorization RPC and `not_before` column even while editor admission is off.
ESR-019 below previously relaxed database-first rollout for one release;
round 4 restores mandatory database-first deployment.

Queue-writer audit: `expire_assets` (0016, replaced by 0350), content takedown
(0146/0253, replaced by 0272), account erasure (0347), job deletion (0351) and
linked-render expiry (0397) enqueue and remove the canonical asset in the same
transaction. The reaper sees their committed deletion. Film-master expiry
(0279), browser-render expiry (0285, replaced by 0397), account-erasure upload
and social-upload cleanup, and job-step cleanup use their own keys; a surviving
canonical reference correctly postpones deletion. Evidence release (0275)
queues keys whose canonical assets were already removed during escalation.
Refund cleanup (0397) refuses active assets/holds. No other application queue
inserters were found. No existing writer needs changing for the live-asset
check; putting that check in the enqueue trigger would incorrectly discard
entries from writers that enqueue before deleting within a transaction.

Live SUBMITTED/FAILED recovery and REFUNDED cleanup use separate bounded queries
(100 and 25). Cleanup records permanently ineligible held/asset-backed keys so
they leave the candidate query. The canonical removal/evidence-release paths
own any later deletion. Upload sources require a
reservation younger than the existing 24-hour cleanup window, and matching R2
object size/type before debit; the reservation schema has no completion marker.
The j/e/u source paths check active evidence holds by object key. Tests include
an actual upload-source escalation, independently of the account freeze.

The runner retries network-failed PUTs at most three times, reopening the file
each time. HTTP 412 sends `done`: Worker inspection decides whether the existing
immutable bytes settle or refund the job. Tests cover a lost successful PUT
response followed by 412, invalid stored bytes and exhausted network retries.

Initial sandbox proof: `npm test` reports 5,599 tests, 5,590 passed, 7 failed and 2
skipped. The failures match the host-disclosed baseline: six localhost-listen
`EPERM` failures and the social-activity cursor timezone assertion. Those tests
were not edited. The focused suite reports 123 passed, zero failed and one
skipped (the opt-in PostgreSQL suite). `npm run build` stops during prebuild
asset preparation with `ENOTFOUND storage.googleapis.com`, before compilation.
Build, full database replay/concurrency proof and a real Concat render therefore
remain unverified; implemented status is not a claim that acceptance has passed.

After the first inspection fixes, sandbox `npm test` reports 5,606 tests:
5,597 passed, the same seven failures, and two skipped. The focused regression
suite reports 45 passed, zero failed, one skipped (PostgreSQL). Targeted ESLint
passes with the existing anonymous-default-export warning in `worker.js`;
catalog guards and whitespace checks pass. Build still stops before compilation
on the same asset-download DNS error. The host's prior run outside the sandbox
had only the pre-existing timezone failure; no failing baseline tests were edited.
The expanded real-SQL race and escalation cases remain unexecuted here because
no disposable test database is configured (the earlier local bootstrap was
denied by sandbox shared-memory restrictions).

### Second inspection fixes (ESR-016 through ESR-021)

The chosen ESR-016 alternative is a shared transaction advisory capacity lock:
`pg_advisory_xact_lock(261, hashtext(owner_user_id::text))`. Browser reservation,
server admission, finalization, failure and Library removal all use that same
lock instead of locking `users`. A hash collision only adds serialization.
No users row lock is held across balance locks. Admission locks the balance,
rechecks the owner, then debits and locks only its newly created job; replay
does not lock an existing job. Finalize/refund lock the existing job before the
balance, matching `ledger_refund` and the shared `sweep_stuck_jobs` path. A blanket
balance-first rewrite would invert that existing shared sweep order, so the
authorized advisory alternative is the smaller correct change. Shared money
functions remain unchanged. The PostgreSQL fixture loads the actual dispute,
freeze and unfreeze functions, interleaves dispute with admission/refund, and
tests finalization against a job-first shared-sweep refund.

`jobs.editor_render_output_key` and `editor_render_upload_expires_at` retain
the cleanup key and grant deadline when `delete_user_job` clears `inputs`.
The key is immutable once set. Deleting a REFUNDED render transactionally calls
cleanup and enqueues the stable key with its grant deadline. The sweep excludes
deleted jobs; the round 4 refund trigger below queues cleanup independently of
that query, and a later direct cleanup replay remains safe. Missing legacy keys
are marked handled rather than inserted: `asset_reap_queue.r2_key` is NOT NULL
in 0016, and every new cleanup insertion guards against NULL.

Recovery has its own grouped switch, off by default, and is wrapped in
`observeRecovery('editor_server_render', ...)`. Rollback means setting
`serverRender` false while leaving `serverRenderRecovery` true until outstanding
jobs have settled and cleanup is queued. Status, cancel and callbacks remain
available. Turning recovery off too is an explicit operational stop, not a
consequence of admission rollback.

For one release, reaping retries its old queue query if PostgREST specifically
reports the missing `not_before` column, and uses the previous deletion behavior
if `asset_reap_allowed` is specifically missing. Auth failures, network errors,
other SQL errors and unknown failures still fail closed. This compatibility
path is an accepted ESR-019 change and must be removed after all target databases
have 0397. Admission/recovery must remain off until migrations are confirmed.

Evidence release updates `released_at` in one statement, then enqueues in a
second statement within the same transaction. This avoids the enqueue trigger
reading the pre-update snapshot of the original data-modifying CTE. The database
test releases an actual escalation hold, checks for one due queue row, and
replays release. It also preserves any outstanding grant delay.

The Library read RPC and API omit `source_job_id`/`asset_id`. Linked removal maps
RATE_LIMITED to 429, ACCOUNT_FROZEN to 403, NOT_FOUND to 404, and hold/in-progress/
USED_BY_* conflicts to distinct 409 codes. The tenant adapter exposes only those
allowlisted codes on the removal path; arbitrary SQL messages stay hidden.
Generated `j-` sources require exactly one asset, rejecting ambiguous multi-asset
jobs before debit.

Round-two sandbox proof: `npm test` exits 1 with 5,610 tests, 5,601 passed,
the same seven known failures and two skipped. The focused regression command
passes 67 tests, zero failed, with the PostgreSQL suite skipped. Targeted ESLint
has zero errors and the existing `worker.js` default-export warning. Whitespace
checks and SQL-fixture generation pass. `npm run build` still exits during
prebuild with `ENOTFOUND storage.googleapis.com`. No failing baseline tests were
edited. The advisory-lock choice, independent grouped recovery switch and
one-release reaper compatibility are the authorized ESR-016/018/019 alternatives;
there are no additional work-order deviations. PostgreSQL execution remains
unverified in this sandbox; the commands below are required host acceptance.

### Release checklist and PostgreSQL acceptance

1. Keep both grouped render switches false. Run `npm test` and the database
   suite below. The latter requires a new empty **local PostgreSQL 15+ database**
   and a role permitted to create roles/extensions (a local test superuser).
2. Apply 0396 then 0397 through the normal migration workflow before Worker
   deploy and before enabling either switch (round 4 release requirement).
3. Confirm full migration replay/privileges and the new database tests; prove a
   real Concat render and strict R2 upload before activation. Price is approved;
   AGPL disposition remains an owner decision.
4. Enable recovery before admission when activation is authorized. During
   rollback, disable only admission and leave recovery running to drain jobs.
5. Remove the temporary pre-0397 reaper fallback in the following release after
   checking every target database has the migration.

From this checkout, with local PostgreSQL running (use `.pgpass`/`PGPASSWORD`
if authentication is required), run these exact commands:

```sh
createdb --host=127.0.0.1 --port=5432 --username=postgres editor_server_render_round2_test
EDITOR_RENDER_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:5432/editor_server_render_round2_test' node --test tests/editorServerRenderDatabase.test.mjs
```

Use a fresh database name for every run: the suite refuses an existing `jobs`
table and leaves fixtures for inspection. It loads the actual financial,
settlement, dispute, escalation and release functions plus 0396/0397; unrelated
platform tables/rate-limit services are minimal fixtures. It is not a substitute
for a full Supabase migration replay. SQL execution remains host acceptance work
here because the sandbox cannot start the local PostgreSQL server.

The accepted frozen work order is SHA256
`36b93c484eb65f6bb15dad06ffc5c683f0ffbe238c46182f0562e05521f859b9`.
That earlier order left price out of scope; the round 4 order below supplies it.
UI, fidelity/AGPL disposition, deployment and production activation remain outside
this implementation order.

### Round 4 corrections and release checklist

Frozen work order SHA256:
`6f10b3633d3f079ca797000ae3c52525d877a98a4f1f38c8ca696090dbd4a0c8`.

The host reports the pre-round-4 build passed 17/17 PostgreSQL cases, a full
372-migration replay and `npm test`. That is evidence for the prior build, not
verification of these edits. The expanded SQL suite and a real Concat render
through the HTTP runner still require host execution; no such run is claimed.

- Upload source PUT expiry no longer disqualifies completed bytes. The 24-hour
  reservation cap, evidence hold check and pre-debit R2 size/type proof remain.
- Editor-only signatures bind direction through distinct POST paths:
  `<timestamp>.POST /api/webhook/editor-render.<body>` versus `/run`, `/runs`
  and `/cancel`. Montage signing is unchanged. Grants are bounded to four per
  live job and refused after 45 minutes, cancellation or refund.
- Lost-run inference requires two persisted unknown observations at least one
  minute apart, after the three-minute launch grace. Callbacks clear the
  sequence; stale polls predating a callback cannot declare loss. Running and
  unavailable observations clear it; an explicit ended report remains loss
  evidence after the launch grace. The RPC arbitrates refund with
  callbacks under the job lock. The 45-minute timeout remains the backstop.
- Finalize uses VIDEO packet duration and `max(2 / frame_rate, 0.1)` seconds
  tolerance in Worker and SQL. Recorded spike probes: a 7 s 1080p 30 fps
  H.264+AAC render measured video **7.000000 s**, audio **6.976 s**; a 5 s render
  measured video **5.000000 s**, audio **4.970 s**. These recorded values are
  fixture evidence, not a new render. AAC duration is not the finalize target.
- A jobs transition to REFUNDED for `concat-render` queues cleanup in the
  refund transaction, including shared-sweep refunds. The existing cleanup RPC
  guards evidence holds, canonical assets and outstanding upload deadlines.
  Recovery must run as long as admission does, then until settlement and cleanup
  are complete. Turning admission off must not stop recovery.
- INVALID_RENDER returns HTTP 400. Already FAILED/REFUNDED jobs and JOB_CLOSED
  races during finalize acknowledge completion with HTTP 200 and mark the
  webhook event processed, without delivering bytes or issuing another debit.

Release checklist (not executed by this work order):

1. Apply **0396 and 0397 before Worker deploy**; this supersedes the earlier
   relaxed rollout order for this release. Run the expanded PostgreSQL suite
   against an empty database and replay all migrations.
2. Keep the Fly app at **one Machine maximum, no autoscaler**, in `ams`.
   `fly.toml` has no app-wide machine-count maximum setting: the proposed
   operational enforcement is `fly scale count 1 --max-per-region 1`, deployment
   with `--ha=false`, rolling replacement, and a one-Machine admission gate from
   the machine list. Follow the exact README procedure; no scaling or deploy
   command was run here. This is the explicit config-only requirement limitation.
3. Provision **EDITOR_RENDER_SIGNING_SECRET** on both sides and the configured
   runner/callback URLs and source hosts. The **runner token (CONCAT_API_TOKEN)**
   remains freshly generated per render, private to the wrapper/Concat process;
   preserve suppressed stdout/stderr. No token is checked in or logged.
4. Run a real Concat render through the runner and verify inspection, settlement,
   Library delivery, cancellation and cleanup. This remains host acceptance.
5. Production flag flip belongs to the **owner**. Admission and recovery still
   ship `"false"`; enable recovery with admission. No commit, push or publication
   is part of this work order.

Round 4 sandbox proof: `npm test` exited 1 after 115.3 s: **5,617 tests,
5,608 passed, 7 failed, 2 skipped**. Six failures are localhost `listen EPERM`
(auditRemediation, cinemaMalwareScanner and four deployRecovery cases); the
seventh is the existing socialActivityCursor positive-offset assertion. Those
files were not edited. Focused editor-render tests: **31 passed, zero failed,
one PostgreSQL suite skipped**. Catalog UPDATE guards, targeted ESLint and
`git diff --check` pass. Database execution/migration replay, application/container
builds and a real Concat render were not verified in this round.

## Slice 4 web: built, owner preview and round-1 fixes (2026-10-26)

Frozen work order SHA256:
`ae224b919e8f0343ed0505e24a05af017431e746d8d18df48a49eb7fb720b361`.

The web export modal offers **Export on server** below unchanged browser controls.
It requires an attached saved cloud project and uses `documentForTimeline`, the
save builder. Only the selected 720p or 1080p size is supported; other sizes show
a disabled reason. Unsupported edits remain translator errors. The panel warns
about preview differences and the server's MP4 / 30 fps output.

`editorServerRenderMode` maps grouped `serverRender` values `false`, `preview`,
`true` to `off`, `preview`, `on`; an explicit legacy flag overrides the group.
Boolean callers still accept only `true`. Both production render flags stay
`false`. After deployment, the owner can select `preview` and provision the
comma-separated UUID allowlist in Worker secret `EDITOR_SERVER_RENDER_PREVIEW_USER_IDS`.
Empty/missing admits nobody. Create and quote enforce 403 `preview_only`; owned
status/cancel continue regardless of admission mode. Recovery is independently gated.

Set the browser convenience switch in the console, then reopen Export:

```js
localStorage.setItem('veyrnox_editor_server_render', '1');
// Hide it again:
localStorage.removeItem('veyrnox_editor_server_render');
```

Neither the switch nor the UI is a security boundary. Either UI gate closed means
no panel DOM or requests. Preview-denied accounts' panels hide. REV-001 gates the
extra ProjectBar document/actor context with a prop: mode off retains the original
payload and doc-only changes do not trigger its context effect (regression tested).

`POST /api/v1/editor/server-render/quote` translates the same snapshot as create
and returns server credits, seconds, resolution and maximum duration. Confirmation
freezes document, size and label; any change invalidates it. Only Confirm admits,
with `quoted_credits`. Retries reuse body/key; a known failed attempt gets a new
key and quote. REV-002 rejects blank, over-160-character or control-character names
before quoting, with name-specific messages in all 11 locales and boundary tests.
Workspace state survives closing Export and the 402 credits-dialog handoff. Return
after top-up to re-quote. Existing generation balance is reused without a request.
Status handles uppercase mutations and `publicJob` reads; visible-tab polling backs
off from 3 to 10 seconds. REV-003 stops on 403/404 or five consecutive other failures;
success resets the streak. The stopped state survives reopening, offers status-only
retry, and keeps Cancel available. Terminal jobs/unmount stop polling. Delivery uses
`render_id` and existing Library asset/download routes. Pure and component tests cover this.

REV-004: quote and create each consume the shared `consume_upload_request` limiter.
Two requests per confirmed export are acceptable for this opt-in owner preview:
translation and admission both remain abuse-limited using the existing path.
Repeated quotes can exhaust that shared allowance; the limiter is unchanged.

Migration **0398** adds service-role-only quote/shared arithmetic. Admit drops the
old overload and checks consent after replay lookup, before debit/job creation;
other 0396 behavior and the browser-callable allowlist stay unchanged. Replay keeps
original credits/state after catalog changes. Apply 0398 before the Worker.
Main ended at 0397; checked open PRs 1658, 1662 and 1665 added no migrations.
Tests cover both resolutions at 10.0/10.03 seconds, quote/debit equality, price drift
without debit/job, original-price replay and PUBLIC/anon/authenticated denial.

Host acceptance of the pre-fix build: migration replay **374 clean**, PostgreSQL
**30/30**, `npm test` **5688/5691**, with the known timezone failure, as reported.
Round-1 browser keyboard/pointer, 375 px, dark/light and real runner checks remain
unverified here; prior local browser startup was blocked by `listen EPERM`.
Database tests/replay were not rerun for these UI-only fixes. No commit, push,
publication, deployment or flag flip. The mandatory knowledge generator retains
its existing >9,000-line format (previously reported size-limit deviation);
all other changed/new files remain under 500 lines.

Round-1 sandbox proof: `npm test` exits 1: **5,700 tests, 5,691 passed, 7 failed,
2 skipped** (86.9 s). Failures: six localhost `listen EPERM` cases and the known
socialActivityCursor timezone assertion; those tests are untouched. Focused suite:
**35 passed**. Targeted ESLint: zero errors, two warnings on existing confirmation
state code. Locale parity, knowledge freshness and `git diff --check` pass.
