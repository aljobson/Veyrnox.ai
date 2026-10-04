# 2. Technical Specification — Veyrnox Publish

This spec follows the constraints already in force for this repo (`CLAUDE.md`): Cloudflare Workers
Builds, Supabase Postgres with RLS, RPC-only money-adjacent writes, no `jose` / no
`@supabase/supabase-js` / no `tsx` on the SSR import graph, append-only audit logs, idempotency
keys on every state-changing call, and an ADR before any PR that adds new external OAuth
credentials or changes CSP. Nothing here should be read as pre-approving those changes — it's the
design that an ADR would formalize.

## 2.1 Logical architecture

```text
                        ┌───────────────────────────────┐
                        │   Veyrnox.ai (Next.js / CFW)   │
                        │   app/publish/**  (UI)         │
                        │   app/api/v1/social/** (API)   │
                        └───────────────┬─────────────────┘
                                        │ HTTPS / JWT (existing middleware.js)
                                        │
                ┌───────────────────────┼───────────────────────┐
                │                       │                       │
┌───────────────▼───────────┐  ┌────────▼─────────┐   ┌─────────▼─────────┐
│ Supabase Postgres          │  │ Cloudflare R2     │   │ Cloudflare Cron    │
│ social_accounts (RLS)      │  │ (existing bucket, │   │ Trigger → Worker   │
│ social_posts / targets     │  │  reused for media)│   │ "publish-sweep"    │
│ social_post_media          │  └────────────────────┘   │ every 1 min        │
│ social_analytics_snapshots │                           └─────────┬──────────┘
│ social_best_time_cache     │                                     │
│ social_competitors         │                        ┌────────────▼────────────┐
│ smart_links / buttons      │                        │ packages/adapters/social/│
│ social_approval_requests   │                        │  instagram.js            │
│ social_account_actions     │◄───────append-only──── │  twitter.js               │
│ (audit log)                │                        │  tiktok.js                │
└─────────────────────────────┘                        │  linkedin.js              │
                                                        │  youtube.js               │
                                                        └────────────┬──────────────┘
                                                                     │ HTTPS (fetch, no SDKs)
                                                        ┌────────────▼──────────────┐
                                                        │ Meta Graph API / TikTok    │
                                                        │ Content Posting API /      │
                                                        │ X API v2 / LinkedIn API /  │
                                                        │ YouTube Data API v3        │
                                                        └────────────────────────────┘
```

Principles, matching the existing codebase's own architecture decisions:

1. **Adapters, not SDKs.** Every platform integration lives in `packages/adapters/social/<network>.js`
   as a thin `fetch`-based client, mirroring the existing `packages/adapters/fal.js`,
   `lemonsqueezy.js` and `r2.js` pattern. This avoids repeating the `@supabase/supabase-js` /
   `jose` bundler-trap history (`CLAUDE.md` §Bundler traps) with a new vendor SDK nobody audited
   for the SSR import graph. Any OAuth token encryption uses Web Crypto directly (`crypto.subtle`),
   never a JWT library.
2. **Service-role only for tokens.** OAuth access/refresh tokens are written and read only by
   server-side Worker code with the service-role key, identical to how `SUPABASE_SERVICE_ROLE_KEY`
   is scoped today. The browser never sees a raw platform token.
3. **RLS + FORCE on every new table**, service-role bypass only, exactly as `CLAUDE.md` mandates for
   all user-facing tables.
4. **Idempotency everywhere.** Every state-changing endpoint (`connect`, `schedule`, `update`,
   `approve`, `publish`) takes or generates an idempotency key, matching the existing
   `jobs.idempotency_key` / `webhook_events` pattern.
5. **Append-only audit log.** `social_account_actions` records connect/disconnect/schedule/edit/
   publish/delete/approve/reject events, mirroring `account_actions`. Never updated or deleted.
6. **Cron-driven publish, not client-driven.** A post's scheduled time is honored by a server-side
   sweep, not by the browser staying open — matching how `refresh_recovery_health` and other cron
   tasks in this repo already work (see the `worker_task_health` CHECK pattern noted in prior
   session learnings).

## 2.2 Data model

All tables `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`; policies scope every row to
`auth_id = auth.uid()` (via the existing `users`/`auth_id` shadow-row pattern) or brand membership
for multi-brand/team access. Migrations go in `packages/db/schema/supabase/` with the next free
`NNNN_<snake_case>` number — check open PRs first per `CLAUDE.md`.

```sql
-- A brand groups connected accounts (mirrors Metricool's "blog"), scoped to a Veyrnox user.
social_brands (
  id            uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references users(id),
  label         text not null,
  timezone      text not null default 'UTC',      -- IANA identifier, used for all scheduling math
  created_at    timestamptz not null default now()
)

-- One row per connected platform account under a brand.
social_accounts (
  id                uuid primary key default gen_random_uuid(),
  brand_id          uuid not null references social_brands(id) on delete cascade,
  network           text not null check (network in (
                      'instagram','facebook','twitter','linkedin','tiktok',
                      'youtube','pinterest','threads','bluesky','twitch','gmb')),
  external_account_id text not null,               -- platform's own account/page id
  display_name      text,
  avatar_url        text,
  scopes_granted    text[] not null default '{}',
  access_token_enc  bytea not null,                 -- AES-GCM via Web Crypto, key from Worker secret
  refresh_token_enc bytea,
  token_expires_at  timestamptz,
  status            text not null default 'active'  -- active | expired | revoked | error
                      check (status in ('active','expired','revoked','error')),
  connected_at      timestamptz not null default now(),
  disconnected_at   timestamptz,
  unique (brand_id, network, external_account_id)
)

-- One row per composer draft/scheduled item, independent of which networks it targets.
social_posts (
  id                uuid primary key default gen_random_uuid(),
  brand_id          uuid not null references social_brands(id) on delete cascade,
  created_by        uuid not null references users(id),
  status            text not null default 'draft'   -- draft | scheduled | pending_review |
                      check (status in (                -- rejected | publishing | published |
                        'draft','scheduled','pending_review','rejected',       -- failed
                        'publishing','published','failed')),
  scheduled_at      timestamptz,                     -- null while draft
  timezone          text not null,
  global_text       text,
  first_comment_text text,
  shortener         boolean not null default false,
  idempotency_key   uuid not null default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (idempotency_key)
)

-- Media attached to a post. Sourced from Veyrnox's own generation output (job_id) or a direct upload.
social_post_media (
  id             uuid primary key default gen_random_uuid(),
  post_id        uuid not null references social_posts(id) on delete cascade,
  position       int not null,
  r2_object_key  text not null,                      -- reuses existing R2 asset infrastructure
  source_job_id  uuid references jobs(id),            -- set when sourced from a Veyrnox generation
  media_type     text not null check (media_type in ('image','video')),
  alt_text       text,
  video_cover_ms int,                                 -- optional custom cover frame offset
  unique (post_id, position)
)

-- One row per (post, network) — this is where per-network overrides and publish status live.
social_post_targets (
  id                uuid primary key default gen_random_uuid(),
  post_id           uuid not null references social_posts(id) on delete cascade,
  account_id        uuid not null references social_accounts(id),
  network           text not null,
  post_type         text not null,                    -- POST | REEL | STORY | TRIAL_REEL | video |
                                                        -- short | pin | poll | publication | photo
  text_override     text,                              -- null = use social_posts.global_text
  network_data      jsonb not null default '{}',        -- validated per §2.4 before scheduling
  auto_publish      boolean not null default true,      -- false = push a mobile completion prompt
  publish_status    text not null default 'pending'
                      check (publish_status in ('pending','publishing','published','failed')),
  published_at      timestamptz,
  platform_post_id  text,                               -- returned id/url after successful publish
  platform_post_url text,
  last_error        text,
  attempt_count     int not null default 0,
  unique (post_id, account_id)
)

-- Nightly/hourly pulled analytics snapshots. Denormalized per the metric taxonomy in §2.5.
social_analytics_snapshots (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references social_accounts(id) on delete cascade,
  connector    text not null,      -- evolution | posts | reels | stories | account | demographic...
  metric_date  date not null,
  metrics      jsonb not null,     -- {"followers": 1234, "reach": 5678, ...}
  fetched_at   timestamptz not null default now(),
  unique (account_id, connector, metric_date)
)

-- Implemented in 0191: one atomic aggregate per account, computed from social_analytics_posts.
social_best_time_cache (
  account_id uuid primary key references social_accounts(id) on delete cascade,
  timezone text not null,
  period_start date not null,
  period_end date not null, -- exclusive; twelve complete local calendar weeks
  heatmap jsonb not null, -- 168 {day, hour, posts, score} cells; unknown score is null
  frequency jsonb not null, -- twelve {week, posts, measured_posts, avg_interactions} rows
  recorded_posts integer not null,
  measured_posts integer not null,
  history_days integer not null,
  computed_at timestamptz not null
)

-- Phase 2: competitor benchmarking.
social_competitors (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references social_brands(id) on delete cascade,
  network         text not null,
  handle          text not null,
  display_name    text,
  added_by        uuid not null references users(id),
  created_at      timestamptz not null default now()
)

-- Phase 2: link-in-bio microsite.
smart_links (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references social_brands(id) on delete cascade,
  slug        text not null unique,
  title       text,
  theme       jsonb not null default '{}',
  created_at  timestamptz not null default now()
)
smart_link_blocks (
  id             uuid primary key default gen_random_uuid(),
  smart_link_id  uuid not null references smart_links(id) on delete cascade,
  block_type     text not null check (block_type in ('button','image')),
  position       int not null,
  label          text,
  destination_url text not null,
  style          jsonb not null default '{}',
  unique (smart_link_id, position)
)
smart_link_clicks (           -- append-only; aggregated into daily rollups for the dashboard
  id             uuid primary key default gen_random_uuid(),
  block_id       uuid not null references smart_link_blocks(id) on delete cascade,
  clicked_at     timestamptz not null default now(),
  referrer       text
)

-- Phase 2: approval workflow.
social_approval_requests (
  id               uuid primary key default gen_random_uuid(),
  post_id          uuid not null references social_posts(id) on delete cascade,
  requested_by     uuid not null references users(id),
  approval_system  text not null check (approval_system in ('any','all','optional')),
  status           text not null default 'pending'
                     check (status in ('pending','approved','rejected')),
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz
)
social_approval_reviewers (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null references social_approval_requests(id) on delete cascade,
  email          text not null,
  is_internal    boolean not null,        -- true = matched an existing Veyrnox collaborator
  decision       text check (decision in ('approved','rejected')),
  decided_at     timestamptz,
  comment        text,
  unique (request_id, email)
)

-- Append-only audit trail, mirrors account_actions.
social_account_actions (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid,                        -- null for system-initiated (e.g. cron publish)
  brand_id    uuid not null references social_brands(id),
  action      text not null,               -- connect | disconnect | schedule | edit | publish |
                                            -- delete | approve | reject | token_refresh_failed
  target_id   uuid,                        -- post_id / account_id / smart_link_id as applicable
  detail      jsonb not null default '{}',
  created_at  timestamptz not null default now()
)
```

## 2.3 API surface (`/api/v1/social/*`)

All routes go through the existing `middleware.js` JWT gate (ES256 + JWKS), forward
`x-veyrnox-auth-id` etc. exactly as every other `/api/v1` route does, and validate every input
against a schema at the boundary.

| Method & path | Purpose |
|---|---|
| `GET /api/v1/social/accounts` | List connected accounts for the caller's brand(s). |
| `POST /api/v1/social/accounts/:network/connect` | Start OAuth: returns the provider's authorize URL with a signed `state` param. |
| `GET /api/v1/social/accounts/:network/callback` | OAuth callback: exchanges code for tokens, encrypts and stores them, redirects to `PUBLIC_HOST`-derived success page. |
| `DELETE /api/v1/social/accounts/:id` | Disconnect (revokes token where the platform supports it, soft-deletes the row, logs `disconnect`). |
| `GET /api/v1/social/calendar?from=&to=&status=&network=&after_at=&after_id=` | Owner-only scheduled-date range, 100-post cursor pages (0192). |
| `PATCH /api/v1/social/posts/:id/schedule` | Reschedule unstarted posts with `{ expectedAt, scheduledAt }` (0192). |
| `POST /api/v1/social/posts` | Create a draft or scheduled post. Requires idempotency key. Validates per-network payload per §2.4 before accepting a `scheduled` status. |
| `PATCH /api/v1/social/posts/:id` | Update a post. Rejects edits to a post already `publishing`/`published`. |
| `DELETE /api/v1/social/posts/:id` | Cancel a draft/scheduled post (not a published one). |
| `POST /api/v1/social/posts/:id/send-for-review` | Creates a `social_approval_requests` row, emails reviewers. |
| `POST /api/v1/social/approvals/:id/decide` | Reviewer decision endpoint; external reviewers authenticate via a single-use signed link, not a full login. |
| `GET /api/v1/social/best-time?accountId=` | Returns the cached heatmap from `social_best_time_cache`. |
| `GET /api/v1/social/analytics?accountId=&connector=&from=&to=` | Reads `social_analytics_snapshots`. |
| `POST /api/v1/social/smart-links` / `PATCH .../:id` | SmartLink CRUD (Phase 2). |
| `GET /s/:slug` | Public SmartLink landing page (no auth) — logs a row to `smart_link_clicks` on each block click via a redirect endpoint, never client-side only, so ad blockers can't erase the record. |

## 2.4 Per-network publishing rules

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

**Design implication:** the composer's "Schedule" button must run every target network's
validation before enabling, and per-network tabs should surface which required field is missing
(mirrors Metricool's own inline validation, described in the product spec).

## 2.5 Analytics ingestion

Metricool's own metric taxonomy (confirmed live for Instagram alone: 190+ fields across 15
connectors — evolution, posts, reels, stories, competitors, demographics by country/city/age/
gender, promoted posts/reels, hashtags, collabs, account-level breakdowns by media type/follower
type/contact button) is the ceiling to design toward, not the v1 scope. Recommended v1 subset per
network, one row per `(account_id, connector, metric_date)` in `social_analytics_snapshots`:

- **`evolution`** — daily: followers, follows/unfollows delta, posts count, reach, views,
  interactions, avg engagement.
- **`posts`** — per published post: reach, impressions, likes, comments, shares, saves, engagement
  rate (interactions per 1000 reached — this is exactly Metricool's own engagement formula and is
  worth matching so creators' numbers feel familiar if they've used Metricool before).
- **`account`** (Instagram-specific breakdown dimension) — views/reach segmented by content type
  (post/reel/story) and by follower vs. non-follower reach, which is the single most requested
  "is my content reaching new people" question.

A Cloudflare Cron Worker (`social-analytics-sweep`) runs hourly, iterates `social_accounts` with
`status = 'active'`, calls each adapter's `fetchAnalytics()`, and upserts snapshots. Failures write
to `social_account_actions` (`action = 'analytics_fetch_failed'`) rather than throwing — one
platform's rate limit must never block another account's ingestion (never let one adapter failure
cascade, matching the "provider callbacks are hints only" principle already used elsewhere in this
codebase).

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

## 2.6 Scheduling engine

- **Trigger:** Cloudflare Cron Trigger, once per minute, invoking a `publish-sweep` Worker handler.
- **Claim pattern:** `UPDATE social_post_targets SET publish_status = 'publishing' WHERE
  publish_status = 'pending' AND post_id IN (SELECT id FROM social_posts WHERE status = 'scheduled'
  AND scheduled_at <= now()) RETURNING *` inside a single transaction — this is the Postgres
  equivalent of "claim it once," preventing double-publish if a sweep overlaps a slow previous run.
- **Per-target dispatch:** each claimed target is dispatched to its network's adapter
  (`packages/adapters/social/<network>.js`), which builds the platform-specific request, calls the
  platform API over `fetch`, and returns a normalized `{ok, platformPostId, platformPostUrl, error}`.
- **Retry policy:** transient errors (5xx, rate limit) retry with exponential backoff up to 3
  attempts, tracked via `attempt_count`; permanent errors (expired token, policy rejection) mark
  `failed` immediately and notify the creator — matching "every debit path has a matching refund
  path" in spirit: every schedule has a matching failure-notification path.
- **Token refresh:** a separate `social-token-refresh` cron runs before the publish sweep each hour,
  refreshing any token expiring within the next 2 hours; a token that fails to refresh flips the
  account to `status = 'error'` and blocks new scheduling for that account until reconnected (never
  silently drops a scheduled post without telling the user).

## 2.7 OAuth flow hardening

Beyond the basic "state param + PUBLIC_HOST-derived redirect" already implied by §2.3, the connect
flow follows current OAuth 2.0 security best-current-practice guidance (the class of recommendation
in IETF RFC 9700 and NCSC's OAuth guidance — see [05-security-baseline.md](05-security-baseline.md)
for the full framework mapping):

- **PKCE (S256) on every authorization code exchange**, even though Veyrnox's OAuth clients are
  confidential (server-side) — defense in depth against authorization-code interception, at
  negligible cost.
- **Exact-match `redirect_uri`.** Each platform app is registered with one literal callback URL per
  environment (prod/staging); no wildcard subdomains, no path-prefix matching.
- **`state` is a single-use, server-generated random value bound to the initiating session**,
  checked byte-for-byte on callback and invalidated immediately after use (whether the callback
  succeeds or fails) — this is the CSRF defense for the connect flow, not just a nonce for show.
- **Refresh-token rotation, where the platform supports it**, with reuse detection: if an already-
  rotated refresh token is presented again, treat it as a compromise signal — revoke the whole
  token family for that `social_accounts` row and flip `status = 'error'`, forcing reconnect, rather
  than silently accepting it.
- **Tokens are never logged, never included in error responses, and never returned to the browser**
  in any API response — only opaque `social_accounts.id` values cross the client boundary.
- **Scope minimization.** Each platform's OAuth request asks for the narrowest scope set that
  covers the features actually shipped in that phase (e.g. v1 does not request Meta's Ads scopes,
  since the Ads dashboard is Phase 3) — a broader-than-needed grant is itself a standing risk, and
  scopes are easy to add later but hard to explain away in an app-review submission.

## 2.8 Media ingestion boundary (SSRF avoidance by design)

Unlike Metricool's own API — whose `media` field accepts arbitrary public URLs (including
Google Drive/Dropbox links) that their server fetches on the caller's behalf — **Veyrnox Publish
v1 does not accept externally-supplied media URLs at all.** Every attached asset is either:

1. Sourced from Veyrnox's own R2 asset library (`source_job_id` set, §2.2), which the server
   already controls and already trusts, or
2. A direct browser-to-R2 upload through the existing signed-URL flow (ADR-0028's pattern) —
   the media bytes never transit application server code, and there is no server-side fetch of a
   caller-supplied URL anywhere in the v1 flow.

This closes off an entire class of server-side request forgery (SSRF) risk by construction rather
than by filtering: there is no code path where Veyrnox's backend makes an outbound request to a
URL a user typed in. **This is a deliberate scope decision, not an oversight** — the product spec's
Phase 3 "Integrations" row (importing media from Drive/Dropbox, matching Metricool's own feature)
reintroduces exactly this class of risk, and must not ship without a dedicated, allowlisted fetch
service first: HTTPS-only, DNS resolution re-validated against the actually-connected IP at fetch
time (not just at lookup time, to defeat DNS rebinding), private/loopback/link-local/multicast
ranges blocked (including the cloud metadata address `169.254.169.254`), redirects either disabled
or re-validated at each hop, and hard caps on response size, content-type (verified by magic bytes,
not the claimed header) and timeout. Flagging this now so it's designed in before Phase 3, not
patched on after an incident.

## 2.9 Authorization: defense in depth beyond RLS

RLS (§2.2/§2.7 below) is the last line of defense, not the only one — every API handler
independently re-derives the caller's `brand_id` from their own membership rows before touching any
`social_*` table, exactly like the existing `get_user_asset` RPC's inline ownership check
(three-way join verification, `NOT_FOUND` on mismatch) rather than trusting a client-supplied
`brandId`/`accountId` and relying on the database to silently return zero rows:

- **Object-level:** every `:id`-scoped route (`GET/PATCH/DELETE /api/v1/social/posts/:id`, etc.)
  checks brand membership server-side before querying, so a mismatched id returns the same
  `not_found` a truly nonexistent id would — never a `forbidden` that confirms the id exists on
  someone else's brand.
- **Property-level:** `PATCH /api/v1/social/posts/:id` uses an explicit allow-list of client-
  updatable fields (caption, media, schedule time, per-network overrides). A request body can never
  smuggle `publish_status: 'published'`, a different `account_id`, or another brand's data into an
  update — the handler reads only the allow-listed keys and ignores everything else in the body,
  rather than spreading the whole payload into the update.
- **Function-level:** actions that aren't simple CRUD (disconnect an account, decide an approval,
  cancel a scheduled post) check the caller's role within the brand (owner / collaborator /
  reviewer) before executing, not just that they hold a valid JWT for *some* brand.

## 2.10 Security mapping to this repo's existing rules

| Rule (from `CLAUDE.md`) | How Publish complies |
|---|---|
| RLS on every user-facing table, FORCE it | All ten new tables (§2.2) |
| No raw string interpolation into SQL | All queries parameterized; PostgREST filters `encodeURIComponent`-ed |
| SECURITY DEFINER functions `SET search_path = ''` | Any RPC wrapping cross-table writes (e.g. `schedule_post`) follows this |
| Every new function/table revokes explicitly | `REVOKE ALL ... FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE ... TO service_role` on every RPC |
| Idempotency keys on state-changing RPCs | `social_posts.idempotency_key` unique; OAuth callback dedupes by `(network, external_account_id)` |
| No `jose` / `@supabase/supabase-js` / `tsx` on SSR graph | Token encryption via `crypto.subtle` AES-GCM; adapters use raw `fetch`, never a platform SDK, until each SDK is confirmed safe for the Workers Builds bundle |
| Secrets via `wrangler secret put` | Platform app client secrets (Meta App Secret, TikTok Client Secret, etc.) and the token-encryption key are Worker secrets, never in `wrangler.jsonc` |
| CSP `connect-src` is locked to `'self'` + Supabase host | **Needs an ADR.** The composer's live preview and any client-side platform SDK (there shouldn't be one) must not require new CSP hosts; all platform API calls happen server-side, so CSP should not need to change — flag this explicitly in the ADR as a design constraint, not an afterthought |
| No CORS wildcards on `/api/v1/*` | Unchanged — same-origin only |
| Webhook signature verification | Any inbound platform webhook (e.g., a future Meta webhook for comment-reply features) must verify signature before touching data, exactly like the existing Fal/LemonSqueezy webhook handlers |
| OAuth `redirect_to` built from `window.location.origin` / `PUBLIC_HOST` only | The `/callback` route never accepts a caller-supplied redirect target; see §2.7 for the full OAuth hardening list |
| Append-only audit log | `social_account_actions`, `smart_link_clicks` |
| Rate limiting at the entry point | `POST /api/v1/social/posts`, `/connect`, and every publish-adjacent write get the same Postgres-backed sliding-window limiter pattern as `check_generation_rate_limit`, sized to prevent a compromised token being used to spam-post at platform-breaking volume |

This table maps to this repo's own house rules. For the external standards mapping the user asked
for (OWASP Top 10, OWASP API Security Top 10, NIST, ISO/IEC 27001, NCSC) — including where the
controls above satisfy which named control in each framework — see
[05-security-baseline.md](05-security-baseline.md), which is the audit-facing companion to this
section.

## 2.11 Open engineering risks

1. **OAuth app review.** Meta, TikTok and YouTube all require an app-review process before granting
   production posting scopes (not just "read" scopes) — this is a weeks-long external dependency
   that should start immediately, independent of engineering sequencing.
2. **Platform rate limits.** Meta Graph API, TikTok's Content Posting API and YouTube's Data API v3
   each impose daily/hourly quotas; the analytics sweep in particular must be designed to degrade
   gracefully (stale-but-present data) rather than fail the whole account when one metric call is
   throttled.
3. **TikTok's Content Posting API audit mode.** New TikTok apps start in an audited/restricted mode
   (private-only posting, watermark) until TikTok approves full production access — this affects the
   v1 launch messaging for that network specifically.
4. **Token storage blast radius.** A compromised token-encryption key would expose every connected
   account's posting ability. Recommend a dedicated Worker secret (not reused from any other
   subsystem) and a documented rotation runbook, consistent with the "rotate any secret that leaves
   the machine within 24 hours" rule already in `CLAUDE.md`.
5. **Third-party API response trust.** Data pulled back from platform APIs (captions, display
   names, competitor handles, analytics labels) is external, attacker-influenceable input — a
   competitor account's display name is not something Veyrnox controls — and must be HTML/JS-escaped
   at every render site and size/type-validated before storage, the same way this repo already
   treats any external data as untrusted (see 05-security-baseline.md, OWASP API10).
6. **No security testing has happened yet.** This is a spec, not shipped code. Before GA, run the
   same review discipline this repo already requires for security-sensitive code (`CLAUDE.md`'s
   mandatory security-reviewer trigger for auth/API/external-call code) plus a focused pass on the
   OAuth flow and the media/SSRF boundary specifically, given how much of this feature's attack
   surface is new external integrations rather than internal logic.


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
