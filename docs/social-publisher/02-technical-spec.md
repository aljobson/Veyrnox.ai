# 2. Technical Specification — Veyrnox Publish

> **As of 2026-10-08 (repo `main` at `bee1ea4f`, includes PR #637 and #638).** This spec began as a pre-implementation design. It
> now describes what is built, and keeps the original design only where it is still the plan, marked
> **Design only (not built)**. Each section was checked against migrations 0154 to 0228, the code
> under `app/api/v1/social/`, `lib/`, `packages/adapters/social/`, `worker.js`, `wrangler.jsonc` and
> ADR-0061 with its amendments (including the 2026-10-08 all-network amendment) and the [tester handover](INTEGRATIONS-TESTING-2026-10-08.md). Items that could not be confirmed are marked *unverified*.

This spec follows the constraints already in force for this repo (`CLAUDE.md`): Cloudflare Workers
Builds, Supabase Postgres with RLS, RPC-only money-adjacent writes, no `jose` / no
`@supabase/supabase-js` / no `tsx` on the SSR import graph, append-only audit logs, idempotency
keys on every state-changing call, and an ADR before any PR that adds new external OAuth
credentials or changes CSP. ADR-0061 is Accepted and covers the adapters, the schema and its
amendments; nothing here changes CSP.

## 2.1 Logical architecture

```text
                        ┌───────────────────────────────┐
                        │   Veyrnox.ai (Next.js / CFW)   │
                        │   app/veyrnox/app/publish/**   │
                        │   app/api/v1/social/** (API)   │
                        │   app/media/social/[token]     │
                        └───────────────┬─────────────────┘
                                        │ HTTPS / JWT (existing middleware.js;
                                        │ PUBLISH_ENABLED gates /api/v1/social/*)
                ┌───────────────────────┼───────────────────────┐
                │                       │                       │
┌───────────────▼───────────┐  ┌────────▼─────────┐   ┌─────────▼─────────┐
│ Supabase Postgres          │  │ Cloudflare R2     │   │ Cloudflare Cron    │
│ social_brands              │  │ generation assets │   │ Trigger */5 * * * *│
│ social_accounts            │  │ + social-uploads/ │   │ → worker.js:       │
│ social_posts / _targets    │  │ (device uploads)  │   │ publish sweep,     │
│ social_post_media          │  └────────────────────┘   │ analytics sweep,   │
│ social_uploads             │                           │ upload cleanup,    │
│ social_analytics_*         │                           │ weekly brand drafts│
│ social_best_time_cache     │                           └─────────┬──────────┘
│ social_account_actions     │◄───────append-only──── ┌────────────▼────────────┐
│ (audit log)                │                        │ packages/adapters/social/│
└─────────────────────────────┘                        │  instagram.js            │
                                                        │  twitter.js  (X)         │
                                                        │  tiktok.js               │
                                                        │  linkedin.js             │
                                                        │  youtube.js              │
                                                        │  facebook, threads,      │
                                                        │  pinterest, bluesky,     │
                                                        │  twitch, gmb (.js, 0228) │
                                                        └────────────┬──────────────┘
                                                                     │ HTTPS (fetch, no SDKs)
                                                        ┌────────────▼──────────────┐
                                                        │ Instagram Graph API /      │
                                                        │ TikTok Content Posting &   │
                                                        │ Display APIs / X API v2 /  │
                                                        │ LinkedIn REST /            │
                                                        │ YouTube Data API v3 /      │
                                                        │ Graph (Facebook, Threads) /│
                                                        │ Pinterest v5 / Bluesky     │
                                                        │ XRPC / Twitch Helix /      │
                                                        │ Business Profile APIs      │
                                                        └────────────────────────────┘
```

Principles, matching the existing codebase's own architecture decisions:

1. **Adapters, not SDKs.** Every platform integration lives in `packages/adapters/social/<network>.js`
   as a thin `fetch`-based client, mirroring the existing `packages/adapters/fal.js`, `stripe.js` and
   `r2.js` pattern. This avoids repeating the `@supabase/supabase-js` / `jose` bundler-trap history
   (`CLAUDE.md` §Bundler traps) with a vendor SDK nobody audited for the SSR import graph. Token
   encryption uses Web Crypto directly (`crypto.subtle`), never a JWT library.
2. **Service-role only for tokens.** OAuth access/refresh tokens are written and read only by
   server-side Worker code with the service-role key. The browser never sees a raw platform token.
3. **RLS + FORCE on every table, no browser grants.** Every Publish table has RLS enabled and forced
   and `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role`; all access is through
   `SECURITY DEFINER` RPCs (`SET search_path = ''`) granted to `service_role` only. This is stricter
   than the tenant-projects exception in `CLAUDE.md`: Publish has no browser-facing PostgREST surface.
4. **Idempotency.** `create_social_post` is idempotent on `(brand_id, idempotency_key)`; connecting
   the same external account re-activates the same row; a replayed reschedule to the same time is a
   no-op. Provider calls themselves are not idempotent (see §2.6, "Not covered").
5. **Append-only audit log.** `social_account_actions` records connect, reconnect, disconnect,
   draft approve/discard and `post_rescheduled` events. A trigger rejects UPDATE and DELETE, and a
   truncate guard was added by 0177.
6. **Cron-driven publish, not client-driven.** A post's scheduled time is honored by the Worker's
   five-minute cron, not by the browser staying open. There is one cron trigger (`*/5 * * * *`) for
   everything; there is no one-minute publish cron and no separate token-refresh cron (§2.6).

## 2.2 Data model

### As built

All tables `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` with no browser role grants; every
read and write goes through a service-role RPC that takes the caller's `p_auth_id` and re-checks
ownership (`social_brands.owner_user_id`). Migrations are in `packages/db/schema/supabase/`.

| Migration | What it adds |
|---|---|
| 0154 | `social_brands`, `social_accounts`, `social_account_actions` (append-only); `get_or_create_default_social_brand`, `list_social_accounts`, `record_social_account_connection`, `disconnect_social_account` |
| 0156 | `social_posts`, `social_post_media`, `social_post_targets`; `create_social_post`, `claim_due_social_post_targets`, `complete_social_post_target` |
| 0157 | Names `publish_sweep` to the Worker heartbeat (`worker_task_health`, `refresh_recovery_health`) |
| 0160 | Media by job (`source_job_id`) instead of a baked URL; `list_social_posts`; `social_post_write_rate_limits` and `consume_social_post_write_request` (20 writes per user per 60 s) |
| 0161 | Async engine: `provider_state`, statuses `submitted` and `delivered`; `report_social_post_progress`, `update_social_account_token`, `youtube_upload_daily_quota`, `consume_youtube_upload_quota` |
| 0168 | Disconnect fails open targets and clears both tokens; `claim_key` guard so a worker that lost its claim cannot overwrite a result (`CLAIM_LOST`); `settle_social_post` |
| 0169 | Free cap: a second active account is refused with `ACCOUNT_LIMIT` |
| 0175 | `social_account_actions.actor_id` is `ON DELETE RESTRICT` |
| 0181 | YouTube upload quota counted per Pacific date (YouTube's quota day), cap 80 |
| 0182 | `draft` status, `draft_batch_id`; `create_social_post_draft`, `approve_social_post_batch`, `discard_social_post_drafts`, `list_social_post_drafts`, `social_brand_owner` |
| 0188 | `social_analytics_sync`, `social_analytics_snapshots`, `social_analytics_posts`; `claim_social_analytics_accounts`, `record_social_analytics`, `record_social_analytics_failure`, `get_social_analytics` |
| 0190 | `rotate_tiktok_account_tokens` (atomic token-pair rotation) |
| 0191 | `social_best_time_cache`; `refresh_social_posting_insights`, `get_social_posting_insights` |
| 0192 | Calendar index `(brand_id, scheduled_at, id)`; `list_social_calendar`, `reschedule_social_post` |
| 0223 | `social_uploads`, `social_post_media.source_upload_id`; `reserve_social_upload`, `read_social_upload`, `complete_social_upload`, `remove_social_upload`, `claim_social_upload_cleanup`, `release_social_upload`; `create_social_post` and the claim extended to uploads |
| 0228 | `social_connection_selections` (the only table 0228 creates); `prepare_social_connection_selection`, `consume_social_connection_selection`, `rotate_extended_social_tokens`, `mark_social_provider_submission` (all `service_role` only). Table and function details below. |

(0176 added the missing foreign-key lookup indexes; 0177 added the append-only truncate guard.)

```sql
social_brands (
  id uuid pk, owner_user_id uuid not null references users(id) on delete restrict,
  label text not null,                    -- default 'My Brand'
  timezone text not null default 'UTC',   -- IANA name; used for posting-insights bucketing
  created_at timestamptz not null default now()
)
-- One brand per user in practice: get_or_create_default_social_brand creates it on first use.
-- There is no brand switcher and no collaborator model.

social_accounts (
  id uuid pk, brand_id uuid not null references social_brands(id) on delete cascade,
  network text not null check (network in ('instagram','facebook','twitter','linkedin','tiktok',
                                           'youtube','pinterest','threads','bluesky','twitch','gmb')),
  external_account_id text not null, display_name text, avatar_url text,
  scopes_granted text[] not null default '{}',   -- the grant the provider actually returned
  access_token_enc bytea,                        -- AES-GCM; NULL only when revoked (0168)
  refresh_token_enc bytea, token_expires_at timestamptz,
  status text not null default 'active' check (status in ('active','expired','revoked','error')),
  connected_at timestamptz not null default now(), disconnected_at timestamptz,
  unique (brand_id, network, external_account_id)
)
-- Only 'active' and 'revoked' are ever written. Nothing sets 'expired' or 'error' (see §2.6).
-- The CHECK lists all eleven networks and, since 0228 and PR #637, all eleven have adapters
-- (the six added in 0228 are tester-stage, behind PUBLISH_EXTENDED_NETWORKS_ENABLED).

social_posts (
  id uuid pk, brand_id uuid not null references social_brands(id) on delete cascade,
  created_by_user_id uuid not null references users(id) on delete restrict,
  status text not null default 'scheduled'
    check (status in ('draft','scheduled','published','failed','canceled')),
  scheduled_at timestamptz not null,
  global_text text check (char_length(global_text) <= 4000),
  idempotency_key text not null,                 -- ^[A-Za-z0-9_-]{8,128}$, unique per brand
  draft_batch_id uuid,                           -- required when status = 'draft' (0182)
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
)

social_post_media (
  id uuid pk, post_id uuid not null references social_posts(id) on delete cascade,
  position int not null, media_type text not null check (media_type in ('image','video')),
  source_job_id uuid,        -- a generation the caller owns; R2 object resolved at dispatch time
  source_upload_id uuid,     -- a verified device upload the caller owns (0223)
  -- exactly one of the two sources is set (social_media_one_source)
  unique (post_id, position)
)
-- The API accepts 1 to 10 media items, but the dispatcher sends only the first by position.

social_post_targets (
  id uuid pk, post_id uuid not null references social_posts(id) on delete cascade,
  account_id uuid not null references social_accounts(id) on delete restrict, network text not null,
  text_override text,        -- column exists; no API or UI sets it yet
  publish_status text not null default 'pending'
    check (publish_status in ('pending','publishing','submitted','delivered','published','failed')),
  attempts int not null default 0, claimed_at timestamptz, claim_key uuid,
  next_attempt_at timestamptz, provider_state jsonb not null default '{}',   -- 0228 adds {"submission_started": true}
  last_error text, platform_post_id text, platform_post_url text, published_at timestamptz,
  unique (post_id, account_id)
)

social_uploads (            -- 0223: the owner's reusable device-upload library
  id uuid pk, user_id uuid not null references users(id) on delete cascade,
  r2_key text not null unique, filename text, mime_type text, size_bytes bigint,
  status text not null default 'pending' check (status in ('pending','ready','deleting','deleted')),
  created_at timestamptz, put_expires_at timestamptz     -- signed PUT window, 16 minutes
)

social_connection_selections (   -- 0228: pending Page / board / location choice, never readable by the browser
  id uuid pk default gen_random_uuid(), auth_id uuid not null references auth.users(id) on delete cascade,
  network text not null check (network in ('facebook','pinterest','gmb')),
  payload_enc bytea not null check (octet_length between 1 and 1048576),   -- AES-GCM candidates + their tokens
  expires_at timestamptz not null default now() + interval '10 minutes',
  unique (auth_id, network))   -- a new attempt replaces the pending one (new id); consumed once
-- RLS enabled and forced; all roles revoked. prepare_ deletes expired rows and upserts; consume_ deletes
-- the row and returns the ciphertext only if id, user, network and expiry all match.

social_post_write_rate_limits (user_id pk, window_started_at, request_count)   -- 0160
youtube_upload_daily_quota (quota_date date pk, upload_count int)              -- 0161, keyed Pacific date (0181)

social_analytics_sync (     -- 0188: when each account is next due and how its last fetch went
  account_id pk, next_sync_at, last_ok_at, last_error (<= 200 chars), last_error_at)
social_analytics_snapshots (account_id, connector check ('evolution'), metric_date, metrics jsonb, fetched_at)
social_analytics_posts (    -- one row per post the network reports, Veyrnox-published or not
  account_id, platform_post_id, published_at, post_type, permalink, caption (<= 500), metrics jsonb, fetched_at)
social_best_time_cache (    -- 0191: one atomic aggregate per account
  account_id pk, timezone, period_start, period_end (exclusive; 84 days), heatmap jsonb (168 cells),
  frequency jsonb (12 weeks), recorded_posts, measured_posts, history_days, computed_at)

social_account_actions (
  id uuid pk, actor_id uuid references users(id) on delete restrict,   -- NULL for system events
  brand_id uuid not null references social_brands(id) on delete restrict,
  action text check (action ~ '^[a-z_]{1,32}$'), target_id uuid, detail jsonb, created_at timestamptz)
-- Append-only. Actions written today: connect, reconnect, disconnect, draft approve/discard,
-- post_rescheduled (and the fixture cleanup events recorded in the acceptance notes).
```

**0228 functions.** `rotate_extended_social_tokens` replaces the stored access and refresh ciphertext for
an active Pinterest, Threads, Bluesky, Twitch or Business Profile account only if both old ciphertexts
still match and the new expiry is in the future, so a disconnect, reconnect or competing rotation wins
over stale cron work (Threads has no refresh token; Facebook has no expiry and is never rotated).
`mark_social_provider_submission(target, claim_key, network)` sets `provider_state.submission_started`
on a `publishing` target of Facebook, Threads, Pinterest, Bluesky or Business Profile exactly once.
Counts: 0228 adds one table, so the schema is now 85 tables (82 in `public`); highest migration 0228,
next free 0229.

**Statuses.** Post: `draft` (inert until the owner approves its batch), `scheduled`, `published` (at
least one target succeeded), `failed` (none did), `canceled`. Target: `pending`, `publishing`
(claimed), `submitted` (accepted by TikTok or YouTube and being polled), `delivered` (TikTok draft in
the creator's inbox, not a public post), `published`, `failed`. There are no `pending_review`,
`rejected` or per-target `post_type` / `network_data` / `auto_publish` columns.

### Design only (not built)

The tables below were specified in the original design and have no migration. They are kept as the
plan for Phase 2 and 3.

```sql
-- Competitor benchmarking.
social_competitors (id, brand_id, network, handle, display_name, added_by, created_at)

-- Link-in-bio microsite.
smart_links (id, brand_id, slug unique, title, theme jsonb, created_at)
smart_link_blocks (id, smart_link_id, block_type check ('button','image'), position, label,
                   destination_url, style jsonb, unique (smart_link_id, position))
smart_link_clicks (id, block_id, clicked_at, referrer)   -- append-only; daily rollups for the dashboard

-- Multi-reviewer approval workflow.
social_approval_requests (id, post_id, requested_by, approval_system check ('any','all','optional'),
                          status check ('pending','approved','rejected'), created_at, resolved_at)
social_approval_reviewers (id, request_id, email, is_internal, decision, decided_at, comment,
                           unique (request_id, email))

-- Entitlement (ADR-0062/0063): social_publish_plans, social_publish_subscriptions. Not built.
```

## 2.3 API surface (`/api/v1/social/*`)

All routes go through the existing `middleware.js` JWT gate (ES256 + JWKS), which forwards
`x-veyrnox-auth-id`. While `PUBLISH_ENABLED` is not `"true"` the middleware refuses every
`/api/v1/social/*` path (`isPublishApiPath`). Handlers re-validate the auth id, validate every input
at the boundary, resolve the caller's default brand (`resolveBrand`) and call a service-role RPC with
`p_auth_id`. Errors are typed kebab or snake codes, never DB text. Read routes pass through
`accountReadLimit`; write routes also pass `socialPostWriteLimit` where noted.

| Method & path | Purpose |
|---|---|
| `GET /api/v1/social/accounts` | List the caller's connected accounts (never any token), plus `networks[]`: per network its capabilities and status `available`, `setup_required` (provider secrets missing) or `testing_disabled` (extended switch off). |
| `POST /api/v1/social/accounts/{instagram,twitter,linkedin,tiktok,youtube,facebook,threads,pinterest,twitch,gmb}/connect` | Body `{ codeChallenge }`. Returns `{ authorizeUrl }` with a signed `state`. The browser navigates there with a full-page redirect. The facebook, threads, pinterest, twitch and gmb routes (PR #637) answer 404 `network_unavailable` while `PUBLISH_EXTENDED_NETWORKS_ENABLED` is not `"true"` and 503 `{network}_not_configured` without the provider's secrets. |
| `POST /api/v1/social/accounts/bluesky/connect` | Body `{ identifier, appPassword }` (app password format `xxxx-xxxx-xxxx-xxxx`). Not OAuth: the Worker creates a session on `bsky.social`, accepts only Bluesky-hosted PDSs (`bsky.social` or `*.host.bsky.network`) and stores encrypted session tokens, never the password. Same extended switch. |
| `POST /api/v1/social/accounts/{network}/callback` | Body carries the provider's `code`, `state` and (X only) the PKCE verifier. Verifies state, exchanges the code, encrypts and stores tokens through `record_social_account_connection`. For Facebook, Pinterest and Business Profile it instead returns `{ ok: false, selectionId, choices[] }` (labels and ids only) after storing the encrypted candidates; the page then posts `{ selectionId, resourceId }` to the same route to consume the selection and record the chosen Page, board or location (409 `selection_expired` after ten minutes or on a second use; 409 `NO_ELIGIBLE_RESOURCE` when nothing qualifies; more than 200 candidates is refused). It is a POST made by the callback page at `/social/connect/callback/{network}`, not a provider-facing GET. |
| `DELETE /api/v1/social/accounts/:accountId` | Disconnect: marks the account revoked, clears both tokens, fails its open targets (0168). |
| `GET /api/v1/social/posts` | Cursor-paginated list of the caller's posts with per-target status (`before_created_at`, `before_id`). |
| `POST /api/v1/social/posts` | Create a scheduled post. Body `{ scheduledAt` **or** `publishNow: true, globalText, idempotencyKey, accountIds[1..20], media[1..10] }`. `publishNow` uses the server clock. Media items are `{ mediaType, jobId }` or `{ mediaType, uploadId }` (uploads only while `PUBLISH_UPLOADS_ENABLED`). Rate-limited. Returns `{ post_id, idempotent, target_count }`. Before creating, the route loads the caller's accounts and rejects `ACCOUNT_NOT_FOUND` (404), `network_unavailable`, `publishing_not_supported` (Twitch), `unsupported_media_type` (exactly one media item of a type the network accepts) and `caption_too_long` (400). |
| `PATCH /api/v1/social/posts/:id/schedule` | Reschedule an unstarted post with `{ expectedAt, scheduledAt }` (0192); `POST_BUSY` and `SCHEDULE_CHANGED` conflicts. Only when `PUBLISH_CALENDAR_ENABLED`. |
| `GET /api/v1/social/calendar?from=&to=&status=&network=&after_at=&after_id=` | Owner-only scheduled-date range, 100-post cursor pages, at most 43 days (0192). Only when `PUBLISH_CALENDAR_ENABLED`. |
| `GET /api/v1/social/drafts`, `POST /api/v1/social/drafts` | List open drafts; `{ action: 'approve', batchId }` or `{ action: 'discard', batchId, postId? }` (0182). |
| `GET/POST/DELETE /api/v1/social/uploads` | List uploads; `{ action: "reserve", rights_confirmed: true, ... }` returns a signed R2 PUT, `{ action: "complete", id }` verifies it; remove one (0223). Only when `PUBLISH_UPLOADS_ENABLED`. |
| `GET /api/v1/social/analytics?accountId=&from=&to=` | An account's stored evolution and per-post metrics for the dashboard (`from`/`to` are `YYYY-MM-DD`, at most 366 days). Owner only. |
| `GET /api/v1/social/best-time?accountId=` | The cached posting-insights aggregate (0191). Only when `PUBLISH_POSTING_INSIGHTS_ENABLED`; otherwise 503 `posting_insights_not_open`. |
| `GET /media/social/:token` | **Outside the gate, on purpose.** Public, short-lived HMAC token naming one R2 object. TikTok's `PULL_FROM_URL` fetch hits it; listed in `CLAUDE.md` and `tests/routesOutsideGate.test.mjs`. |

Not built from the original design: `PATCH /posts/:id` (edit), `DELETE /posts/:id` (cancel),
`POST /posts/:id/send-for-review`, `POST /approvals/:id/decide`, SmartLink CRUD and `GET /s/:slug`.
Posts are created complete; to change one the user reschedules it, and there is no user-facing cancel.

## 2.4 Per-network publishing rules

### Design reference (the Metricool contract)

The table below is the full per-network validation contract the original design adopted. It is **not
enforced by the composer today** (see "As built" after it); it remains the target for per-network
options.

These rules are **not inferred** — they are the exact validation contract exposed by Metricool's
own scheduling API (read live via the MCP connector's tool definitions), which in turn reflects
each platform's own publishing API constraints. Veyrnox's adapters must enforce the same rules
client-side (fast feedback in the composer) and server-side (defense in depth).

| Network | Post type | Media requirement | Required fields |
|---|---|---|---|
| Instagram | POST | ≥1 image, or carousel | `isAiGenerated` flag required by Instagram's own AI-content disclosure rule |
| Instagram | REEL / TRIAL_REEL | video required | `showReelOnFeed`, optional `audioConfiguration` (Business + FB Page linked only) |
| Instagram | STORY | image or video | caption optional; if Story is the *only* target, no caption is published anywhere |
| Facebook | POST | — | `title` only applies to video posts |
| Facebook | REEL | video required | — |
| Facebook | STORY | image or video | — |
| TikTok | video/photo post | ≥1 image or video | `privacyOption` (PUBLIC / MUTUAL_FOLLOW / FOLLOWER_OF_CREATOR / SELF_ONLY), `disableComment/Duet/Stitch`, `isAigc` (AI-content disclosure; video only, silently dropped for photo-only posts) |
| YouTube | video/short | video required | `title`, `privacy` (public/unlisted/private), `madeForKids` (required), `isAiGeneratedContent` disclosure |
| LinkedIn | post/poll | — | poll requires `question` + options + duration (1/3/7/14 days) |
| Pinterest | pin | image required | `boardId` (numeric board id; a human-readable board name is resolved automatically if unambiguous), `pinTitle`, `pinLink` |
| Bluesky | post | — | text capped at 300 characters — reject client-side before submit |
| Threads | post | — | `allowedCountryCodes` for geo-restriction |
| Google Business Profile | publication | — | text ≤1500 chars |
| Google Business Profile | photo | ≥1 image or video | no caption of its own; this is the *only* GMB post type that accepts video |

Common optional fields across networks, all confirmed live: `firstCommentText`, `mediaAltText`,
`videoThumbnailUrl` **or** `videoCoverMilliseconds` (mutually exclusive; applicable only to
Instagram Reel/Trial Reel, LinkedIn, YouTube, Facebook Post/Reel, and TikTok Business accounts —
requesting it outside those cases must be rejected client-side rather than sent speculatively),
`shortener` (auto-shorten links in the caption), thread/descendant posts (a first post plus a list
of follow-up posts for platforms that support threading).

**Design implication (not built):** the composer's "Schedule" button must run every target network's
validation before enabling, and per-network tabs should surface which required field is missing
(mirrors Metricool's own inline validation, described in the product spec).

**As built (all eleven networks).** The table above is the design contract and is *not* what the
composer enforces. The composer sends one caption and one media item to every selected account.
`create_social_post` checks ownership, active accounts, idempotency, schedule (no earlier than five
minutes ago, so "Post now" works) and that the media belongs to the caller with a matching MIME family.
Since PR #637 the route also runs `postCapabilityError` (`lib/social/postCapabilities.js`) against
`lib/social/networks.js`, and the composer repeats the check: the single media item must be a type the
network lists, a network with no media (Twitch) refuses publishing, and the caption must fit the
network's limit (Instagram 2,200; LinkedIn 3,000; X 280; TikTok 2,200; YouTube 4,000; Facebook 4,000;
Threads 500; Pinterest 800; Bluesky 300 graphemes; Business Profile 1,500). This replaces the earlier
behaviour where the dispatcher failed the target at publish time. The design-contract fields (post
types, first comment, alt text, privacy, board id as an option) are still not built.

| Network | What dispatch does | Scopes requested |
|---|---|---|
| Instagram | Image only: creates a media container then `media_publish` on `graph.instagram.com` (Instagram API with Instagram Login, API v25.0), then looks up the permalink. Caption passed as-is. | `instagram_business_basic`, `instagram_business_content_publish`; plus `instagram_business_manage_insights` only when `INSTAGRAM_INSIGHTS_SCOPE_ENABLED` |
| X | Image only: downloads the image from a presigned R2 URL (5 MB single-append limit), uploads through the v2 media endpoints, posts the tweet. | `tweet.read tweet.write users.read offline.access media.write` |
| LinkedIn | Image only: initializes an image upload, uploads, creates a post as `urn:li:person:<id>` (REST API version 202509). | `openid profile w_member_social` |
| TikTok | Photo only, `post_mode: MEDIA_UPLOAD`, `PULL_FROM_URL` from `/media/social/:token`, `is_aigc: true`. Polls the publish id every 30 s for up to 2 hours; `SEND_TO_USER_INBOX` or `PUBLISH_COMPLETE` marks the target `delivered`. No video path. | `user.info.basic`, `video.upload`; plus `user.info.stats`, `video.list` only when `TIKTOK_ANALYTICS_SCOPE_ENABLED` |
| YouTube | Video: opens a resumable session, sends one 8 MiB chunk per sweep tick, then polls processing every 60 s (24 h outer bound). Privacy is always `public`; the title and description are the caption. Spends one unit of the 80/day Pacific-date quota when a session opens; exhaustion defers to the next reset instead of failing. A dead session restarts up to twice. | `youtube.readonly`, `youtube.upload` |

**Tester-stage networks (PR #637, migration 0228; no real-account run, no provider app approval).**
Each is a plain `fetch` adapter in `packages/adapters/social/` sharing `common.js` (15 s timeout,
`redirect: 'error'`, errors carry only a status code, never provider payloads):

| Network | Connection and destination | What dispatch does | Scopes requested |
|---|---|---|---|
| Facebook | OAuth; long-lived user token exchanged, then the user's Pages with a CREATE_CONTENT or MANAGE task are offered (up to 1,000, ten pages of 100); the chosen Page's own token is stored (no expiry, no refresh) | One image to `/{page}/photos`, `published=true` | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` |
| Threads | OAuth; long-lived token; the profile is the account | Create IMAGE container, then poll every 30 s (2 h bound) until FINISHED, then `threads_publish`; the image is served from `/media/social/:token` (needs `PUBLIC_HOST` and `SOCIAL_MEDIA_PROXY_SECRET`) | `threads_basic`, `threads_content_publish` |
| Pinterest | OAuth with continuous refresh; only boards whose owner is the connecting user are offered | One image Pin (`media_source.image_url`); title is the first 100 characters of the caption | `user_accounts:read`, `boards:read`, `pins:read`, `pins:write` |
| Bluesky | Handle plus dedicated app password; Bluesky-hosted PDS only (any other host is refused) | Download the image (up to 1,000,000 bytes, JPEG/PNG/WebP), `uploadBlob`, then `putRecord` with a deterministic record key derived from the target id | `app-password` (recorded; not an OAuth scope) |
| Twitch | OAuth; token client id and user id are validated against the configured app | None: `publishing_not_supported`. Analytics only: `helix/videos?first=20`, per-video view counts, no channel totals | none |
| Google Business Profile | OAuth with PKCE, offline access; accounts then locations (up to 200) are offered | One image in a STANDARD local post; the target stays in progress, checked every 60 s for up to 2 h, until Google reports LIVE; REJECTED fails it (`google_post_rejected`) | `business.manage` |

**Duplicate-post guard.** These providers have no idempotency key we can reuse. For Facebook, Pinterest,
Bluesky and Business Profile the dispatcher first calls `mark_social_provider_submission` and only then
sends the request; for Threads the marker is written immediately before `threads_publish`, after the
container is FINISHED (container creation is safe to repeat only until then). The provider result is
checkpointed in `provider_state.result` and finished on a later tick (the second step is scheduled about
five seconds later, so in practice it runs on the next cron tick). A target
claimed again with `submission_started` set and no stored result fails with
`provider_result_unknown_reconcile_before_retry`, which stops a second public submission when a response
was lost or a worker died mid-request. Reconciliation is manual: look at the provider, then schedule
replacement content if needed. Bluesky's deterministic record key additionally makes a retried
`putRecord` overwrite rather than duplicate.

An unknown network, or a target with no media, fails immediately with `network_not_implemented` or
`missing_media`.

## 2.5 Analytics ingestion

Metricool's own metric taxonomy (confirmed live for Instagram alone: 190+ fields across 15
connectors) is the ceiling to design toward, not the v1 scope. What is built is small and honest
about what each network will give.

**Collector (`lib/socialAnalyticsSweep.js`, `PUBLISH_ANALYTICS_ENABLED`).** Runs inside the existing
five-minute cron. `claim_social_analytics_accounts` claims up to five due active accounts of the
networks that have a fetcher (Instagram, YouTube, TikTok, and Twitch when the extended switch is on and `TWITCH_CLIENT_ID/SECRET` are set) and moves each account's next turn six hours
on, so a tick that dies costs that account one round. Each fetch returns `{ metrics, posts }`;
`record_social_analytics` stores one evolution snapshot per account per UTC day and one row per post,
merging metrics key by key so a number a later fetch could not read is kept. A failed fetch is kept on
the account's `social_analytics_sync` row (not appended to `social_account_actions` as first proposed,
which would add a permanent audit row every few hours for a broken account). YouTube and TikTok tokens
are refreshed here when expired or expiring, encrypted and persisted before the fetch; a refused write
(disconnect during refresh, or a competing rotation) stops that account's fetch. The analytics sweep is
not wrapped in `observeRecovery` because `worker_task_health.task` has a CHECK list of names (0157);
wrapping it needs a migration that widens the list.

| Network | Account numbers | Per-post numbers | Needs |
|---|---|---|---|
| Instagram | followers, following, post count; with insights: reach and accounts engaged over the last 24 h | likes and comments for the latest 50 posts; with insights: reach, views, saves, shares for the ten newest | insights need `instagram_business_manage_insights` (Meta review) |
| YouTube | subscribers (rounded by YouTube), channel views, public video count | lifetime views, likes, comments for the latest 50 uploads | existing `youtube.readonly` grant; no YouTube Analytics API scope |
| TikTok | followers, following, total likes, public video count | lifetime views, likes, comments, shares for up to 50 recent public videos | `user.info.stats`, `video.list` (Display API review); migration 0190 |
| Twitch (tester-stage, 0228) | none (no follower or subscriber count is claimed) | views for the latest 20 videos (`helix/videos`), one `video` row each | extended switch and Twitch app credentials; no privileged scope. Shown on the dashboard as a Videos tile, a Views tile and a views-only video table (#642, merged 2026-10-08; not yet seen against a real Twitch account) |
| X, LinkedIn, Facebook, Threads, Pinterest, Bluesky, Business Profile | not built (X reads are billed by X; LinkedIn member statistics need a different API product) | | |

The dashboard (`/app/publish/analytics`) shows these for 7, 30 or 90 days. Date ranges select
publication dates; the counters are lifetime values, not views or interactions earned in the range.
`ANALYTICS_NETWORKS` in the page and `FETCHERS` in the sweep must be kept in step when adding a network. Extended-network tokens are renewed by the analytics sweep too (see the token refresh bullet in §2.6).

**Best time to post and frequency (`social_best_time_cache`, migration 0191)**: recomputed
at most weekly after successful ingestion, behind `PUBLISH_POSTING_INSIGHTS_ENABLED` (default
false). Use stored posts, because daily account snapshots do not contain publication hours.
Store one aggregate per account so empty histories, timing cells and frequency rows update
atomically. The brand timezone determines weekday/hour and twelve complete calendar weeks;
invalid timezones fall back to UTC. This window is independent of the dashboard date filter.

Scores average lifetime likes + comments + optional shares/saves. Require numeric likes AND
comments and posts at least 48 hours old. Unknown measurements stay null; frequency counts
all stored posts. Rank up to three positive-scoring slots only with at least ten measured
posts spanning fourteen days and three measured posts in each ranked slot. Sparse or zero
histories show an insufficient-evidence message; do not supply unsourced generic windows.
Frequency compares equal-volume weeks using post-weighted averages. These are descriptive
associations, not causal effects, audience-online estimates or predictions. Older posts have
had longer to earn interactions; collection can omit older, private or deleted posts.
Zero-post weeks mean no stored posts. Owner-only service RPCs expose aggregates, never tokens.
The result is shown on the analytics page; it is not wired into the composer's time picker.

## 2.6 Scheduling engine

As built (`lib/socialPublishSweep.js`; `worker.js`):

- **Trigger:** the Worker's single Cloudflare Cron Trigger, `*/5 * * * *`. Resolution is therefore
  about five minutes, and the UI says "Publishing can take a few minutes". The sweep is deliberately
  not gated by `PUBLISH_ENABLED`, so anything already queued finishes when Publish is closed. It
  reports through `observeRecovery('publish_sweep', ...)` (0157); the health snapshot expects a
  heartbeat only once a brand has a due-able post.
- **Claim:** `claim_due_social_post_targets(p_limit)` (batch of 25, capped at 50) selects targets whose
  post is `scheduled` and due and that are `pending` (and past `next_attempt_at`), `submitted` and
  past their poll time, or `publishing` with a claim older than 15 minutes, using
  `FOR UPDATE SKIP LOCKED`. It sets `publishing`, stamps `claimed_at`, increments `attempts` (not for a
  `submitted` continuation) and returns a fresh `claim_key`. Before claiming it fails the open
  targets of any non-active account (`social_fail_inactive_targets`, 0168), and it joins only active
  accounts.
- **Dispatch:** per target, decrypt the token, mint a fresh 15-minute presigned R2 GET URL (nothing is
  baked in at schedule time), and call the network dispatcher (§2.4). The networks that do not finish in one
  tick are TikTok (poll the publish id), YouTube (chunked upload, then processing), Threads (container
  processing) and Business Profile (until LIVE); Facebook, Pinterest and Bluesky submit once, checkpoint
  the result and complete on the next tick (§2.4). They return
  `inProgress` with `provider_state` and a next check time, reported by `report_social_post_progress`
  without spending the retry budget.
- **Report:** `complete_social_post_target` and `report_social_post_progress` apply only while the row
  is still `publishing` and, when a claim key is passed, only for that key; otherwise they return
  `CLAIM_LOST` and change nothing. After a terminal result `settle_social_post` marks the post
  `published` (at least one target succeeded) or `failed`.
- **Retry policy:** a failed attempt is retried after `5 × 2^(attempts-1)` minutes, capped at 60, and
  the target is `failed` once `attempts >= 3`. There is no classification of permanent versus
  transient errors: every error spends an attempt. YouTube quota exhaustion is the exception and is
  deferred to the next Pacific midnight.
- **Disconnect:** `disconnect_social_account` revokes the account, clears both tokens and fails its
  open targets at once (0168); a refreshed token is never written back onto a revoked account.
- **Token refresh:** there is no separate refresh cron. YouTube's access token is refreshed inside the
  publish dispatch when it is within ten minutes of expiry, and YouTube and TikTok tokens are refreshed
  by the analytics sweep. Since PR #637, Pinterest, Business Profile, Twitch and Bluesky (refresh token,
  ten-minute buffer; a Bluesky session is recorded as valid for 90 minutes) and Threads (the long-lived access token is
  renewed one day before expiry) are renewed by `renewExtendedToken` (`lib/social/extendedTokens.js`) in
  both the publish dispatch and the analytics sweep, written through `rotate_extended_social_tokens`.
  A lost rotation fails the target as `token_refresh_failed`; revoked grants need a reconnect.
  **Instagram, X and LinkedIn still have no refresh path in code**, and Facebook Page tokens carry no
  expiry and are not refreshed (a Page revoked or a lost posting task needs a reconnect). Nothing sets
  an account to `expired` or `error`; a dead token simply fails the target at publish time with the
  provider's error.
- **Not covered:** a post the platform already accepted from a worker whose claim was then lost is not
  un-posted. For the original five, platform calls are not idempotent and the claim key bounds the
  damage to one extra attempt. For Facebook, Threads, Pinterest, Bluesky and Business Profile the
  pre-submission marker (§2.4) stops a second submission and surfaces
  `provider_result_unknown_reconcile_before_retry`; automatic reconciliation is not built.
- **Not built:** failure notifications (the user sees `failed` and `last_error` in the post list and
  calendar), a per-target Retry control, and manual / mobile-push mode.

Two further jobs run on the same cron: the **upload cleanup** (`PUBLISH_UPLOADS_ENABLED`) claims
abandoned uploads older than 24 hours, or removed files after the signed PUT window, and releases the
database reservation only after R2 confirms deletion; and the **weekly brand drafts**
(`lib/social/brandDrafts.js`) turns the last seven days of the owner's generations into up to seven
draft posts on Mondays 06:00 UTC for the owner named by `BRAND_DRAFTS_AUTH_ID`. Drafts stay on the original five networks; the six new networks are reached through the manual composer only. Drafts are inert until
the owner approves the batch on `/app/publish`.

## 2.7 OAuth flow hardening

What the connect flow does today, and where it falls short of the original list:

- **PKCE (S256) where the provider supports it.** The browser generates a verifier, keeps it in
  `sessionStorage` per network, and sends only the S256 challenge. **X and Google Business Profile use
  it**: X requires PKCE and Business Profile forwards the challenge and verifier to Google; the verifier
  is posted back to the callback. The other extended OAuth routes (Facebook, Threads, Pinterest, Twitch)
  validate the verifier's shape but do not forward it. Instagram, LinkedIn, TikTok and YouTube have no
  PKCE forwarding in their adapters, so those routes validate the challenge for a uniform
  contract and never forward it. (The tester handover labels YouTube "OAuth with PKCE"; the adapter
  code on `main` does not forward a challenge, so that label is *unverified*.) The original "PKCE on
  every code exchange" is therefore not true.
- **Exact-match `redirect_uri`.** Built from `PUBLIC_HOST` (must be https) plus a per-network path,
  `/social/connect/callback/{network}`; never from request input. No query string, because several
  providers ignore it.
- **`state` is a stateless signed token, not a single-use value.** `lib/social/oauthState.js` signs
  `{ authId, network, expiry }` with HMAC-SHA256 under `SOCIAL_OAUTH_STATE_SECRET`, ten-minute expiry,
  constant-time compare. It binds the attempt to the signed-in user and network and cannot be forged,
  but the server stores nothing, so a state could in principle be replayed within its ten minutes. The
  provider's one-time authorization code is what actually stops reuse.
- **Refresh-token rotation, where the platform supports it.** TikTok rotation is implemented
  atomically (`rotate_tiktok_account_tokens`: both ciphertexts must still match and the account must be
  active, so a disconnect, reconnect or competing refresh wins). 0228 adds the same compare-both-old-
  ciphertexts rule for Pinterest, Threads, Bluesky, Twitch and Business Profile
  (`rotate_extended_social_tokens`). **Reuse detection and token-family
  revocation are not built.**
- **Tokens are never logged, never included in error responses, and never returned to the browser.**
  `list_social_accounts` returns ids, names and expiry only. Tokens are AES-GCM encrypted at rest with
  a random 12-byte IV (`lib/social/tokenCrypto.js`), key from `SOCIAL_TOKEN_ENCRYPTION_KEY` (base64 of
  exactly 32 bytes, a dedicated Worker secret). There is no key-rotation or re-encryption path; a key
  change would orphan stored tokens (users reconnect).
- **Destination selection is server-side.** For Facebook, Pinterest and Business Profile the candidate
  list, with each Page's own token, is encrypted into `social_connection_selections` and only labels and
  ids reach the browser; the selection is bound to user and network, expires in ten minutes, and is
  consumed once. A failed completion means starting the connection again.
- **Scope minimization.** The scopes in §2.4 are the minimum for what is built. Insights and TikTok
  analytics scopes are requested only behind their own switches, so the consent screen never asks for a
  permission the provider has not approved. The callback stores the grant the provider actually
  returned, never the requested list, so partial TikTok consent is honored.

## 2.8 Media ingestion boundary (SSRF avoidance by design)

Unlike Metricool's own API — whose `media` field accepts arbitrary public URLs (including
Google Drive/Dropbox links) that their server fetches on the caller's behalf — **Veyrnox Publish
does not accept externally-supplied media URLs at all.** The API accepts only `jobId` or `uploadId`.
Every attached asset is either:

1. A generation the caller owns (`source_job_id`), whose R2 object the server already controls, or
2. A device upload (`source_upload_id`, 0223): a browser-to-R2 PUT on a SigV4 URL signed for the
   exact Content-Length, Content-Type and `If-None-Match`, under `social-uploads/{auth_id}/{uuid}.{ext}`.
   On completion the Worker reads at most 16 bytes of the object, checks the total size from
   Content-Range and verifies the file signature (magic bytes, not the claimed header) before the row
   becomes `ready`. Limits: JPG/PNG/WebP 20 MiB, MP4 100 MiB, ten files and 200 MiB per account, with
   the user row lock serializing reservations. Reserving requires an explicit rights confirmation.

There is no code path where Veyrnox's backend makes an outbound request to a URL a user typed in. The
outbound media fetches that do exist target URLs the server minted: the X adapter downloads the image
from a presigned R2 URL (15 minutes) and the upload completion reads the object it just signed.
TikTok and Threads are the networks that fetch from us (the other networks receive a presigned R2 URL or the bytes): TikTok's `PULL_FROM_URL` needs a DNS-verified host that is
ours, so `GET /media/social/:token` streams one R2 object for the holder of a short-lived HMAC token
(`SOCIAL_MEDIA_PROXY_SECRET`, a dedicated secret; one-hour default lifetime; `no-store`). That route is
public by design and is the only unauthenticated Publish endpoint.

The product spec's Phase 3 "Integrations" row (importing media from Drive/Dropbox) reintroduces SSRF
risk and must not ship without a dedicated, allowlisted fetch service first: HTTPS-only, DNS resolution
re-validated against the actually-connected IP at fetch time (to defeat DNS rebinding),
private/loopback/link-local/multicast ranges blocked (including `169.254.169.254`), redirects either
disabled or re-validated at each hop, and hard caps on response size, content-type (verified by magic
bytes) and timeout.

## 2.9 Authorization: defense in depth beyond RLS

As built, RLS is a backstop and not the primary line: no browser role has any grant on a Publish table,
and every RPC re-derives ownership from `p_auth_id` before touching a row, exactly like the existing
`get_user_asset` RPC.

- **Object-level:** every id-scoped RPC joins to `social_brands.owner_user_id = <caller>` and returns
  `ACCOUNT_NOT_FOUND`, `POST_NOT_FOUND` or `BRAND_NOT_FOUND` for a mismatch, so a foreign id is
  indistinguishable from a missing one. The route layer maps these to 404.
- **Property-level:** the POST body is read key by key (`scheduledAt`/`publishNow`, `globalText`,
  `idempotencyKey`, `accountIds`, `media`); nothing is spread into an insert, so a body cannot set a
  status, a brand or a target field. The reschedule RPC takes only the two timestamps.
- **Function-level:** there are no roles. A brand has exactly one owner and every Publish action is
  owner-only. The collaborator, reviewer and multi-brand model in the original design is not built.
- **Audit:** state changes the user cares about (connect, reconnect, disconnect, draft approval and
  discard, reschedule) are appended to `social_account_actions`.

## 2.10 Security mapping to this repo's existing rules

| Rule (from `CLAUDE.md`) | How Publish complies |
|---|---|
| RLS on every user-facing table, FORCE it | All Publish tables (§2.2): enabled, forced, all roles revoked; RPC-only |
| No raw string interpolation into SQL | All access is parameterized RPC; no PostgREST filters |
| SECURITY DEFINER functions `SET search_path = ''` | Every Publish RPC |
| Every new function/table revokes explicitly | `REVOKE ALL ... FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE ... TO service_role` on every RPC, naming the full signature; tables revoke all roles |
| Idempotency keys on state-changing RPCs | `create_social_post` on `(brand_id, idempotency_key)`; connection upsert on `(brand_id, network, external_account_id)`; reschedule replay is a no-op. Provider calls are not idempotent (§2.6); for the five synchronous tester-stage providers a committed pre-submission marker stops a second public submission (§2.4). Selections are single-use by delete-on-consume |
| No `jose` / `@supabase/supabase-js` / `tsx` on SSR graph | Token encryption and OAuth state via `crypto.subtle`; adapters use raw `fetch`, no platform SDK |
| Secrets via `wrangler secret put` | `META_APP_ID/SECRET`, `X_CLIENT_ID/SECRET`, `LINKEDIN_CLIENT_ID/SECRET`, `TIKTOK_CLIENT_KEY/SECRET`, `YOUTUBE_CLIENT_ID/SECRET`, and since 0228 `FACEBOOK_CLIENT_ID/SECRET` (falls back to `META_APP_ID/SECRET`), `THREADS_CLIENT_ID/SECRET`, `PINTEREST_CLIENT_ID/SECRET`, `TWITCH_CLIENT_ID/SECRET`, `GMB_CLIENT_ID/SECRET` (Bluesky needs none), plus `SOCIAL_OAUTH_STATE_SECRET`, `SOCIAL_TOKEN_ENCRYPTION_KEY`, `SOCIAL_MEDIA_PROXY_SECRET` are Worker secrets, never in `wrangler.jsonc`. Which are provisioned per environment is *unverified* from the repo: `wrangler.jsonc` comments still say the provider ones are "not yet provisioned", while the acceptance records show a working YouTube client on staging; the tester handover records that staging has the shared secrets and YouTube credentials only, and the nine other OAuth apps await an administrator |
| CSP `connect-src` is locked to `'self'` + Supabase + R2 | Unchanged. Platform API calls are server-side. Device uploads PUT to the R2 S3 endpoint, which `connect-src` already allows (ADR-0028) |
| No CORS wildcards on `/api/v1/*` | Unchanged. The R2 bucket's own CORS must allow the exact origin for PUT, Content-Type and If-None-Match (checked on staging 2026-10-06) |
| Webhook signature verification | No platform webhook is registered. Platform state is polled (TikTok publish id, YouTube processing), never trusted from a callback |
| OAuth `redirect_to` built from `PUBLIC_HOST` only | Per-network callback path built from `PUBLIC_HOST`; see §2.7 |
| Append-only audit log | `social_account_actions` (trigger plus truncate guard). `smart_link_clicks` is not built |
| Rate limiting at the entry point | `consume_social_post_write_request`: 20 write requests per user per 60 s on posts, drafts and uploads; `accountReadLimit` on reads. The connect routes are not separately limited (*unverified*) |
| Routes outside `/api/v1` need an entry in `tests/routesOutsideGate.test.mjs` | `/media/social/:token` |

This table maps to this repo's own house rules. For the external standards mapping (OWASP Top 10,
OWASP API Security Top 10, NIST, ISO/IEC 27001, NCSC) see
[05-security-baseline.md](05-security-baseline.md), the audit-facing companion to this section.

## 2.11 Open engineering risks

1. **OAuth app review.** Meta, TikTok and YouTube require review before production posting scopes (and
   the new insights and TikTok analytics scopes) are granted. Per-network status is in
   [06-oauth-review-runbook.md §6.0](06-oauth-review-runbook.md#60-review-status-by-network-2026-10-08);
   no approval is recorded anywhere in the repo.
2. **Platform rate limits.** Meta Graph API, TikTok and YouTube impose daily and hourly quotas. The
   YouTube upload cap is enforced in-database (80 per Pacific day, under the documented ceiling). The
   analytics sweep records a failed fetch on the account's sync row and moves on, so one account's rate
   limit does not block another.
3. **TikTok audit mode.** The app is unaudited, so publishing uses MEDIA_UPLOAD and the product shows
   "delivered — finish in TikTok app". An unaudited DIRECT_POST would silently force posts private.
4. **Token storage blast radius.** A compromised `SOCIAL_TOKEN_ENCRYPTION_KEY` would expose every
   connected account's posting ability. It is a dedicated secret; there is no documented rotation
   runbook and no re-encryption path.
5. **Token lifetime gap.** Instagram, X and LinkedIn tokens are never refreshed, Facebook Page tokens
   have no stored expiry or refresh, and accounts never move to `expired` or `error`; the first sign of
   a dead token is a failed post. (Pinterest, Business Profile, Twitch, Bluesky and Threads now renew.)
6. **Third-party API response trust.** Captions, display names and analytics labels come from platform
   APIs and are attacker-influenceable. Stored fields are length- and type-checked in the database
   (`social_analytics_numbers`, CHECKs on caption, permalink and post type) and rendered by React; keep
   them escaped at every render site.
7. **Platform actions are not idempotent.** See §2.6 "Not covered". For the new synchronous providers an
   uncertain result is refused rather than retried, which trades possible duplicate posts for
   `provider_result_unknown_reconcile_before_retry` cases that need manual reconciliation.
8. **Security testing.** No penetration test or focused OAuth/media review has been run. Unit tests and
   database acceptance tests exist (1,626 unit tests passed on 2026-10-07 and 1,697 on 2026-10-08 per the tester handover, across the repo; Publish
   files are `tests/social*.test.mjs` and `packages/db/social-*.acceptance.test.ts`).
9. **The six new networks are unexercised against real accounts.** Automated contract tests (stubbed
   provider responses) and a local database acceptance suite exist; provider app approval, quotas and
   billing access (for example X reads, Business Profile API access) are separate and unconfirmed.


### Calendar implementation (0192)

`PUBLISH_CALENDAR_ENABLED` defaults to false until migration 0192 is applied. Calendar
month/week/list reads use the viewer's local timezone and an exclusive range end, capped
at 43 elapsed days to allow a 42-day grid across DST. Month/list include the six-week grid's
adjacent-month dates. The index `(brand_id, scheduled_at, id)` supports ordered pagination.
Filters execute before pagination; draft posts are omitted. All per-network statuses remain
visible, including TikTok delivery to inbox, which is not labelled as a live publication.

Rescheduling applies to all targets together only while none has started. A move requires
a timestamp precondition and a desired time more than one minute ahead. Lock targets and
then parent, without waiting, and move each target's `next_attempt_at` alongside the parent.
This retains the existing claim engine while protecting its due predicate against older
parent snapshots. Real changes append an audit event; exact replays do not. Native modal,
Reschedule button and confirmation provide a keyboard/touch alternative to desktop drag.

Live-verified on staging (acceptance 2026-10-04 and 2026-10-07, see `ACCEPTANCE-2026-10-07.md`): month,
week and list views; filters; a confirmed drag that changed nothing until confirmed and then moved both
parent and target to 12:00 UTC; rejection of a past time, a spring-forward gap and a stale or
failed-target save; the repeated autumn hour choosing the earlier occurrence; pagination across 102
rows after the `+00:00` cursor fix (the API now emits `Z`); and `POST_BUSY` under a held row lock.
Not verified: multi-network rescheduling through the browser, and a real provider dispatch race.
Production has `PUBLISH_CALENDAR_ENABLED` set but Publish itself closed.
