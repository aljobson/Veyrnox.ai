# ADR-0310: Out-of-band liveness watch for the security-detection engine

Status: accepted (2026-10-31)
Relates: ADR-0104 (security alerts / detection engine, migrations 0336/0342),
ADR-0083 (webhook delivery log), ADR-0160 (supabase-status-alert), ADR-0307
(money-spine assessment fixes). Finding F-10 (D1, D2) of the 2026-10-31 security
assessment (`.gstack/security-reports/2026-10-31/agents/12-detection-logging.md`).
Migration 0418.

## Context

The 2026-10-31 assessment confirmed a real detection layer exists (ADR-0104): a
`security_events` table, a six-rule Sigma-style catalogue, `run_security_detection()`
on a 5-minute in-DB `pg_cron` schedule, and an admin dashboard at
`/app/admin/security`. Detection is largely *possible*. The findings are two gaps
in that layer:

- **D1 — no out-of-band liveness or notification.** The engine is scheduled only
  inside migration 0336, conditional on `pg_cron`. If `pg_cron` is absent or the
  job errors, detection stops and the silence is invisible — exactly the failure
  `reconcile-watch.yml` was built to cure for the ledger ("that failure lived only
  in `cron.job_run_details`, which nothing reads"). Alerts land in a table an admin
  must remember to open; a 3am freeze or admin-403 storm pages no one. The ledger
  got a GitHub-Actions poller + issue-filing; the security engine did not.

- **D2 — SEC-001 is dark in production.** The webhook-signature-failure rule
  (`SEC-001`) reads `webhook_deliveries WHERE outcome='rejected_signature'`. Those
  rows are written only by `withDeliveryLog` (`lib/webhookDelivery.js`), which
  no-ops unless `WEBHOOK_DELIVERY_LOG_ENABLED === 'true'`. Production sets it
  `"false"`; staging sets it `"true"`.

## Decisions

### D1 — a heartbeat the engine leaves, and a poller that watches it (0418, detection-watch.yml)

- **0418** adds `security_detection_runs`, an append-only heartbeat table, and
  redefines `run_security_detection()` (body otherwise identical to 0342) to
  `INSERT` one row at the end of every completed run. The insert is the last
  statement, so a run that errors on any rule rolls back the heartbeat with it: a
  failed run must not read as a live one. It also adds `security_detection_status()`,
  a `STABLE SECURITY DEFINER` reader returning the age of the last run and the
  count of open high/critical alerts. Both touch only detection bookkeeping —
  never ledger, `credit_balances` or any user-facing table. All new objects
  `REVOKE` from `PUBLIC`/`anon`/`authenticated` and `GRANT EXECUTE` to
  `service_role`; the reader is **not** anon-callable (unlike `reconcile_status`),
  because the detection tables never expose to the browser (ADR-0104).

- **`.github/workflows/detection-watch.yml`** mirrors `reconcile-watch.yml`: every
  quarter-hour it reads `security_detection_status()` via `scripts/check-detection.mjs`
  and exits 0 (healthy), 1 (needs attention), or 2 (could not read — not a pass).
  On exit 1 a `report-attention` job files/updates one `security-detection` GitHub
  issue per episode. "Needs attention" means either no heartbeat in ~15 minutes
  (three missed 5-minute runs — the engine is silent) or any open, unacknowledged
  high/critical alert.

- **Why service-role, not the anon `reconcile_status` pattern.** `reconcile_status`
  is counts-only and deliberately anon-callable so no secret lives in Actions
  (PR #61). The detection surface is kept service-role per ADR-0104, so the watcher
  authenticates with the project's service-role key. The workflow reads
  `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` secrets; both must point at the
  **production** project for the watch to cover production (owner step below).

### D2 — SEC-001's input is correct; lighting it in production is the owner's flag flip

No code change was needed. Verified:

- Every webhook route (`stripe`, `fal`, `kie`, `openrouter`, `cinema-stream`,
  `montage`, `editor-render`, `revenuecat`) wraps its handler with
  `withDeliveryLog`, and `classify(401, …)` returns `'rejected_signature'` — the
  exact signal `SEC-001` groups on. Signature failures answer 401 (e.g.
  `stripe/route.js:98`, `streamWebhook.js:14`), so with the flag on each one writes
  a `rejected_signature` row. `tests/webhookDelivery.test.mjs` pins this.

- `withDeliveryLog` writes nothing unless `WEBHOOK_DELIVERY_LOG_ENABLED === 'true'`
  and the `webhook_deliveries` table (migration 0276) exists. There is no code path
  that drops a signature failure when the flag is on, so no fix is required here.

Per the assessment's own plan and CLAUDE.md, flipping a production flag is the
owner's explicit call. This PR does **not** flip it. Lighting SEC-001 in production
remains the two owner steps below.

## Consequences

- D1 now detects: (1) the detection engine going silent (pg_cron stopped/absent or
  a run erroring, no heartbeat in ~15 min) and (2) any open, unacknowledged
  high/critical alert — both as a `security-detection` GitHub issue, which notifies
  through GitHub's own channels. Before this, both were invisible until an admin
  opened the dashboard.
- Nothing new is exposed to `anon`/`authenticated`; the redefined engine keeps its
  `service_role`-only grant and `SET search_path = ''`. Migration 0418 is idempotent
  and contains no catalog UPDATE. Only ever adds a heartbeat row and two reads —
  it withholds nothing and keeps the previous release working under the Worker-only
  rollback contract.
- The watcher uses the service-role key. If the configured secret is a staging key,
  it watches staging, not production — see the owner steps.

### Owner steps (not done here)

1. **Apply migration 0418** via the `apply-migrations` workflow after approval (not
   applied to any real project by this PR).
2. **Set the Actions secrets** `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the
   **production** Supabase project so `detection-watch.yml` watches production. (The
   staging service-role key is environment-scoped to `fal-dispatch-staging`; the
   repo-level secret must be the production one for this watch.)
3. **For D2 / SEC-001 in production:** apply migration 0276 (`webhook_deliveries`)
   if not already applied, then flip `WEBHOOK_DELIVERY_LOG_ENABLED` from `"false"`
   to `"true"` in `wrangler.jsonc` and deploy. Until then SEC-001 is exercised on
   staging only. No code change is needed for the rule to fire once the flag is on.

## Verification

- `tests/securityDetectionHeartbeat.test.mjs` pins the 0418 SQL: the engine writes a
  heartbeat and prunes, the status reader is service-role only with `search_path`
  cleared, and the engine keeps its privileges.
- `tests/checkDetection.test.mjs` drives `fetchDetectionStatus`/`evaluate` with a
  stubbed `fetch`: healthy, silent engine (stale and never-run), open high/critical,
  both at once, and malformed/unreadable rows.
- `tests/detectionWatch.test.mjs` pins the workflow shape (schedule, evidence
  retention, no cancel-in-progress, service-role env, one-issue-per-episode).
- `tests/webhookDelivery.test.mjs` (existing) already proves the D2 path.
- Staging live check: disable the `veyrnox-security-detection` pg_cron job and
  confirm `detection-watch` files an issue within a quarter-hour; re-enable and
  confirm it clears on the next healthy read.
