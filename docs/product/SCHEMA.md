# Backend Schema — Veyrnox.ai

**Status:** Current · 2026-10-16 (re-audited against `main` at `3f46a609`; first
written 2026-10-08 at `42150476`) — reconstructed by replaying
`packages/db/schema/0001_initial.sql` and `supabase/0003…0326` in order
(163 tables: 158 in `public`, 5 in `private`; 85 at 0228, 78 added since).
The production migration ledger was last read on 2026-10-08 (every file
through 0227; 0228 applied afterwards): **which of 0229–0326 are applied to
production is not visible from the repo and was not re-read** (unverified;
the migration README says production had reached 0254 by 2026-10-10, and
S20 records 0264 applied).
Highest migration 0326, next free 0327 (no open PR adds a migration file).
**Authority:** the SQL. When this file and a migration disagree, the
migration wins and this file is wrong.
**Diagrams:** [diagrams/schema-map.html](diagrams/schema-map.html) (tables by
domain) · [diagrams/auth-flow.html](diagrams/auth-flow.html) (sign-up →
API call) · [diagrams/job-lifecycle.html](diagrams/job-lifecycle.html)
(`jobs.state`). Sources are the `.json` files beside them (Archify).
**Defects found:** [ISSUES.md](ISSUES.md) §Schema.

## 1. Rules every table follows

- **RLS enabled and forced on all 163 tables** (158 in `public`, 5 in
  `private`; the count is `CREATE TABLE` minus `DROP TABLE` across every
  migration — 68 at 0166, 85 at 0228). The Worker uses the service role (bypasses RLS);
  RLS is the second line. The newer feature tables (chat, referrals, free
  allowance, subscriptions, analytics, device uploads, fal dispatch, Publish
  inbox, teams, API keys and webhooks, content scans) have no client policies
  at all: they are reached only through definer functions.
- **Writes go through `SECURITY DEFINER` RPCs** with `SET search_path = ''`,
  `REVOKE ALL … FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE … TO
  service_role`. "Internal" functions revoke service_role too and are only
  called by other definers.
- **Append-only logs** carry a `BEFORE UPDATE OR DELETE` trigger:
  `ledger_entries`, `account_actions`, `top_up_order_collisions`, `top_up_flagged_orders` (0174),
  `audit_events`, `project_document_versions`, `cinema_creator_reviews`,
  `cinema_unlock_reversals`, `cinema_pass_events`, `cinema_pass_plays`,
  `cinema_free_plays` (0245),
  `cinema_submission_reviews`, `cinema_moderation_actions`,
  `cinema_operator_actions`, `cinema_operator_refund_receipts`,
  `social_account_actions`, `credit_subscription_events` (0186),
  `cinema_community_actions` (0266, 0268), `cinema_watch_sessions`,
  `cinema_watch_events`, `cinema_share_actions` (0281),
  `cinema_ranking_snapshots`, `cinema_ranking_decisions` (0282),
  `cinema_safety_check_events` (0294), `cinema_malware_scan_events` (0295),
  `cinema_upload_content_checks` (0297), `social_publish_subscription_events`
  (0293), `social_inbox_actions` (0299), `social_approval_events` (0304),
  `social_team_events` (0305) and `private.reconciliation_observations` (0290).
  Each also has a statement-level `BEFORE TRUNCATE` guard (0177, 0186;
  `scripts/test-append-only.mjs` fails on a table that lacks one).
- **Idempotency** lives in the schema: `jobs (user_id, idempotency_key)`,
  `top_ups (user_id, idempotency_key)`, `webhook_events (source,
  external_id)`, `credit_subscription_events (stripe_event_id)`,
  `model_free_allowance_claims (user_id, idempotency_key)`, `chat_closed_sends (user_id, idempotency_key)`,
  `account_actions (idempotency_key, 0253)`, `cinema_votes`, `social_publish_queue_assignments (brand_id, idempotency_key)`,
  `cinema_passes`, `cinema_submissions`, `social_posts` and
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
| `users` *(0001, 0032, 0059, 0146, 0178, 0272)* | id uuid, auth_id text, email, is_admin, frozen_at, hold_until (generation hold for a standing strike, 0272; `ledger_debit` and `submit_free_job` refuse with `ACCOUNT_ON_HOLD`, 0274), rights_attested_at, rights_attestation_version, created_at, updated_at (`plan` dropped, 0178) | PK id; U auth_id; owner can SELECT own row |
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
| `assets` *(0001, 0016, 0077, 0289, 0291)* | id, job_id, r2_key, mime_type, size_bytes, sha256, expires_at (90 days, trigger), held_at (content scan hold), output_label (vocals/drums/bass/other/guitar/piano; U (job_id, output_label)), created_at | → jobs (CASCADE); U r2_key |
| `job_steps` *(0091, 0092, 0225, 0227, 0237)* | id, job_id, step (script/voice/scene/stitch/trim/merge/audio/captions/montage/slow), ordinal, provider, provider_endpoint, provider_job_id, state, attempts 1–2, output_r2_key, output_text, error_code | → jobs (NO ACTION); U (job_id, step, ordinal); Auto Short, Clip Editor (captions last; `slow` runs once per slowed clip, ordinals 0–9, 0237) and video-agent (`montage`, provider `montage`) composites |
| `asset_reap_queue` *(0016)* | id, r2_key, queued_at, attempts, last_error | U r2_key |
| `webhook_events` *(0001)* | id, source, external_id, payload, processed_at, created_at | U (source, external_id) — the webhook dedupe |
| `upload_reservations` *(0129)* | r2_key, user_id, size_bytes ≤ 100 MB, created_at, put_expires_at | → users (CASCADE) |
| `model_free_allowance_claims` *(0205)* | user_id, idempotency_key, model_id → model_catalog, day (UTC), state (TAKEN \| RETURNED), created_at, returned_at | PK (user_id, idempotency_key); written by `free_allowance_take` / `free_allowance_return`; `submit_free_job` (0206) takes it and inserts the 0-credit job in one transaction |
| `fal_dispatch` *(0230, 0231)* | job_id (PK → jobs CASCADE), endpoint, payload jsonb ≤ 16 KB, state (READY \| STARTED \| ACCEPTED \| REJECTED \| UNKNOWN \| CLOSED), attempt_token, provider_job_id, created/started/resolved/projected/recovery_checked_at | ADR-0076 service-only outbox: `admit_fal_dispatch` debits and enqueues in one transaction; one irreversible fal submission attempt (`start_fal_dispatch`, `record_fal_dispatch`, `recover_fal_dispatch`, targeted `claim_fal_dispatch`); `FAL_DURABLE_DISPATCH_ENABLED` and `FAL_DISPATCH_QUEUE_ENABLED` off in production |
| `fal_capacity_policy`, `fal_capacity_reservations`, `fal_admission_control` *(0238–0240, 0243)* | policy singleton (enabled, provider_account, model_id → model_catalog, outstanding_limit 1–2, daily_limit ≤ 10, daily_budget_microusd ≤ 300,000); reservation per job (admission_day, cost_microusd, released_at, release_reason); pause singleton | ADR-0079, default deny; `admit_fal_dispatch` is reserved-only when the policy is enabled; `fal_admission_paused` stops new admissions; `release_fal_capacity` returns a slot |
| `film_library_masters` *(0279)* | id, user_id, source_job_id, source_sha256, label, r2_key (U), sha256, size_bytes ≤ 25 MiB, 1920×1080, seconds ≤ 60, 24 fps, created_at, expires_at | ADR-0085 verified Film Studio masters; U (user_id, source_job_id, sha256); expired by cron `veyrnox-expire-film-masters` (15 min); no ledger writes |
| `editor_library_renders` *(0285)* | id, owner_id → auth.users (SET NULL), label, r2_key (U, `editor-renders/…mp4`), sha256, size_bytes ≤ 25 MiB, request_key (U with owner), state (quarantined \| stored \| removed), width/height ≤ 4096, seconds ≤ 600, frame_rate, expires_at (24 h), inspected_at | ADR-0089 private inspected editor exports; expired by cron `veyrnox-expire-editor-renders` (15 min); no ledger writes |

`job_state`: `PRICED` (unused) · `DEBITED` → `SUBMITTED` → `SUCCEEDED` →
`STORED`; `FAILOVER` (bounded retry, back to SUBMITTED); `FAILED` →
`REFUNDED`. `ledger_refund` accepts DEBITED, SUBMITTED, FAILOVER or FAILED
and refuses SUCCEEDED/STORED. `sweep_stuck_jobs` refunds anything stuck. A zero-credit free-allowance job is
refunded by `ledger_refund`'s zero branch, which returns the allowance and
writes no ledger row; a chat reply ends `STORED` with no `assets` row
(`chat_complete_turn`, or `chat_settle_unsaved_turn` when the reply was
delivered but its messages could not be stored: still charged, 0233).

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
| `account_actions` *(0059, 0062, 0146, 0253, 0271, 0272, 0288)* | id, user_id, action (freeze/unfreeze/dispute_resolved/warning/takedown, plus `credit_grant` and the Pack clawback), actor, reason, top_up_id, job_id, credits_taken, credits_shortfall, idempotency_key (unique where set, 0253) | append-only; the only path to/from Frozen |
| `content_appeals` *(0272, 0273)* | id, user_id, action_id, statement, status, submitted_at, decided_at, decided_by, decision_reason, decision_action_id | one appeal per sanction, from the sanctioned account; decided once (trigger); an upheld appeal stops the strike counting, recomputes `hold_until` and lifts a `content:` Freeze through `unfreeze_account` when fewer than three strikes stand; either decision writes an `appeal_upheld` / `appeal_rejected` `account_actions` row |
| `content_reports` *(0275, 0289)* | id, reporter_id (null for the scanner), source (user \| scanner), subject_kind, subject_id, category, details, scores, status, created_at, resolved_at, resolved_by, resolution | a user's in-product report of an output or title, or a scanner hold; one open report per reporter and subject |
| `evidence_holds` *(0275)* | id, action_id, job_id, r2_key, mime_type, size_bytes, held_at, released_at, release_action_id | `record_csam_escalation` deletes the job's `assets` rows (files stop being served) but sends the R2 keys here instead of `asset_reap_queue`; `release_evidence_hold` (admin, with a reason) queues them for the reaper; released once |
| `content_scans`, `content_scan_monitor` *(0289)* | scan queue per generated asset (job_id, asset_id, r2_key, status queued \| scanning \| clean \| hold \| unavailable, attempts, lease, scores, model); monitor singleton (armed, armed_at, disarmed_at); `assets.held_at` | `CONTENT_SCAN_ENABLED` drains the queue from the cron; a held asset is not served until `release_content_hold`; `SOCIAL_HOLD_CHECKS_ENABLED` makes `authorize_social_target_dispatch` refuse a held asset |

### 3.4 Rate limits and operations

Ten fixed-window tables, one row per user (`user_id` PK → users CASCADE,
`window_started_at`, `request_count`): `asset_link` (120/min),
`generation_attempt` (20), `job_read` (600), `upload_request` (60),
`account_read` (120), `top_up_checkout` (20), `top_up_read` (120),
`top_up_return` (30), `cinema_unlock` (20), `social_post_write` (20).
Plus `youtube_upload_daily_quota`.

Ops: `reconciliation_snapshot` (singleton; seven counts), `worker_task_health`
(per cron task), `recovery_alert_reviews`, `recovery_health_snapshot`,
`webhook_deliveries` (0276; one row per inbound webhook outcome, `WEBHOOK_DELIVERY_LOG_ENABLED`),
`private.reconciliation_observations` (0290; append-only history of the seven
counts). `reconciliation_snapshot` carries seven counts since 0264
(`free_allowance_drift`, `referral_drift` added; ISSUES S20).

### 3.5 Tenants and projects *(0135–0141, 0163, 0254, 0255, 0269, 0280, 0286, 0296; `TENANT_PROJECTS_ENABLED` on in production and staging; project media uploads on in staging only)*

| table | columns | keys and rules |
|---|---|---|
| `organisations` | id, owner_id, name, personal, deleted_at | U one personal org per owner |
| `organisation_members` | organisation_id, user_id, role (OWNER/ADMIN/CREATOR/EDITOR/REVIEWER/VIEWER/BILLING) | → auth.users (CASCADE) |
| `workspaces`, `workspace_members` | id, organisation_id, name, is_default, deleted_at; membership + role | U one default per org |
| `projects`, `project_members` | id, workspace_id, owner_id, name, version, deleted_at; membership + role | soft delete; audit trigger |
| `project_document_versions` | project_id, revision, document jsonb ≤ 32 KB, actor_id, restored_from, expected_revision, request_key | PK (project_id, revision); immutable. Document v2 carries the browser editor's `timeline` (0255, ADR-0080); v3 adds independent tracks, images and timed parameters (0269), v3 folders and local font metadata (0286), timeline markers (0296); v1 and v2 documents still save. Caps (0254): 200 live projects per workspace, 1,000 revisions per project, 2,000 saves per actor per rolling day, each `LIMIT_REACHED` / PT429 |
| `workspace_editor_brand_kits`, `project_editor_comments`, `private.editor_requests` *(0280)* | brand kit jsonb ≤ 12 KB per workspace (versioned); frame comments pinned to a saved revision (frame ≤ 18,000, body ≤ 2,000, resolvable); idempotency rows (actor, operation, key) | ADR-0088 shared editor tools; `EDITOR_SHARED_TOOLS_ENABLED`; RLS forced, reached through definers |
| `project_assets` | id, project_id, r2_key, state (quarantined/inspected/rejected), declared/sniffed type and size, dimensions, reject_reason | quota + guard triggers; written only via definer RPCs (0173) |
| `audit_events` | id, request_id, actor_id, organisation_id, action, resource_id, result | append-only; OWNER/ADMIN read |
| `private.api_requests`, `private.project_asset_storage`, `private.project_asset_inspections`, `private.editor_requests` | idempotency, storage claims, inspection throttle, editor request replay | not exposed |

Role helpers `private.org_role / workspace_role / project_role` resolve
`auth.uid()` for RLS; `create_project`, `mutate_project`,
`save_project_document`, `reserve_project_asset` are invoker wrappers the
browser JWT may call.

### 3.6 Social Cinema *(0132–0150, 0163–0164, 0244–0245, 0248, 0266–0267, 0270, 0277, 0281–0284, 0292, 0294–0295, 0297; viewing, publishing and the free ceiling on in production; unlocks, passes, voting, comments, polls, rankings and the audience tables off)*

| table | purpose |
|---|---|
| `cinema_profiles`, `cinema_memberships` | username/display name; role (viewer/creator/moderator/administrator) and account status |
| `cinema_creator_applications`, `cinema_creator_reviews` | apply → review (append-only) |
| `cinema_content`, `cinema_content_mutations` | SERIES → SEASON → EPISODE tree (self-FK on (parent_id, creator_id)); lifecycle DRAFT/UNDER_REVIEW/PUBLISHED/SUSPENDED; categories ≤ 2 |
| `cinema_uploads` | Stream upload per content; states provisioning → uploading → processing → ready / error → deleting → deleted; recovery, removal and proxy-transfer claims |
| `cinema_prices` | episode_unlock 6, film_unlock 6, free_episodes 5, pass_ceiling_minutes 1,500 (0244), free_ceiling_minutes 300 (0245) |
| `cinema_uploads` (0248) | `source_job_id`: a Cinema video made from the creator's own finished Library job (`reserve_cinema_library_upload`, `attach_cinema_library_upload`); with 0295 the object waits in `cinema_malware_scans` before a Stream grant is attached |
| `cinema_unlocks`, `cinema_unlock_reversals` | credit unlock → ledger entry; one live unlock per (user, content) |
| `cinema_pass_plans`, `cinema_passes`, `cinema_pass_events`, `cinema_pass_plays` | Stripe subscription state; one active pass per user; play seconds toward the ceiling |
| `cinema_free_plays` | seconds of free titles watched per account (0245); counted toward the monthly free ceiling; append-only |
| `cinema_submissions`, `cinema_submission_reviews`, `cinema_moderation_actions`, `cinema_categories` | publication review and moderation |
| `cinema_operator_actions`, `cinema_operator_refund_receipts` | operator reversals and pass refunds |
| `cinema_competitions`, `cinema_votes`, `cinema_community_actions` *(0266, 0268)* | competition (name, starts/ends ≤ 31 days, target_types FILM/SHORT/TRAILER/SERIES/EPISODE, open/closed); vote (U voter, content, competition; idempotency key; status, risk_reason); append-only moderation audit | `VOTING_ENABLED`; `cast_cinema_vote`, `read_cinema_voting`; no money or Credits |
| `cinema_comments`, `cinema_comment_reports`, `cinema_comment_mutations` *(0267)* | comment (body ≤ 2,000; pending → approved \| rejected \| removed \| withdrawn); reports; idempotency | published only after administrator approval; `COMMENTS_ENABLED` |
| `cinema_story_polls`, `cinema_story_poll_options`, `cinema_story_poll_votes` *(0270)* | episode story choices (question ≤ 240, options, one vote per poll and voter) | `STORY_POLLS_ENABLED`; separate from competition scores and payments |
| `cinema_watch_sessions`, `cinema_audience_clock`, `cinema_watch_events`, `cinema_share_actions` *(0281)* | private first-party audience signals (15-minute watch sessions per Stream upload); no token, IP, device or financial data | append-only; `CINEMA_AUDIENCE_ENABLED` |
| `cinema_ranking_snapshots`, `cinema_ranking_decisions` *(0282)* | frozen `weighted-v1` weekly scores per competition; separate moderator decisions | append-only; `CINEMA_RANKINGS_ENABLED` |
| `cinema_saved_titles`, `cinema_creator_follows`, `cinema_series_follows`, `cinema_retention_requests` *(0283)* | private saves and follows; retention requests | projections recheck current publication; `CINEMA_RETENTION_ENABLED` |
| `cinema_safety_checks`, `cinema_safety_check_events` *(0294)* | per-submission content, child-safety and malware status; append-only verdict events | `submit_cinema_title_safe`, `review_cinema_submission_safe`; `cinema_content` also gains `audience_rating` and `content_warnings` |
| `cinema_malware_scans`, `cinema_malware_scan_events` *(0295)* | per-upload scan queue (queued \| scanning \| passed \| flagged \| unavailable, lease) and append-only verdicts | a Library video stays in private R2 until a scanner passes the exact bytes |
| `cinema_moderation_config`, `cinema_upload_content_checks`, `cinema_submission_moderation_jobs` *(0297)* | singleton `upload_content_required` (installed off); append-only per-upload content verdicts; per-submission moderation queue | `set_cinema_content_moderation_required` |

### 3.7 Veyrnox Publish *(0154–0161, 0168–0169, 0181–0182, 0188–0192, 0223, 0228, 0241, 0260, 0265, 0287, 0293, 0298–0326; `PUBLISH_ENABLED` on in production with four released networks)*

| table | columns | keys and rules |
|---|---|---|
| `social_brands` | id, owner_user_id, label, timezone | → users (RESTRICT); one default brand per user |
| `social_accounts` | id, brand_id, network (CHECK lists all eleven; adapters for all eleven since PR #637), external_account_id, display_name, scopes_granted, access_token_enc / refresh_token_enc (AES-GCM bytea; cleared on disconnect, 0168), token_expires_at, status (active/expired/revoked/error) | → brands (CASCADE); U (brand, network, external id); a token is required unless revoked |
| `social_account_actions` | actor_id, brand_id, action, target_id, detail | append-only |
| `social_posts` | id, brand_id, created_by_user_id, status (draft \| scheduled \| published \| failed \| canceled; 0182), draft_batch_id, scheduled_at, global_text, idempotency_key | U (brand_id, idempotency_key); a draft needs a batch and is inert until `approve_social_post_batch` |
| `social_post_media` | post_id, position, media_type, source_job_id → jobs (nullable), source_upload_id → social_uploads | exactly one source (CHECK `social_media_one_source`, 0223): the caller's own generated asset or a device upload |
| `social_uploads` *(0223)* | id, user_id, r2_key (U), filename, mime_type (jpeg/png/webp/mp4), size_bytes ≤ 100 MB, status (pending \| ready \| deleting \| deleted), put_expires_at | immutable device uploads owned independently of jobs; `PUBLISH_UPLOADS_ENABLED` off in production |
| `social_post_targets` | post_id, account_id, network, text_override, publish_status (pending/publishing/submitted/delivered/published/failed), attempts, claimed_at, claim_key, next_attempt_at, last_error, platform_post_id/url, provider_state | U (post_id, account_id); claimed by the cron sweep; only the current `claim_key` may report (0168); `reschedule_social_post` (0192) moves the parent and its pending targets together or not at all |
| `social_connection_selections` *(0228)* | id, auth_id → auth.users (CASCADE), network (facebook \| pinterest \| gmb), payload_enc (AES-GCM bytea, 1 B–1 MiB), expires_at (default +10 minutes) | U (auth_id, network); RLS forced, all roles revoked; holds candidate Pages, boards or locations with their tokens until the user picks one; consumed once through `consume_social_connection_selection`; never readable by the browser |
| `social_analytics_snapshots`, `social_analytics_posts`, `social_analytics_sync` *(0188)* | per account: daily metrics jsonb, per-post metrics (permalink, caption ≤ 500), next/last sync and error | → social_accounts (CASCADE); written by the analytics sweep (`PUBLISH_ANALYTICS_ENABLED`) through definers |
| `social_best_time_cache` *(0191)* | account_id (PK), timezone, 84-day period, heatmap, frequency, recorded/measured post counts | descriptive posting patterns from stored counters; no raw tables exposed |
| `social_publish_plans` *(0293, 0298)* | id, name, month interval, price_usd_cents, analytics_days, best_time_enabled, active | service-only catalogue; `publish` is $15/month, 366 days and best-time access. Connection limits: 0265 added a five-connection writer (`record_social_multi_account_connection`, no payment); 0298 then changed it to one connected account on the free tier (Post now) and five with a live plan (`lib/social/accountAllowance.js`: 1 and 5). ADR-0063's 13 October amendment still says five free; the code and 0298 are what run |
| `social_publish_subscriptions` *(0293)* | user_id, plan/idempotency/consent, captured price, status, Stripe session/subscription/customer ids, period/cancellation timestamps | one live paid entitlement per user; independent of the Credit ledger; Stripe ids never reach the browser |
| `social_publish_subscription_events` *(0293)* | subscription_id, Stripe event id, type/status/period/occurred_at | append-only Stripe lifecycle evidence; replay-safe and out-of-order guarded |
| `social_oauth_states` *(0326)* | state_hash, auth_id, network (the eleven), expires_at | single-use OAuth state: `prepare_social_oauth_state` stores a hash, `consume_social_oauth_state` deletes it on the callback |
| `social_inbox_threads`, `social_inbox_messages`, `social_inbox_actions`, `social_inbox_notes` *(0299, 0309)* | per-brand threads (account, provider_thread_id, participant, status, unread_count, can_reply), messages (direction, delivery_status, idempotency_key), action log, internal notes | `ingest_social_inbox_event`, `create_social_inbox_reply`; paid-plan gated (`social_inbox_paid_user`); actions append-only |
| `social_inbox_contact_profiles` *(0318, 0319)* | tags, subscription_status, notes per participant; contacts can be created or CSV-imported | `list_social_inbox_contacts`, `import_social_inbox_contacts` |
| `social_inbox_workflows`, `social_inbox_suggestions` *(0320)* | keyword rules (match_mode, reply_text, enabled) and the replies they suggest (status, decided_by) | `evaluate_social_inbox_workflows`, `decide_social_inbox_suggestion`; a suggestion is never sent without a decision |
| `social_smartlinks`, `social_smartlink_items`, `social_smartlink_daily_counts` *(0300, 0324)* | link-in-bio page (slug, theme, published), ordered items, daily view and click counts | `read_social_smartlink_public` is the public read; counts only, no visitor identity |
| `social_content_presets` *(0302)* | name, caption, account_ids per brand | `list/save/delete_social_content_preset` |
| `social_publish_queues`, `social_publish_queue_slots`, `social_publish_queue_assignments` *(0303)* | recurring weekday/minute slots per brand and timezone; slot reservations keyed by (brand, idempotency key) | `reserve_social_publish_queue_slot`, `confirm_social_publish_queue_slot` |
| `social_approval_requests`, `social_approval_reviewers`, `social_approval_events` *(0304, 0310)* | approval of a post or draft batch by emailed reviewers (token links on `/api/social/approvals/:token`) | events append-only; `decide_social_approval`; variants validated by `social_post_variants_valid` (0310) |
| `social_brand_members`, `social_brand_invitations`, `social_team_events` *(0305–0308)* | brand roles and email invitations (`/api/social/team/:token`); actor-aware writes record the teammate | delegated roles need the brand owner's live Publish Plan; events append-only |
| `social_report_templates` *(0312, 0317, 0323)* | saved analytics report (range, comparison, title, accent colour) with scheduled delivery and branded export | `save_social_report_template_v3`, `claim_social_report_deliveries`; `REPORT_EMAIL_FROM` |
| `social_api_keys`, `social_api_key_requests` *(0313, 0315)* | scoped customer API keys (SHA-256 hash only, prefix, scopes, expiry, last_used_at, revoked_at) and a per-minute request log | `/api/publish/v1/*`, 120 requests a minute per key; `authenticate_social_api_key` |
| `social_webhook_endpoints`, `social_webhook_outbox`, `social_webhook_deliveries` *(0314)* | customer webhook endpoints (secret AES-GCM encrypted), durable outbox (U (endpoint, target, event type)), per-attempt delivery log | `claim_social_webhook_deliveries`, `complete_social_webhook_delivery` |
| `social_ad_campaigns`, `social_commerce_products` *(0321)* | campaign drafts (objective, daily budget, audience, provider state) and synced product records | `PUBLISH_RUNTIME_FLAGS.ads` / `.commerce` |
| `social_publish_autolists`, `social_publish_autolist_items` *(0322, 0325)* | RSS autolists feeding a queue (feed_url, caption_template, refresh interval, etag) and their items (U (autolist, external_id)) | `claim_due_social_publish_autolists`, `schedule_social_publish_autolist_items`; `rssAutolists` |

### 3.8 LLM Chat and Personas *(0193, 0203, 0210, 0216, 0226, 0233, 0242, 0258; live)*

All five tables are reachable only through definer functions keyed by
`p_auth_id` (RLS forced, no policies, no client or service-role grants); a
reply is a `jobs` row, so chat money follows the ledger rules above.

| table | columns | keys and rules |
|---|---|---|
| `chat_threads` | id, user_id, model_id, title ≤ 120, system_prompt ≤ 4,000, pinned, folder_id (0210), deleted_at, created_at, updated_at | → users (CASCADE); folder → chat_folders (SET NULL); deleting a chat deletes it (0203) |
| `chat_messages` | id, seq (identity), thread_id, role (user \| assistant), content ≤ 32,000, model_id, job_id → jobs (SET NULL), credits, status (complete \| canceled \| error) | → threads (CASCADE); written by `chat_complete_turn`; `chat_turn_context` builds the history within the 24,000-character budget and always includes the newest message (0226) |
| `chat_folders` | id, user_id, name ≤ 60 (unique ignoring case, ≤ 50 per user) | deleting a folder unfiles its chats |
| `chat_personas` | id, user_id, name ≤ 60, instructions ≤ 4,000, default_model_id → model_catalog (SET NULL), thinking, web | ≤ 20 per account, names unique ignoring case |
| `chat_closed_sends` *(0242)* | user_id, idempotency_key, closed_at | PK (user_id, idempotency_key); `chat_close_send` closes a send that made no job, and the `jobs_refuse_closed_chat_send` BEFORE INSERT trigger then refuses to ever create a chat job for that key; gated by `CHAT_SEND_CLOSE_ENABLED` |

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
| chat | `chat_create_thread`, `chat_list_threads`, `chat_get_thread`, `chat_update_thread`, `chat_delete_thread`, `chat_turn_context`, `chat_complete_turn`, `chat_settle_unsaved_turn`, folder functions (`chat_create_folder` … `chat_move_thread`), `chat_save_persona`, `chat_list_personas`, `chat_delete_persona` |
| jobs | `job_submitted`, `job_succeeded`, `job_failed`, `job_stored`, `job_submit_rejected`, `get_user_job`, `list_user_jobs`, `get_user_asset`, `job_step_*`, `sweep_stuck_jobs`, `expire_assets` |
| top-ups | `create_pending_top_up`, `credit_top_up`, `read_top_up`, `apply_top_up_refund`, `apply_dispute_event`, `record_top_up_return_session`, `next_top_up_backfill_batch`, `close_top_up_return`, `operator_*` reads |
| reconciliation | `reconcile_balances`, `reconcile_free_credits`, `reconcile_top_ups`, `reconcile_failed_refunds`, `reconcile_subscription_credits`, `reconcile_free_allowance`, `reconcile_referrals`, `refresh_reconciliation_snapshot`, `reconcile_status` (five counts only), `refresh_recovery_health`, `recovery_status` |
| rate limits | `check_generation_rate_limit`, `consume_*_request` (×9), `consume_youtube_upload_quota`, `reserve_upload`, `release_upload` |
| admin | `ops_metrics_24h`, `admin_lookup_user`, `record_content_violation`, `list_content_violations` (all check `users.is_admin`); ADR-0083: `admin_user_ledger`, `admin_credit_grant_guarded` (reasoned Pack grant through `ledger_grant`, `ADMIN_CREDIT_GRANTS_ENABLED`, off), `admin_credit_clawback_guarded` (Pack-only), `list_content_appeals`, `decide_content_appeal`, `list_content_reports`, `resolve_content_report`, `record_csam_escalation`, `release_evidence_hold`, `admin_webhook_deliveries`, `admin_held_asset` |
| user safety | `list_my_sanctions`, `submit_content_appeal`, `submit_content_report`; `hold_for_strike` sets `users.hold_until` |
| fal dispatch | `admit_fal_dispatch`, `claim_fal_dispatch`, `start_fal_dispatch`, `record_fal_dispatch`, `recover_fal_dispatch`, `release_fal_capacity`, `fal_admission_paused`, `ledger_debit_for_admission`, `submit_free_job_for_admission` |
| guards | `refunded_jobs_recent` (0259, composite-job refund ceiling), `chat_stops_before_text` (0258), `chat_close_send` (0242), `job_stored_audio_stems` / `get_user_audio_stem` (0291), `enqueue_content_scan`, `claim_content_scans`, `record_content_scan`, `release_content_hold` (0289) |
| editor | `store_film_library_master`, `list_film_library_masters`, `get_film_library_master` (0279); `reserve_editor_library_render`, `read_editor_library_renders`, `remove_editor_library_render`, `record_editor_render_inspection` (0285); `read/save_editor_brand_kit`, `read_editor_review`, `add/resolve_editor_review_comment` (0280) |
| Cinema | profile/creator/draft/upload/unlock/pass/publication/operator families (~45 functions at 0228); since then: free-ceiling metering (`start_cinema_playback`, `record_cinema_play`, `cinema_past_free_ceiling`, 0245), Library uploads (0248), voting, comments and story polls (`cast_cinema_vote`, `mutate_cinema_comments`, `cast_cinema_story_choice` and their `read_/manage_/list_…_review` families, 0266–0270), discovery and winners (`list_cinema_discovery`, `list_cinema_winners`), watch sessions and rankings (`begin_cinema_watch_session`, `calculate_cinema_weekly_scores`), retention, creator analytics (`read_cinema_creator_analytics`, 0284), safety and malware gates (0294–0297) |
| Publish | account/connect/post/draft/calendar/analytics/upload functions above; plan functions (0293): `list_social_publish_plans`, `start_social_publish_subscription`, `record_social_publish_session`, `apply_social_publish_subscription_event`, `read_social_publish_entitlement`, `mark_social_publish_cancelled`, `end_social_publish_subscription`. Plan functions are service-only and do not write the Credit ledger |; since 0299 the Publish surface adds inbox (`ingest_social_inbox_event`, `list_social_inbox`, `create_social_inbox_reply`), SmartLinks, presets, queues, approvals, team roles and invitations, post variants (`create_social_post_with_options`), `cancel_social_post` / `restore_social_post` (0311), report templates and deliveries, customer API keys (`create_social_api_key`, `authenticate_social_api_key`), customer webhooks, inbox workflows and contacts, ads and commerce records, RSS autolists and single-use OAuth state (`prepare_/consume_social_oauth_state`). About 271 functions were created after 0228, nearly all service-role only; the public-readable ones are named in the anon-callable list below

Anon-callable by design (read-only status): `catalog_watch` (returns only active fal rows since 0256),
`applied_migration_names`, `reconcile_status`, `recovery_status`,
`popular_templates`. Browser-callable invokers: the tenant wrappers in §3.5 only.

## 5. Scheduled work in Postgres (`pg_cron`)

| job | schedule | runs |
|---|---|---|
| `veyrnox-expire-assets` | every 15 min | `expire_assets(500)` |
| `veyrnox-sweep-stuck-jobs` | every 10 min | `sweep_stuck_jobs()` |
| `veyrnox-expire-free-credits` | hourly :41 | `expire_free_credits()` |
| `veyrnox-expire-subscription-credits` | hourly :07 | `expire_subscription_credits()` (0184) |
| `veyrnox-referral-sweep` | hourly :23 | `referral_sweep()` (0218) |
| `veyrnox-reconcile-balances` | daily 03:17 | raises on any row from seven reconcilers: balances, free credits, top-ups, failed refunds, Subscription Credits, free allowance, referrals (the last two joined the snapshot in 0264; ISSUES S20) |
| `veyrnox-reconciliation-snapshot` | every 15 min | `refresh_reconciliation_snapshot()` (seven counts since 0264; each reading is also kept in `private.reconciliation_observations`, 0290) |
| `veyrnox-expire-film-masters` | every 15 min | `expire_film_library_masters(100)` (0279) |
| `veyrnox-expire-editor-renders` | every 15 min | `expire_editor_library_renders(100)` (0285) |
| `veyrnox-recovery-health` | every 15 min | `refresh_recovery_health()` |

Everything else (asset reap, upload sweep, top-up backfill, Cinema upload
checks, publish queue, project asset cleanup, content scans, fal dispatch,
RSS autolists, customer webhooks, scheduled reports) runs from the Worker cron.

## 6. Migration conventions

- `packages/db/schema/supabase/NNNN_snake_case.sql`, idempotent, applied to
  production only by `apply-migrations.yml` after owner approval (ADR-0023).
- Next free number on `main`: **0327** — check open PRs first (`gh pr list`;
  none of the open PRs on 2026-10-16 adds a migration). Take the number after the highest *open PR*, not just after
  `main`: 0195, 0204, 0209, 0224, 0246, 0247 and 0249–0252 were each renumbered or replaced before merge (git history names them; no file was ever applied under them; 0246 and 0247 are named in the CHANGELOG as renumbered).
  Gaps: 0039, 0040, 0061, 0069, 0076, 0118, 0119, 0151, 0158, 0179, 0195, 0204,
  0209, 0224, 0246, 0247, 0249, 0250, 0251, 0252 (20; 0163/0164 carry their applied names 0151/0158). The README gap
  table now lists all twenty with the reason for each (it listed ten when ISSUES S18 was written).
  `scripts/apply-migrations.mjs` stops the run when a pending file is numbered
  below an applied one ("out of order"); an unexplained gap is caught only by
  `check-migration-ledger.mjs`.
- Catalog UPDATEs from 0111 assert an exact positive `ROW_COUNT`
  (`scripts/check-catalog-update-guards.mjs`).
- Every new function names its full signature in `REVOKE ALL … FROM PUBLIC,
  anon, authenticated` and `GRANT EXECUTE … TO service_role`.
