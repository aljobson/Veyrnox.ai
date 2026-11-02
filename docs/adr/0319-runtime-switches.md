# ADR-0319 — Database overrides for new feature admissions

Status: implemented for owner review; not deployed.
Date: 2026-11-02.

Migration 0429 adds owner-controlled overrides without Worker bindings.
Generation, chat, publish and cinema are kill keys: off pauses admission; on or
absent preserves deployment gates. No switch enables a deployment-disabled
feature. Telemetry and support_intake are enable keys, absent/off by default, connected
to hourly aggregation and stored ticket intake respectively. No email is sent
and this work changes no production flag.

The registry identifies every key and admission point; a unit test compares the
SQL key constraint. `admin_switch_set` requires switches.write (owner), reason,
idempotency and trusted fresh AAL2. It uses [ADR-0318](0318-admin-panel-roles.md)'s
locked mutation path and checks freshness after locking the switch row as well.
Override, audit and exact-response receipt share a transaction. The page shows
who/when/why and distinguishes Paused, Deployment controlled, Enabled and Off;
it does not claim that provider or deployment gates are all open.

One shared in-flight PostgREST key/state read per isolate is cached for 15 seconds.
Healthy overrides reach an active Worker within 15 seconds; a request on an expired
or cold cache waits up to approximately 0.4 seconds for refresh before a kill gate
is evaluated. Fresh cache evaluation uses the stored value; refresh returns an already-resolved
promise without a database read or network wait.
The refresh timeout is injectable in tests; production also sets the PostgREST
read timeout to 400 ms. On timeout/error all switches retain their last good
values, including a paused kill gate. Only a never-loaded cache fails open for
kill keys and defaults enable keys off. One fixed diagnostic is logged and reads
are backed off for five seconds; requests during that window use cached values
without a network wait. This restores the frozen plan's stale-while-error policy.
Already admitted work continues. Refresh always returns a promise, including on
the fresh/back-off path. The scheduled publish chain also normalizes and catches
the refresh promise before running its sweep, so read failure cannot skip recovery.

After edge/body checks, the production Worker prepares generation, developer API,
MCP, chat and listed Cinema admissions with that bounded shared refresh and then
evaluates the cached gate. Direct handler tests remain cached-only strict no-ops
when no switch is set; standalone Next servers need an equivalent refresh boundary.
The scheduled publish task refreshes before its sweep. Telemetry control also
triggers this same cache refresh via ctx.waitUntil with an explicit rejection
catch; there is no separate refresh clock. Healthy traffic causes at most one
runtime_switches read per isolate per 15 seconds across all consumers (including
while telemetry is off, so DB-only enable changes can be discovered). This is
a continuous steady control-plane cost under traffic: one read per active isolate
per 15 seconds, independent of whether telemetry is enabled. Idle isolates do
not poll. A shared fresh value skips the read; no consumer has a second timer. Concurrent
control and admission calls share one promise. Failed reads retry after five seconds.
Cache state uses a named isolate-global Symbol shared across Worker/handler chunks.
No host, CSP, cookie, dependency or environment binding is added.

Admission points and intentional exceptions:

- Generation checks once in POST /api/v1/generations after shape validation and
  before admission/debit work. Paid/free, POST /api/v1/developer/generations and
  POST /api/v1/mcp generation calls share it. During a pause, an ownership-scoped
  jobs lookup permits existing idempotency keys to follow ordinary replay/recovery;
  unknown keys are refused before debit. With no pause this extra lookup never runs.
  Dispatch consumers and settlement continue. At the host's explicit request,
  the original validator stays in the route, with only imports and the cached
  pause check added. Its pre-existing file-size exception remains; the extracted
  validator helper was removed rather than changing legacy source contracts.
- Chat checks once in runChatTurn for POST /api/v1/chat/threads/:id/messages
  before context, debit or provider calls. Existing owned job keys may replay
  during a pause; new keys are refused. Existing streams still complete or refund.
- Publishing checks at socialPublishSweep.dispatch. Nonempty server-written
  provider state denotes in-flight work and continues, including container,
  upload, polling and uncertain-result recovery. Fresh targets receive an
  internal feature_paused/503 refusal. Cron has no HTTP response: it counts
  paused targets and continues others. The additional service-only machine RPC
  runtime_defer_publish validates the claim key and empty provider state, restores
  the prior claim snapshot and attempts, and schedules retry in 15 seconds. It
  cannot dispatch or settle. It takes a claim key, not human admin credentials.
  Failed deferral leaves stale-claim recovery responsible; no attempt is failed.
  A cached pause can briefly defer after resume, so the RPC accepts that cached
  verdict without requiring the current database switch still be off.
  The existing v2 claim RPC additionally excludes empty-state targets while
  the persisted publish override is off, before ORDER/LIMIT. Otherwise paused
  fresh work could repeatedly fill a batch and starve continuations. This is a
  scheduler eligibility filter in the same dispatch path; all other 0395 claim
  semantics are preserved. A rollback fixture with a one-slot batch checks that
  an older fresh target yields to an in-flight target, then resumes when on.
- Cinema has no common async application admission helper. Its central Worker
  fetch calls cinemaRuntimeGate for POST/PUT/PATCH on these /api/v1/cinema paths:
  play, unlocks, pass, uploads, uploads/from-library, content, content/submit,
  comments, votes, voting, story-polls, story-choices. Reads, heartbeat/progress,
  upload transfer/refresh, pass return/cancel/portal, withdrawals, deletion,
  admin operations and webhooks continue. A direct Next route invocation does
  not exercise this production Worker boundary. This intentionally does not
  pause every Cinema read or moderation operation.


Coverage does not include these separately admitted paths (verified in this checkout;
no gates have been added without an owner decision):

- POST /api/v1/editor/server-render and /api/v1/editor/server-render/quote:
  lib/editorServerRender.js admits paid rendering through admit_server_render and
  submits to the isolated runner. Neither is covered by generation. Status,
  cancellation and render webhooks also remain available as settlement controls.
- POST /api/v1/voice-profiles/:profileId/speech: its own ledger_debit and ElevenLabs
  synthesizeSpeech path, independent of generation. Voice-profile creation and
  sample/verification routes are likewise outside these switches.
- Paid editor exports use the ungated server-render admission above.
  POST /api/v1/library/editor-renders is a separate browser export reservation
  through reserve_editor_library_render in lib/editorRenderApi.js (0397). It is
  ungated, but does not itself debit Credits or invoke a render provider; upload
  and inspect complete the locally rendered export. These are not generation
  admissions.
- POST /api/v1/montage/plan calls the runner /plan without a generation switch.
  The route does not debit; its comments disagree on possible planning model cost,
  so provider cost cannot be guaranteed from this gateway alone. Approved montage
  execution goes through POST /api/v1/generations and is gated.
- POST /api/v1/film-studio and PUT /api/v1/film-studio/:id save project metadata via
  save_film_studio; they are ungated but do not themselves debit or invoke a
  generation provider. Film Studio assistant chat uses the chat path; ordinary
  generated shots use the generation path. These labels are not blanket switches
  for every operation in the named product.

Publish gates the scheduled socialPublishSweep.dispatch/claim path, not the
social-post draft/create APIs. Telemetry gates Worker response aggregation plus
telemetry_ingest. Support intake gates POST /api/v1/support/tickets plus
support_ticket_create; admin replies remain available and never send email.

HTTP admission refusals are 503 feature_paused, no-store, Retry-After 15.
Refunds, webhooks, reconciliation and settlement have no new pause check.
Runtime rows force RLS; service_role can SELECT for the cache but only guarded
RPCs can write. Operator reasons/updater IDs are retained operational records,
classified by deletion tests. No ledger or credit-balance writer is added.

Pure tests cover TTL, deduplication, stale/cold failures, typed refusals,
continuation exemptions and unchanged wrangler bindings. The host-run local
rollback script test-admin-panel-switches.mjs covers permissions, MFA after
contention, replay, audit and claim restoration. The host must also verify the
Worker build and Cinema Worker boundary; unit tests do not prove these.
