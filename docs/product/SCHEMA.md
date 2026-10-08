# Backend Schema — Veyrnox.ai

**Status:** Current · 2026-10-08 (audited against `main` at `42150476`) —
reconstructed by replaying `packages/db/schema/0001_initial.sql` and
`supabase/0003…0227` in order (84 tables). Every file through 0227 is in the
production migration ledger (`check-migration-ledger.mjs`, 2026-10-08).
**Authority:** the SQL. When this file and a migration disagree, the
migration wins and this file is wrong.
**Diagrams:** [diagrams/schema-map.html](diagrams/schema-map.html) (tables by
domain) · [diagrams/auth-flow.html](diagrams/auth-flow.html) (sign-up →
API call) · [diagrams/job-lifecycle.html](diagrams/job-lifecycle.html)
(`jobs.state`). Sources are the `.json` files beside them (Archify).
**Defects found:** [ISSUES.md](ISSUES.md) §Schema.

## 1. Rules every table follows

- **RLS enabled and forced on all 84 tables** (81 in `public`, 3 in
  `private`; the count is `CREATE TABLE` minus `DROP TABLE` across every
  migration — 68 at 0166). The Worker uses the service role (bypasses RLS);
  RLS is the second line. The newer feature tables (chat, referrals, free
  allowance, subscriptions, analytics, device uploads) have no client policies
  at all: they are reached only through definer functions.
- **Writes go through `SECURITY DEFINER` RPCs** with `SET search_path = ''`,
  `REVOKE ALL … FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE … TO
  service_role`. "Internal" functions revoke service_role too and are only
  called by other definers.
- **Append-only logs** carry a `BEFORE UPDATE OR DELETE` trigger:
  `ledger_entries`, `account_actions`, `top_up_order_collisions`, `top_up_flagged_orders` (0174),
  `audit_events`, `project_document_versions`, `cinema_creator_reviews`,
  `cinema_unlock_reversals`, `cinema_pass_events`, `cinema_pass_plays`,
  `cinema_submission_reviews`, `cinema_moderation_actions`,
  `cinema_operator_actions`, `cinema_operator_refund_receipts`,
  `social_account_actions`, `credit_subscription_events` (0186). Each also has a
  statement-level `BEFORE TRUNCATE` guard (0177, 0186;
  `scripts/test-append-only.mjs` fails on a table that lacks one).
- **Idempotency** lives in the schema: `jobs (user_id, idempotency_key)`,
  `top_ups (user_id, idempotency_key)`, `webhook_events (source,
  external_id)`, `credit_subscription_events (stripe_event_id)`,
  `model_free_allowance_claims (user_id, idempotency_key)`, `cinema_passes`, `cinema_submissions`, `social_posts` and
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
| `users` *(0001, 0032, 0059, 0146, 0178)* | id uuid, auth_id text, email, is_admin, frozen_at, rights_attested_at, rights_attestation_version, created_at, updated_at (`plan` dropped, 0178) | PK id; U auth_id; owner can SELECT own row |
| `credit_balances` *(0001, 0037, 0183)* | user_id, balance int ≥ 0, free_balance int, subscription_balance int, subscription_expires_at, subscription_cycle int, updated_at | PK/→ users (CASCADE); CHECK 0 ≤ free_balance ≤ balance and free + subscription ≤ balance |
| `ledger_entries` *(0001, 0037, 0073, 0171, 0183)* | id, user_id, delta int, free_delta int, subscription_delta int, subscription_cycle int, reason text, job_id uuid, created_at | → users (RESTRICT); job_id logical only; **append-only**; U one `expire:free` per user; U keyed grants `grant:%#%`; U one refund per job; U one `grant:signup` per user |

Invariant: `credit_balances.balance = SUM(ledger_entries.delta)`,
`free_balance = SUM(free_delta)` and `subscription_balance =
SUM(subscription_delta)`, checked by `reconcile_balances()`,
`reconcile_free_credits()` and `reconcile_subscription_credits()`. Debits spend
Subscription, then Free, then Pack Credits; a free-allowance job writes **no**
ledger row (it is a price waiver, ADR-0069).

Ledger `reason` vocabulary: `grant:signup`, `grant:topup`,
`grant:<x>#<key>`, generation debits, `refund:*`, `expire:free`,
`reverse:topup_refund`, `unlock:cinema:<id>`, `reverse:cinema_unlock:<id>`,
`grant:subscription:<grant key>`, `expire:subscription`,
`reverse:subscription_refund`, `grant:referral#referral-<referee id>`,
`reverse:referral`.

### 3.2 Catalog, jobs and assets

| table | columns | keys and rules |
|---|---|---|
| `model_catalog` *(0001, 0029, 0196–0198, 0205, 0208, 0213)* | id text, name, provider, provider_endpoint, modality (adds `text`), credits_5s int > 0 ("Credits per reply" for text rows), provider_cost_per_unit, cost_unit (per_generation \| per_second), billing_seconds, gated_flag, active, updated_at; chat columns `chat_max_reply_tokens`, `chat_reasoning_effort`, `chat_thinking_*`, `chat_web_extra_credits/cost`, `chat_web_engine` (`plugin` \| `capped`), `chat_images_extra_*`, `chat_research_*`; `free_allowance_per_day`, `free_allowance_daily_budget` | PK id; no client access at all; the public API reads it through the Worker (chat rows are filtered out of `/api/catalog`). CHECK: an allowance needs `per_generation`, cost ≤ $0.05 a job and budget × cost ≤ $1.00 |
| `jobs` *(0001, 0096, 0103, 0206)* | id, user_id, idempotency_key, model_id, credits > 0 (or 0 when `free_allowance`), free_allowance bool, state `job_state`, provider, provider_job_id, error_code, inputs jsonb, consent_attested_at, created_at, updated_at | → users (RESTRICT); U (user_id, idempotency_key); index (provider, provider_job_id); model_id logical only; CHECK `credits > 0 OR free_allowance`; a chat reply's `inputs` holds `{kind: chat, thread_id}` and no text |
| `assets` *(0001, 0016, 0077)* | id, job_id, r2_key, mime_type, size_bytes, sha256, expires_at (90 days, trigger), created_at | → jobs (CASCADE); U r2_key |
| `job_steps` *(0091, 0092, 0225, 0227)* | id, job_id, step (script/voice/scene/stitch/trim/merge/audio/captions/montage), ordinal, provider, provider_endpoint, provider_job_id, state, attempts 1–2, output_r2_key, output_text, error_code | → jobs (NO ACTION); U (job_id, step, ordinal); Auto Short, Clip Editor (captions last) and video-agent (`montage`, provider `montage`) composites |
| `asset_reap_queue` *(0016)* | id, r2_key, queued_at, attempts, last_error | U r2_key |
| `webhook_events` *(0001)* | id, source, external_id, payload, processed_at, created_at | U (source, external_id) — the webhook dedupe |
| `upload_reservations` *(0129)* | r2_key, user_id, size_bytes ≤ 100 MB, created_at, put_expires_at | → users (CASCADE) |
| `model_free_allowance_claims` *(0205)* | user_id, idempotency_key, model_id → model_catalog, day (UTC), state (TAKEN \| RETURNED), created_at, returned_at | PK (user_id, idempotency_key); written by `free_allowance_take` / `free_allowance_return`; `submit_free_job` (0206) takes it and inserts the 0-credit job in one transaction |

`job_state`: `PRICED` (unused) · `DEBITED` → `SUBMITTED` → `SUCCEEDED` →
`STORED`; `FAILOVER` (bounded retry, back to SUBMITTED); `FAILED` →
`REFUNDED`. `ledger_refund` accepts DEBITED, SUBMITTED, FAILOVER or FAILED
and refuses SUCCEEDED/STORED. `sweep_stuck_jobs` refunds anything stuck. A zero-credit free-allowance job is
refunded by `ledger_refund`'s zero branch, which returns the allowance and
writes no ledger row; a chat reply ends `STORED` with no `assets` row
(`chat_complete_turn`).

### 3.3 Billing

| table | columns | keys and rules |
|---|---|---|
| `credit_packs` *(0041, 0097, 0121)* | id, sales_channel ('web'), credits, price_usd_cents, variant_id (nullable), active | sticker floor `price × 10 ≥ credits × 43`; legacy net floor. Active: web-100, web-270, web-1200, web-3000 |
| `top_ups` *(0041 … 0108, 0167)* | id, user_id, pack_id, idempotency_key, credits, price_usd_cents, variant_id (null under Stripe, 0167), status (pending \| credited), consent_at/version, order_id, credited_at, grant_entry_id, refunded_cents, clawed_back_credits, return_* and backfill_* recovery columns, order_sweeps (LemonSqueezy-era history; sweep index dropped in 0180) | → users, credit_packs, ledger_entries (all RESTRICT); U (user_id, idempotency_key), U order_id, U grant_entry_id |
| `top_up_flagged_orders` *(0054, 0174)* | order_id, top_up_id, user_id, reason, paid_usd_cents, currency, variant_id | incident records; append-only |
| `top_up_order_collisions` *(0068, 0180)* | id, order_id (numeric-only CHECK), top_up_id, credited_top_up_id | append-only; no writer since 0180 dropped `backfill_credit_top_up` (LemonSqueezy) |
| `credit_subscription_plans` *(0186)* | id, billing_interval ('month'), price_usd_cents, credits, active | Starter 1900/270, Plus 5900/1200, Ultra 12900/3000; service-role definers only |
| `credit_subscriptions` *(0186, 0187, 0189)* | id, user_id, plan_id, idempotency_key, price_usd_cents, credits, consent_version/at, status (pending \| active \| past_due \| ended \| flagged), stripe_session_id / subscription_id (U) / customer_id, current_period_end, cancel_at_period_end, started_at, ended_at, end_reason | → users, plans (RESTRICT); **unreachable while `SUBSCRIPTIONS_ENABLED` is off**; activating one grants nothing — `grant_credit_subscription_invoice` does, per paid invoice |
| `credit_subscription_events` *(0186)* | id, subscription_id, stripe_event_id (U), type, status, detail, period_end, occurred_at | **append-only**; one row per Stripe event id, so an event id is never used for both a status update and a grant |
| `referral_codes` *(0217)* | user_id (PK), code (U, 10 chars from a 31-letter alphabet) | opaque, never derived from an id or email |
| `referrals` *(0217)* | referee_user_id (PK), referrer_user_id, code | set once, never changed; accepted only for an account ≤ 48 h old with no job or top-up |
| `referral_rewards` *(0218, 0219)* | referee_user_id (PK), referrer_user_id, top_up_id (U), credits, status (pending \| released \| cancelled), eligible_at, released_at, ledger_entry_id (U), cancel_reason (refunded \| disputed), clawback fields | → top_ups, ledger_entries (RESTRICT); written only by `referral_sweep()` (hourly) through `ledger_grant`; `reconcile_referrals()` must return zero rows |
| `account_actions` *(0059, 0062, 0146)* | id, user_id, action (freeze/unfreeze/dispute_resolved/warning/takedown), actor, reason, top_up_id, job_id, credits_taken, credits_shortfall | append-only; the only path to/from Frozen |

### 3.4 Rate limits and operations

Ten fixed-window tables, one row per user (`user_id` PK → users CASCADE,
`window_started_at`, `request_count`): `asset_link` (120/min),
`generation_attempt` (20), `job_read` (600), `upload_request` (60),
`account_read` (120), `top_up_checkout` (20), `top_up_read` (120),
`top_up_return` (30), `cinema_unlock` (20), `social_post_write` (20).
Plus `youtube_upload_daily_quota`.

Ops: `reconciliation_snapshot` (singleton; five counts), `worker_task_health`
(per cron task), `recovery_alert_reviews`, `recovery_health_snapshot`.

### 3.5 Tenants and projects *(0135–0141, 0163; staging only)*

| table | columns | keys and rules |
|---|---|---|
| `organisations` | id, owner_id, name, personal, deleted_at | U one personal org per owner |
| `organisation_members` | organisation_id, user_id, role (OWNER/ADMIN/CREATOR/EDITOR/REVIEWER/VIEWER/BILLING) | → auth.users (CASCADE) |
| `workspaces`, `workspace_members` | id, organisation_id, name, is_default, deleted_at; membership + role | U one default per org |
| `projects`, `project_members` | id, workspace_id, owner_id, name, version, deleted_at; membership + role | soft delete; audit trigger |
| `project_document_versions` | project_id, revision, document jsonb ≤ 32 KB, actor_id, restored_from, expected_revision, request_key | PK (project_id, revision); immutable |
| `project_assets` | id, project_id, r2_key, state (quarantined/inspected/rejected), declared/sniffed type and size, dimensions, reject_reason | quota + guard triggers; written only via definer RPCs (0173) |
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

### 3.7 Veyrnox Publish *(0154–0161, 0168–0169, 0181–0182, 0188–0192, 0223; dark in production)*

| table | columns | keys and rules |
|---|---|---|
| `social_brands` | id, owner_user_id, label, timezone | → users (RESTRICT); one default brand per user |
| `social_accounts` | id, brand_id, network, external_account_id, display_name, scopes_granted, access_token_enc / refresh_token_enc (AES-GCM bytea; cleared on disconnect, 0168), token_expires_at, status (active/expired/revoked/error) | → brands (CASCADE); U (brand, network, external id); a token is required unless revoked |
| `social_account_actions` | actor_id, brand_id, action, target_id, detail | append-only |
| `social_posts` | id, brand_id, created_by_user_id, status (draft \| scheduled \| published \| failed \| canceled; 0182), draft_batch_id, scheduled_at, global_text, idempotency_key | U (brand_id, idempotency_key); a draft needs a batch and is inert until `approve_social_post_batch` |
| `social_post_media` | post_id, position, media_type, source_job_id → jobs (nullable), source_upload_id → social_uploads | exactly one source (CHECK `social_media_one_source`, 0223): the caller's own generated asset or a device upload |
| `social_uploads` *(0223)* | id, user_id, r2_key (U), filename, mime_type (jpeg/png/webp/mp4), size_bytes ≤ 100 MB, status (pending \| ready \| deleting \| deleted), put_expires_at | immutable device uploads owned independently of jobs; `PUBLISH_UPLOADS_ENABLED` off in production |
| `social_post_targets` | post_id, account_id, network, text_override, publish_status (pending/publishing/submitted/delivered/published/failed), attempts, claimed_at, claim_key, next_attempt_at, last_error, platform_post_id/url, provider_state | U (post_id, account_id); claimed by the cron sweep; only the current `claim_key` may report (0168); `reschedule_social_post` (0192) moves the parent and its pending targets together or not at all |
| `social_analytics_snapshots`, `social_analytics_posts`, `social_analytics_sync` *(0188)* | per account: daily metrics jsonb, per-post metrics (permalink, caption ≤ 500), next/last sync and error | → social_accounts (CASCADE); written by the analytics sweep (`PUBLISH_ANALYTICS_ENABLED`) through definers |
| `social_best_time_cache` *(0191)* | account_id (PK), timezone, 84-day period, heatmap, frequency, recorded/measured post counts | descriptive posting patterns from stored counters; no raw tables exposed |

### 3.8 LLM Chat and Personas *(0193, 0203, 0210, 0216, 0226; live)*

All four tables are reachable only through definer functions keyed by
`p_auth_id` (RLS forced, no policies, no client or service-role grants); a
reply is a `jobs` row, so chat money follows the ledger rules above.

| table | columns | keys and rules |
|---|---|---|
| `chat_threads` | id, user_id, model_id, title ≤ 120, system_prompt ≤ 4,000, pinned, folder_id (0210), deleted_at, created_at, updated_at | → users (CASCADE); folder → chat_folders (SET NULL); deleting a chat deletes it (0203) |
| `chat_messages` | id, seq (identity), thread_id, role (user \| assistant), content ≤ 32,000, model_id, job_id → jobs (SET NULL), credits, status (complete \| canceled \| error) | → threads (CASCADE); written by `chat_complete_turn`; `chat_turn_context` builds the history within the 24,000-character budget and always includes the newest message (0226) |
| `chat_folders` | id, user_id, name ≤ 60 (unique ignoring case, ≤ 50 per user) | deleting a folder unfiles its chats |
| `chat_personas` | id, user_id, name ≤ 60, instructions ≤ 4,000, default_model_id → model_catalog (SET NULL), thinking, web | ≤ 20 per account, names unique ignoring case |

`list_user_jobs` excludes `inputs.kind = chat`, so replies never appear in the
Library. `popular_templates(p_days, p_min_accounts)` (0215) is the one
anon-callable read here: ranked template ids only.

## 4. Key RPCs

| area | functions |
|---|---|
| ledger | `ledger_debit` (lock, idempotency, freeze check, rate window, spend order Subscription → Free → Pack, creates DEBITED job), `ledger_refund` (one per job, back to source; zero branch for free-allowance jobs), `ledger_grant` (keyed), `signup_grant`, `provision_user`, `expire_free_credits`, `subscription_grant`, `expire_subscription_credits`, `reverse_subscription_grant`, `read_user_balance`, `read_user_credits`, `freeze_account`, `unfreeze_account` |
| free allowance | `free_allowance_left`, `free_allowance_take`, `free_allowance_return`, `submit_free_job`, `reconcile_free_allowance` |
| subscriptions | `list_credit_subscription_plans`, `start_credit_subscription`, `record_credit_subscription_session`, `apply_credit_subscription_event`, `grant_credit_subscription_invoice`, `reverse_credit_subscription_invoice`, `cancel_credit_subscription_cooling_off`, `mark_credit_subscription_cancelled`, `read_own_credit_subscription[_by_id]`, `read_credit_subscription_binding` |
| referrals | `referral_code_for`, `attach_referral`, `referral_summary`, `referral_sweep` (qualify, release, clawback), `reconcile_referrals` |
| chat | `chat_create_thread`, `chat_list_threads`, `chat_get_thread`, `chat_update_thread`, `chat_delete_thread`, `chat_turn_context`, `chat_complete_turn`, folder functions (`chat_create_folder` … `chat_move_thread`), `chat_save_persona`, `chat_list_personas`, `chat_delete_persona` |
| jobs | `job_submitted`, `job_succeeded`, `job_failed`, `job_stored`, `job_submit_rejected`, `get_user_job`, `list_user_jobs`, `get_user_asset`, `job_step_*`, `sweep_stuck_jobs`, `expire_assets` |
| top-ups | `create_pending_top_up`, `credit_top_up`, `read_top_up`, `apply_top_up_refund`, `apply_dispute_event`, `record_top_up_return_session`, `next_top_up_backfill_batch`, `close_top_up_return`, `operator_*` reads |
| reconciliation | `reconcile_balances`, `reconcile_free_credits`, `reconcile_top_ups`, `reconcile_failed_refunds`, `reconcile_subscription_credits`, `reconcile_free_allowance`, `reconcile_referrals`, `refresh_reconciliation_snapshot`, `reconcile_status` (five counts only), `refresh_recovery_health`, `recovery_status` |
| rate limits | `check_generation_rate_limit`, `consume_*_request` (×9), `consume_youtube_upload_quota`, `reserve_upload`, `release_upload` |
| admin | `ops_metrics_24h`, `admin_lookup_user`, `record_content_violation`, `list_content_violations` (all check `users.is_admin`) |
| Cinema | profile/creator/draft/upload/unlock/pass/publication/operator families (~45 functions) |
| Publish | `get_or_create_default_social_brand`, `list_social_accounts`, `record_social_account_connection`, `disconnect_social_account`, `create_social_post`, `list_social_posts`, `claim_due_social_post_targets`, `report_social_post_progress`, `complete_social_post_target`, `update_social_account_token`, `rotate_tiktok_account_tokens` (0190); drafts (`create_social_post_draft`, `list_social_post_drafts`, `approve_social_post_batch`, `discard_social_post_drafts`); calendar (`list_social_calendar`, `reschedule_social_post`); analytics (`claim_social_analytics_accounts`, `record_social_analytics[_failure]`, `get_social_analytics`, `refresh_social_posting_insights`, `get_social_posting_insights`); device uploads (`reserve_social_upload`, `complete_social_upload`, `read_social_upload`, `release_social_upload`, `remove_social_upload`, `claim_social_upload_cleanup`); internal `settle_social_post`, `social_fail_inactive_targets` (0168) |

Anon-callable by design (read-only status): `catalog_watch`,
`applied_migration_names`, `reconcile_status`, `recovery_status`,
`popular_templates`.

## 5. Scheduled work in Postgres (`pg_cron`)

| job | schedule | runs |
|---|---|---|
| `veyrnox-expire-assets` | every 15 min | `expire_assets(500)` |
| `veyrnox-sweep-stuck-jobs` | every 10 min | `sweep_stuck_jobs()` |
| `veyrnox-expire-free-credits` | hourly :41 | `expire_free_credits()` |
| `veyrnox-expire-subscription-credits` | hourly :07 | `expire_subscription_credits()` (0184) |
| `veyrnox-referral-sweep` | hourly :23 | `referral_sweep()` (0218) |
| `veyrnox-reconcile-balances` | daily 03:17 | raises on any row from seven reconcilers: balances, free credits, top-ups, failed refunds, Subscription Credits, free allowance, referrals (the last two are not in the hourly snapshot; ISSUES S20) |
| `veyrnox-reconciliation-snapshot` | every 15 min | `refresh_reconciliation_snapshot()` |
| `veyrnox-recovery-health` | every 15 min | `refresh_recovery_health()` |

Everything else (asset reap, upload sweep, top-up backfill, Cinema upload
checks, publish queue, project asset cleanup) runs from the Worker cron.

## 6. Migration conventions

- `packages/db/schema/supabase/NNNN_snake_case.sql`, idempotent, applied to
  production only by `apply-migrations.yml` after owner approval (ADR-0023).
- Next free number on `main`: **0228** — check open PRs first (#369, #364 and
  #361 are open). Take the number after the highest *open PR*, not just after
  `main`: 0195, 0204, 0209 and 0224 were each renumbered or replaced before merge (git history names them; no file was ever applied under them).
  Gaps: 0039, 0040, 0061, 0069, 0076, 0118, 0119, 0151, 0158, 0179, 0195, 0204,
  0209, 0224 (14; 0163/0164 carry their applied names 0151/0158). The README gap
  table lists only the first ten — ISSUES S18.
  `scripts/apply-migrations.mjs` stops the run when a pending file is numbered
  below an applied one ("out of order"); an unexplained gap is caught only by
  `check-migration-ledger.mjs`.
- Catalog UPDATEs from 0111 assert an exact positive `ROW_COUNT`
  (`scripts/check-catalog-update-guards.mjs`).
- Every new function names its full signature in `REVOKE ALL … FROM PUBLIC,
  anon, authenticated` and `GRANT EXECUTE … TO service_role`.
