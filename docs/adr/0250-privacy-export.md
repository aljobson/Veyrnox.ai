# ADR-0250: Privacy export from the phone

Status: Proposed; implemented behind an unset flag, pending independent review.

Account > Your data offers a JSON copy prepared in the phone's private cache. The Worker starts one logged request, then serves bounded pages through service-role-only RPCs. Neither the server nor object storage gets a second copy of the personal data. The person shares or saves the completed file through the operating system share sheet. Media stays downloadable from Library; additional access requests go to the existing privacy email address.

A single synchronous RPC or one document per section can exceed memory and response limits. An asynchronous R2 export adds a second at-rest copy, a builder, a scheduled reaper, and erasure integration. Paged reads avoid those changes. The phone holds one page at a time, appends to the file, and nests each thread's messages before writing the next thread. The request row holds only identifiers, a secret cursor salt, assurance level and times. It is append-only, has forced RLS, and is inaccessible even to service_role; only the definer functions reach it. Its reference to the user's tombstone is retained during erasure.

Starts serialize on the user's row. One request is permitted per 24 hours, with a 60-minute download window. Starting again inside that window returns the same export id. Every page checks ownership, erasure, expiry, restrictions and MFA again. Verified TOTP factors require aal2; the phone performs inline step-up using the existing account authentication calls. Frozen and evidence-held accounts are directed to email for manual handling: this defers the automated path, not the person's access right.

`as_of` bounds which records are listed, not their field values. Each page reflects current values, including status, refunds and disconnections. A record deleted before its page is read is absent. Soft-deleted jobs are excluded; chats are hard-deleted. Watch progress has no creation timestamp: it is ordered by its unique public content id without a cutoff. It can therefore include progress first recorded after `as_of`. This exception is explicit; this is not a transactionally consistent snapshot.

Timestamp sections use strict composite keysets. Their tie-break is the record's own UUID, or a public catalogue UUID for saved titles and series follows. Follows and blocks instead use SHA-256 of a per-request secret salt and the other user's id. The salt never leaves the revoked request table, and the response carries no other person's user or auth id. A deleted boundary row does not change the comparison. Watch progress uses its content id as both boundary fields; messages use a decimal bigint string with a null key. Messages are read per owned, live thread using `(thread_id, seq)` and a 50-row limit. Other lists have a 200-row limit. Jobs and ledger use their user/creation indexes; other sources use their user-leading FK indexes before sorting the person's rows.

The request header includes `format`, `version`, `as_of` and a `record_values` explanation. The top-level sections below are in fixed order. The SQL and tests enumerate every permitted field; no whole source record is serialized.

| Section | Included fields |
| --- | --- |
| profile | id, email, created_at, preferred_locale, rights_attested_at, rights_attestation_version, balance, free_balance, subscription_balance, subscription_expires_at; cinema_profile {username, display_name, bio, created_at}; cinema_membership {role, account_status}; referral_code {code, created_at}; referred_at, referrals_made; push_devices [{platform, notify_jobs, created_at, last_seen_at, disabled_at}]; sanctions_hold_until, frozen |
| credit_history | id, delta, free_delta, subscription_delta, job_id, created_at, kind; the Worker converts the internal reason with ledgerKind and removes reason |
| top_ups | id, pack_id, sales_channel, credits, price_usd_cents, status, consent_at, consent_version, created_at, credited_at, refunded_cents, clawed_back_credits, returned_at |
| credit_subscriptions | id, plan_id, status, price_usd_cents, consent_version, consent_at, started_at, current_period_end, cancel_at_period_end, ended_at, end_reason, created_at, credits |
| publish_subscriptions | same subscription fields, without credits |
| creations | id, model_id, credits, state, error_code, free_allowance, consent_attested_at, created_at, updated_at, kind, prompt, topic |
| chat_folders | id, name, created_at |
| chat_personas | id, name, instructions, default_model_id, thinking, web, created_at |
| chat_threads | id, folder_id, model_id, title, system_prompt, pinned, created_at, updated_at; messages [{id, thread_id, seq, role, content, model_id, credits, status, created_at}] |
| publish_brands | id, label, timezone, created_at, for owned brands |
| publish_connections | id, brand_id, network, display_name, status, scopes_granted, connected_at, disconnected_at, for owned brands |
| publish_posts | id, brand_id, status, scheduled_at, global_text, created_at, for posts authored by the person |
| saved_titles | content_id, created_at |
| series_follows | series_id, created_at |
| creator_follows | creator_username |
| watch_progress | content_id, position_seconds, duration_seconds, completed, updated_at |
| votes | content_id, competition_id, status, created_at |
| comments | id, content_id, body, status, created_at |
| blocks | blocked_username (nullable), created_at |
| sanctions | action_id, action, created_at, job_id, model_id, hold_until, appeal_status, appeal_submitted_at, appeal_decided_at; same action filter as list_my_sanctions |
| appeals | action_id, statement, status, submitted_at, decided_at |
| reports | category, subject_kind, details, status, created_at, resolved_at |

Excluded fields include payment processor identifiers, idempotency keys, provider identifiers, arbitrary job inputs, OAuth credentials, device identifiers, push tokens, moderation/operator notes, risk reasons and other people's private content. Public creator handles and catalogue ids are included where specified. The profile uses nested objects for the three sources with their own created_at fields. The profile's push_devices array is not paged, so it is capped at the 100 most recently seen devices (`ORDER BY last_seen_at DESC NULLS LAST, created_at DESC, id LIMIT 100`); older device rows are left out.

When the shared read limiter is enabled, a missing user returns export_not_found, a temporary throttle returns read_throttled with Retry-After, and limiter failure returns rate_limit_unavailable. The phone retains its current file/cursor during a throttle, waits at most 60 seconds, and retries while the window remains open. A daily rate_limited refusal is terminal. Cancellation, failure, screen unmount, account changes, sign-out and process launch remove export files. A 5,000-page guard per section (per thread for messages, keyed `chat_messages:<threadId>`) stops malformed or excessive streams. Risk: a very heavy chat user (many threads, long histories) may need more page reads than fit in the 60-minute window, especially under throttling; the export then expires and the person is pointed to the email route. There is no analytics or content logging.

Migration 0362 follows 0358 to 0361, which are all on main (store refund ordering, job cancel, Film Studio cloud saves, Oddlings in projects). Enablement belongs to the owner: review and merge through the normal workflow, and apply the migration through the approved migration workflow. Run the database replay, isolation, grants, append-only, FK, reconciliation and concurrency proofs in a disposable database. Enable `PRIVACY_EXPORT_ENABLED="true"` in staging and exercise the phone flow, then enable production only when a binding slot exists. The flag is deliberately absent from wrangler.jsonc; unset and any value other than the exact string `true` are off. No legal or web Account copy changes here; those remain email-based until the owner updates them. Turning the flag off immediately refuses both endpoints.

## Not exported

These user-linked tables are deliberately left out of the file (the drift guard in `scripts/test-privacy-export.mjs` lists every one). The ones that hold the person's own data, and so may be asked for by email, are: `cinema_passes` and `cinema_unlocks` (paid Cinema purchases), `cinema_creator_applications`, `cinema_submissions`, `social_uploads`, `social_brand_members`, `organisation_members`, `workspace_members`, `project_members`, `cinema_watch_sessions`, `cinema_free_plays`, `cinema_pass_plays`, `cinema_story_polls`, `cinema_share_actions`, `editor_requests`, `editor_library_renders`, `film_library_masters`, `referral_rewards`, `model_free_allowance_claims`, `store_customers` and the social inbox, approval, campaign and API-key tables. The rest are rate-limit counters, request logs, outboxes and internal bookkeeping.

## Owner decisions

1. The 24-hour limit of one export per account.
2. The 60-minute download window (and the heavy-chat risk above).
3. Soft-deleted jobs and deleted chats are excluded.
4. Frozen and evidence-held accounts are sent to the email route instead of the automated export.
5. Rollout of `PRIVACY_EXPORT_ENABLED` (staging first, then production) and the Worker binding slot it needs; the flag is absent from `wrangler.jsonc`.
6. Updates to the GDPR/privacy page and the web Account copy to describe the in-app export.
7. The not-exported table list above: which, if any, should be added to the file instead of the email route.
