# ADR-0104 — Security alerts in the admin dashboard

- **Status**: **Accepted 2026-10-17; built 2026-10-17**, behind `SECURITY_EVENTS_ENABLED` (off until migration 0336 is applied, then staging, then production on the owner's word).
- **Date**: 2026-10-17
- **Related**: [ADR-0083](0083-admin-operations-surface.md) (admin gates, webhook deliveries), [ADR-0078](0078-admin-checks-in-code.md) (identity headers, Access in code), `CLAUDE.md` ("Security Logging & Monitoring Failures", "API gateway")

## Context

Security-relevant refusals reached only `console.error`: a refused sign-in (`[auth] rejected`), an Access refusal on an admin route (`[access] refused`), a bad webhook signature. The Worker log is a tail, not a record: nobody sees a burst unless they happen to be tailing. Other signals are already in tables (`webhook_deliveries`, `account_actions`, `webhook_events`) but nothing reads them together. The owner asked for a SIEM-style Security Alerts area in the admin dashboard.

## Open-source options considered

Wazuh (GPLv2), Graylog Open (SSPL), Security Onion (Elastic License 2.0), Matano (Apache-2.0, AWS-only), CrowdSec (MIT), Falco (Apache-2.0), Elastic/OpenSearch Security Analytics, Hayabusa (AGPLv3), Apache Metron (retired), and the Sigma rule format with pySigma. None can run inside a Cloudflare Worker; all that ingest logs need a host or cloud account of their own (Wazuh sizing starts around 8 GB RAM), and two are source-available rather than open source. The licences and sizes were read from repository pages and search snippets on 2026-10-17; re-check them before installing anything.

## Decision

1. **Borrow formats, run no SIEM.** The detection layer is Postgres. It takes ECS-style event fields, Sigma-style rules (a catalogue row with a level, a window, a threshold and tags), MITRE ATT&CK tags, and a triage lifecycle. Nothing from those projects is linked or copied.
2. **Events** (`security_events`, 0336): category, action code, outcome, path, status, our own reason code. Append-only (UPDATE refused), pruned at 90 days, written only through `record_security_event` with the service role. **Never** a token, header value, payload or address: the source is an HMAC of the connecting address keyed by `SECURITY_EVENTS_HASH_KEY` (a Worker secret), truncated. Without the key the source is omitted and source-grouped rules stay quiet.
3. **Writers.** `middleware.js` records each auth rejection (off the response path, via `waitUntil`); `lib/accessJwt.js` and `lib/adminGate.js` record admin access and second-factor refusals. Recording is bounded to two seconds, swallows its own failure and never changes the answer.
4. **Rules** (`security_rules`, `run_security_detection()`): one scheduled SQL function, every five minutes through pg_cron when the extension is present. Sources: `security_events`, `webhook_deliveries`, `webhook_events`, `account_actions`. Thresholds live in the catalogue table, not in this ADR.
5. **Alerts** (`security_alerts`): one row per rule, entity and hour (`dedup_key` UNIQUE), so a replay or the next run updates the count and `last_seen` and never raises a second alert. States: open, acknowledged, investigating, resolved, false positive. A resolved alert is not reopened by more events in the same hour.
6. **Triage trail** (`security_alert_actions`): append-only, with the admin's email as actor, from and to state, and an optional note.
7. **Admin surface.** `GET`/`POST /api/v1/admin/security` behind the four existing gates (`adminGate`) and each RPC's own `is_admin` check (42501); page at `/app/admin/security`, linked from `/app/admin`. Responses are `no-store`.
8. **No automatic action.** An alert never freezes, bans or emails. The operator uses the existing freeze flow.

## Not in this ADR

- An external SIEM. If wanted later, Cloudflare Logpush and Supabase log drains can feed one read-only; the in-app alerts stay the system of record.
- Notifications (email, chat) on a new critical alert.
- Rules over product telemetry, rate-limit tables, or Stripe dispute events beyond what `account_actions` already records.
- Per-alert event drill-down; v1 shows the latest events beside the alerts.

## Consequences

- A burst of forged tokens, a signature failure streak from one provider, an Access refusal or a freeze now shows up in one place with a severity and an ATT&CK tag.
- One more table to prune and one more cron job; the cost is small and bounded by the retention.
- Alerts are as good as the signals: auth rejections are recorded only when the flag and the hash key are set, and the rules are a starting set to tune.

## Tests

- `tests/adminSecurity.test.mjs` (gates, validation, RPC arguments, recorder redaction, source key), `tests/adminDashboardAccess.test.mjs` and `tests/identityHeaders.test.mjs` (the new route is behind the Access and second-factor gates).
- Migration replayed twice on a fresh Postgres, detection run twice (no duplicate alerts), triage, non-admin refusal and both append-only triggers checked by hand on 2026-10-17.
