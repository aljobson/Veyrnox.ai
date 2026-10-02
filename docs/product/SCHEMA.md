# Backend Schema — Veyrnox.ai

**Status:** Current · 2026-10-02 — reconstructed by replaying
`packages/db/schema/0001_initial.sql` and `supabase/0003…0166` in order.
**Authority:** the SQL. When this file and a migration disagree, the
migration wins and this file is wrong.
**Diagrams:** [diagrams/schema-map.html](diagrams/schema-map.html) (tables by
domain) · [diagrams/auth-flow.html](diagrams/auth-flow.html) (sign-up →
API call) · [diagrams/job-lifecycle.html](diagrams/job-lifecycle.html)
(`jobs.state`). Sources are the `.json` files beside them (Archify).
**Defects found:** [ISSUES.md](ISSUES.md) §Schema.

## 1. Rules every table follows

- **RLS enabled and forced on all 68 tables.** The Worker uses the service
  role (bypasses RLS); RLS is the second line.
- **Writes go through `SECURITY DEFINER` RPCs** with `SET search_path = ''`,
  `REVOKE ALL … FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE … TO
  service_role`. "Internal" functions revoke service_role too and are only
  called by other definers.
- **Append-only logs** carry a `BEFORE UPDATE OR DELETE` trigger:
  `ledger_entries`, `account_actions`, `top_up_order_collisions`,
  `audit_events`, `project_document_versions`, `cinema_creator_reviews`,
  `cinema_unlock_reversals`, `cinema_pass_events`, `cinema_pass_plays`,
  `cinema_submission_reviews`, `cinema_moderation_actions`,
  `cinema_operator_actions`, `cinema_operator_refund_receipts`,
  `social_account_actions`.
- **Idempotency** lives in the schema: `jobs (user_id, idempotency_key)`,
  `top_ups (user_id, idempotency_key)`, `webhook_events (source,
  external_id)`, `cinema_passes`, `cinema_submissions`, `social_posts` and
  tenant writes all carry a unique key.
- **Exception — tenant tables are browser-facing.** Organisations,
  workspaces, projects, documents and project assets are read through
  PostgREST with the user's JWT; RLS is the enforcing line there (ADR-0051).

## 2. Authentication flow

Supabase Auth is the only identity source. `public.users.auth_id` holds
`auth.users.id` as text (no FK — the auth schema is Supabase's).

```
auth.users INSERT ──► on_auth_user_created  (0071)
   ├─ anonymous / no email ......... nothing
   ├─ not yet confirmed ............ provision_user: public.users + credit_balances(0)
   └─ already confirmed ............ signup_grant (below)
auth.users UPDATE email_confirmed_at NULL → NOT NULL ──► on_auth_user_confirmed
   └─ signup_grant: provision + one grant:signup of 10 Free Credits (0127)
public.users INSERT ──► provision_personal_tenant (0135)
   └─ personal organisation + OWNER membership + default workspace
```

Request time: the browser sends the Supabase ES256 access token; the Worker
verifies it against JWKS and forwards `x-veyrnox-auth-{id,email,role,aal,
mfa-at}`; RPCs receive the auth id as a parameter and resolve
`public.users` themselves. `aal` and `mfa_at` are trusted Worker inputs to
the admin and Cinema-operator RPCs.

No passkey, Apple or MFA tables exist in `public` — those live in Supabase's
`auth` schema. Deleting an auth user cascades tenant memberships only; money
rows and `public.users` stay (no FK), and definer RPCs that join
`auth.users` then refuse the identity.

## 3. Tables by domain

Notation: **PK**, → FK target (ON DELETE), **U** unique, *(migration)*.

### 3.1 Identity and credits

| table | columns | keys and rules |
|---|---|---|
| `users` *(0001, 0032, 0059, 0146)* | id uuid, auth_id text, email, plan *(unused)*, is_admin, frozen_at, rights_attested_at, rights_attestation_version, created_at, updated_at | PK id; U auth_id; owner can SELECT own row |
| `credit_balances` *(0001, 0037)* | user_id, balance int ≥ 0, free_balance int, updated_at | PK/→ users (CASCADE); CHECK 0 ≤ free_balance ≤ balance |
| `ledger_entries` *(0001, 0037, 0073, 0171)* | id, user_id, delta int, free_delta int, reason text, job_id uuid, created_at | → users (RESTRICT); job_id logical only; **append-only**; U one `expire:free` per user; U keyed grants `grant:%#%`; U one refund per job; U one `grant:signup` per user |

Invariant: `credit_balances.balance = SUM(ledger_entries.delta)` and
`free_balance = SUM(free_delta)`, checked by `reconcile_balances()` and
`reconcile_free_credits()`.

Ledger `reason` vocabulary: `grant:signup`, `grant:topup`,
`grant:<x>#<key>`, generation debits, `refund:*`, `expire:free`,
`reverse:topup_refund`, `unlock:cinema:<id>`, `reverse:cinema_unlock:<id>`.

### 3.2 Catalog, jobs and assets

| table | columns | keys and rules |
|---|---|---|
| `model_catalog` *(0001, 0029)* | id text, name, provider, provider_endpoint, modality, credits_5s int > 0, provider_cost_per_unit, cost_unit (per_generation \| per_second), billing_seconds, gated_flag, active, updated_at | PK id; no client access at all; the public API reads it through the Worker |
| `jobs` *(0001, 0096, 0103)* | id, user_id, idempotency_key, model_id, credits > 0, state `job_state`, provider, provider_job_id, error_code, inputs jsonb, consent_attested_at, created_at, updated_at | → users (RESTRICT); U (user_id, idempotency_key); index (provider, provider_job_id); model_id logical only |
| `assets` *(0001, 0016, 0077)* | id, job_id, r2_key, mime_type, size_bytes, sha256, expires_at (90 days, trigger), created_at | → jobs (CASCADE); U r2_key |
| `job_steps` *(0091, 0092)* | id, job_id, step (script/voice/scene/stitch/trim/merge/audio), ordinal, provider, provider_endpoint, provider_job_id, state, attempts 1–2, output_r2_key, output_text, error_code | → jobs (NO ACTION); U (job_id, step, ordinal); Auto Short and Clip Editor composites |
| `asset_reap_queue` *(0016)* | id, r2_key, queued_at, attempts, last_error | U r2_key |
| `webhook_events` *(0001)* | id, source, external_id, payload, processed_at, created_at | U (source, external_id) — the webhook dedupe |
| `upload_reservations` *(0129)* | r2_key, user_id, size_bytes ≤ 100 MB, created_at, put_expires_at | → users (CASCADE) |

`job_state`: `PRICED` (unused) · `DEBITED` → `SUBMITTED` → `SUCCEEDED` →
`STORED`; `FAILOVER` (bounded retry, back to SUBMITTED); `FAILED` →
`REFUNDED`. `ledger_refund` accepts DEBITED, SUBMITTED, FAILOVER or FAILED
and refuses SUCCEEDED/STORED. `sweep_stuck_jobs` refunds anything stuck.

### 3.3 Billing

| table | columns | keys and rules |
|---|---|---|
| `credit_packs` *(0041, 0097, 0121)* | id, sales_channel ('web'), credits, price_usd_cents, variant_id (nullable), active | sticker floor `price × 10 ≥ credits × 43`; legacy net floor. Active: web-100, web-270, web-1200, web-3000 |
| `top_ups` *(0041 … 0108, 0167)* | id, user_id, pack_id, idempotency_key, credits, price_usd_cents, variant_id (null under Stripe, 0167), status (pending \| credited), consent_at/version, order_id, credited_at, grant_entry_id, refunded_cents, clawed_back_credits, return_* and backfill_* recovery columns, order_sweeps | → users, credit_packs, ledger_entries (all RESTRICT); U (user_id, idempotency_key), U order_id, U grant_entry_id |
| `top_up_flagged_orders` *(0054)* | order_id, top_up_id, user_id, reason, paid_usd_cents, currency, variant_id | incident records |
| `top_up_order_collisions` *(0068)* | id, order_id (numeric-only CHECK), top_up_id, credited_top_up_id | append-only |
| `account_actions` *(0059, 0062, 0146)* | id, user_id, action (freeze/unfreeze/dispute_resolved/warning/takedown), actor, reason, top_up_id, job_id, credits_taken, credits_shortfall | append-only; the only path to/from Frozen |

### 3.4 Rate limits and operations

Ten fixed-window tables, one row per user (`user_id` PK → users CASCADE,
`window_started_at`, `request_count`): `asset_link` (120/min),
`generation_attempt` (20), `job_read` (600), `upload_request` (60),
`account_read` (120), `top_up_checkout` (20), `top_up_read` (120),
`top_up_return` (30), `cinema_unlock` (20), `social_post_write` (20).
Plus `youtube_upload_daily_quota`.

Ops: `reconciliation_snapshot` (singleton), `worker_task_health`
(per cron task), `recovery_alert_reviews`, `recovery_health_snapshot`.

### 3.5 Tenants and projects *(0135–0141, 0163; staging only)*

| table | columns | keys and rules |
|---|---|---|
| `organisations` | id, owner_id, name, personal, deleted_at | U one personal org per owner |
| `organisation_members` | organisation_id, user_id, role (OWNER/ADMIN/CREATOR/EDITOR/REVIEWER/VIEWER/BILLING) | → auth.users (CASCADE) |
| `workspaces`, `workspace_members` | id, organisation_id, name, is_default, deleted_at; membership + role | U one default per org |
| `projects`, `project_members` | id, workspace_id, owner_id, name, version, deleted_at; membership + role | soft delete; audit trigger |
| `project_document_versions` | project_id, revision, document jsonb ≤ 32 KB, actor_id, restored_from, expected_revision, request_key | PK (project_id, revision); immutable |
| `project_assets` | id, project_id, r2_key, state (quarantined/inspected/rejected), declared/sniffed type and size, dimensions, reject_reason | quota + guard triggers |
| `audit_events` | id, request_id, actor_id, organisation_id, action, resource_id, result | append-only; OWNER/ADMIN read |
| `private.api_requests`, `private.project_asset_storage`, `private.project_asset_inspections` | idempotency, storage claims, inspection throttle | not exposed |

Role helpers `private.org_role / workspace_role / project_role` resolve
`auth.uid()` for RLS; `create_project`, `mutate_project`,
`save_project_document`, `reserve_project_asset` are invoker wrappers the
browser JWT may call.

### 3.6 Social Cinema *(0132–0150, 0163–0164; off in production)*

| table | purpose |
|---|---|
| `cinema_profiles`, `cinema_memberships` | username/display name; role (viewer/creator/moderator/administrator) and account status |
| `cinema_creator_applications`, `cinema_creator_reviews` | apply → review (append-only) |
| `cinema_content`, `cinema_content_mutations` | SERIES → SEASON → EPISODE tree (self-FK on (parent_id, creator_id)); lifecycle DRAFT/UNDER_REVIEW/PUBLISHED/SUSPENDED; categories ≤ 2 |
| `cinema_uploads` | Stream upload per content; states provisioning → uploading → processing → ready / error → deleting → deleted; recovery, removal and proxy-transfer claims |
| `cinema_prices` | episode_unlock 6, film_unlock 6, free_episodes 5, pass_ceiling_minutes 3,000 |
| `cinema_unlocks`, `cinema_unlock_reversals` | credit unlock → ledger entry; one live unlock per (user, content) |
| `cinema_pass_plans`, `cinema_passes`, `cinema_pass_events`, `cinema_pass_plays` | Stripe subscription state; one active pass per user; play seconds toward the ceiling |
| `cinema_submissions`, `cinema_submission_reviews`, `cinema_moderation_actions`, `cinema_categories` | publication review and moderation |
| `cinema_operator_actions`, `cinema_operator_refund_receipts` | operator reversals and pass refunds |

### 3.7 Veyrnox Publish *(0154–0161)*

| table | columns | keys and rules |
|---|---|---|
| `social_brands` | id, owner_user_id, label, timezone | → users (RESTRICT); one default brand per user |
| `social_accounts` | id, brand_id, network, external_account_id, display_name, scopes_granted, access_token_enc / refresh_token_enc (AES-GCM bytea; cleared on disconnect, 0168), token_expires_at, status (active/expired/revoked/error) | → brands (CASCADE); U (brand, network, external id); a token is required unless revoked |
| `social_account_actions` | actor_id, brand_id, action, target_id, detail | append-only |
| `social_posts` | id, brand_id, created_by_user_id, status, scheduled_at, global_text, idempotency_key | U (brand_id, idempotency_key) |
| `social_post_media` | post_id, position, media_type, source_job_id → jobs | the caller's own generated asset |
| `social_post_targets` | post_id, account_id, network, text_override, publish_status (pending/publishing/submitted/delivered/published/failed), attempts, claimed_at, claim_key, next_attempt_at, last_error, platform_post_id/url, provider_state | U (post_id, account_id); claimed by the cron sweep; only the current `claim_key` may report (0168) |

## 4. Key RPCs

| area | functions |
|---|---|
| ledger | `ledger_debit` (lock, idempotency, freeze check, rate window, free-first spend, creates DEBITED job), `ledger_refund` (one per job, back to source), `ledger_grant` (keyed), `signup_grant`, `provision_user`, `expire_free_credits`, `read_user_balance`, `read_user_credits`, `freeze_account`, `unfreeze_account` |
| jobs | `job_submitted`, `job_succeeded`, `job_failed`, `job_stored`, `job_submit_rejected`, `get_user_job`, `list_user_jobs`, `get_user_asset`, `job_step_*`, `sweep_stuck_jobs`, `expire_assets` |
| top-ups | `create_pending_top_up`, `credit_top_up`, `read_top_up`, `apply_top_up_refund`, `apply_dispute_event`, `record_top_up_return_session`, `next_top_up_backfill_batch`, `close_top_up_return`, `operator_*` reads |
| reconciliation | `reconcile_balances`, `reconcile_free_credits`, `reconcile_top_ups`, `reconcile_failed_refunds`, `refresh_reconciliation_snapshot`, `reconcile_status`, `refresh_recovery_health`, `recovery_status` |
| rate limits | `check_generation_rate_limit`, `consume_*_request` (×9), `consume_youtube_upload_quota`, `reserve_upload`, `release_upload` |
| admin | `ops_metrics_24h`, `admin_lookup_user`, `record_content_violation`, `list_content_violations` (all check `users.is_admin`) |
| Cinema | profile/creator/draft/upload/unlock/pass/publication/operator families (~45 functions) |
| Publish | `get_or_create_default_social_brand`, `list_social_accounts`, `record_social_account_connection`, `disconnect_social_account`, `create_social_post`, `list_social_posts`, `claim_due_social_post_targets`, `report_social_post_progress`, `complete_social_post_target`, `update_social_account_token`; internal `settle_social_post`, `social_fail_inactive_targets` (0168) |

Anon-callable by design (read-only status): `catalog_watch`,
`applied_migration_names`, `reconcile_status`, `recovery_status`.

## 5. Scheduled work in Postgres (`pg_cron`)

| job | schedule | runs |
|---|---|---|
| `veyrnox-expire-assets` | every 15 min | `expire_assets(500)` |
| `veyrnox-sweep-stuck-jobs` | every 10 min | `sweep_stuck_jobs()` |
| `veyrnox-expire-free-credits` | hourly :41 | `expire_free_credits()` |
| `veyrnox-reconcile-balances` | daily 03:17 | raises on any row from the four reconcilers |
| `veyrnox-reconciliation-snapshot` | every 15 min | `refresh_reconciliation_snapshot()` |
| `veyrnox-recovery-health` | every 15 min | `refresh_recovery_health()` |

Everything else (asset reap, upload sweep, top-up backfill, Cinema upload
checks, publish queue, project asset cleanup) runs from the Worker cron.

## 6. Migration conventions

- `packages/db/schema/supabase/NNNN_snake_case.sql`, idempotent, applied to
  production only by `apply-migrations.yml` after owner approval (ADR-0023).
- Next free number on `main`: **0167** — check open PRs (#369) first.
  Gaps: 0039, 0040, 0061, 0076, 0118, 0119, 0151, 0158 (renumbered; 0163/0164
  carry their applied names 0151/0158).
- Catalog UPDATEs from 0111 assert an exact positive `ROW_COUNT`
  (`scripts/check-catalog-update-guards.mjs`).
- Every new function names its full signature in `REVOKE ALL … FROM PUBLIC,
  anon, authenticated` and `GRANT EXECUTE … TO service_role`.
