# Handover: Veyrnox Publish analytics (2026-10-03)

For the next agent picking up Veyrnox Publish. It covers the analytics work on branch
`claude/metricool-zernio-replica-adc1db` and what the owner wants built next. The general
project handover is [docs/product/HANDOVER-2026-10-03.md](../product/HANDOVER-2026-10-03.md);
read that first for the repo's rules, deploy model and verification standard.

## What the owner asked for

A scheduling and analytics product like Metricool and Zernio, built natively inside
Veyrnox.ai and offered to Veyrnox.ai users, so they can post and schedule the AI content
they generate here without leaving the product. The two screens the owner pointed at were
Metricool's Instagram "Evolution" analytics and Zernio's posting analytics.

Decisions already made, do not reopen them without the owner:

- **Native, not a vendor.** ADR-0061 chose our own adapters over a unified posting API.
  Zernio is such a vendor; the owner confirmed "build my own" on 2026-10-03.
- **Nothing to fork.** Metricool has no public source. Zernio's platform is closed; its
  GitHub organisation (`zernio-dev`) publishes SDKs and thin front ends for its paid API.
  Useful as reference only: `openapi-specs` (MIT, OpenAPI files for 16 networks),
  `latewiz` (MIT, calendar and composer UI), `ads-dashboard` (MIT, reporting UI).
- **Insights permission approved.** The owner approved requesting
  `instagram_business_manage_insights` on 2026-10-03.

## What exists now

Before this branch: OAuth connect for Instagram, X, TikTok, LinkedIn and YouTube, the
composer (media comes from the user's own generations by job id), the scheduling sweep,
and draft review, all behind `PUBLISH_ENABLED` (off in production).

Added on this branch:

| Piece | Where |
|---|---|
| Storage and RPCs | `packages/db/schema/supabase/0188_social_analytics.sql` |
| Instagram fetch | `fetchAnalytics` in `packages/adapters/social/instagram.js` |
| Ingestion sweep | `lib/socialAnalyticsSweep.js`, called from `worker.js` |
| Read API | `GET /api/v1/social/analytics` (`app/api/v1/social/analytics/route.js`) |
| Dashboard | `app/veyrnox/app/publish/analytics/` (`page.js`, `FollowersChart.js`) |
| Dashboard arithmetic | `lib/social/analyticsSummary.js` |
| Decision record | "Amendment 2026-10-03" in `docs/adr/0061-veyrnox-publish-social-scheduling.md` |

How it works:

- The five-minute cron claims up to five due accounts (`claim_social_analytics_accounts`).
  Claiming moves the account's next turn six hours on, so a tick that dies loses one round
  for that account and nothing else.
- For each account the network fetcher returns `{ metrics, posts }`, stored by
  `record_social_analytics`: one evolution snapshot per account per UTC day and one row
  per post. Metrics are merged key by key, so a number a later fetch could not read is
  kept. A failed fetch is recorded on the account's sync row.
- `get_social_analytics` returns an account's numbers to its owner only. All three tables
  are closed to browser roles; every function is service-role only.
- Only networks with an entry in `FETCHERS` (sweep) are claimed. The dashboard has its own
  list, `ANALYTICS_NETWORKS` in `page.js`; keep the two in step when adding a network.

Instagram numbers:

- Always: followers, following, post count; likes and comments per post (latest 50 posts).
- With the insights permission: the account's reach and accounts engaged over the last 24
  hours, and reach, views, saves and shares for the ten newest posts. Metric names were
  checked against Meta's insights references on 2026-10-03.

## Switches, all "false" in production

| Variable | Effect when "true" |
|---|---|
| `PUBLISH_ENABLED` | Opens Publish: the pages, the menu link and `/api/v1/social/*`, including analytics |
| `PUBLISH_ANALYTICS_ENABLED` | Runs the analytics sweep. Needs 0188 applied first |
| `INSTAGRAM_INSIGHTS_SCOPE_ENABLED` | Adds the insights permission to the Instagram consent screen. Needs Meta's approval first |

Accounts connected before the insights switch keep their old grant until they reconnect;
the sweep asks for insights only where the stored grant includes the permission.

## Verified, and not

Verified locally on 2026-10-03:

- `npm test`: all unit tests pass, including the new adapter, sweep, route and summary tests.
- `packages/db/social-analytics.acceptance.test.ts` and the whole acceptance suite pass
  against a local Postgres; `scripts/replay-migrations.mjs` applies 0188 with every other
  migration on a fresh database; the default-privileges, FK-index and append-only scripts pass.
- The dashboard was driven in a browser against the real functions in a local database,
  with the sweep run end to end using a fake network fetcher.

Not verified:

- No call has been made to the real Instagram API. The fetch is tested against stubbed
  responses only. The first real run should be on staging with an app-role Instagram
  account, watching `[analytics-sweep]` in the Worker log.
- Requesting the insights permission before Meta approves it has not been tried. That is
  why it sits behind its own switch.
- Workers subrequest use per cron tick has not been measured with the sweep running.

## Owner actions

1. Approve the `apply-migrations` run for 0188 after the PR merges.
2. Add `instagram_business_manage_insights` to the Meta app review submission
   (`06-oauth-review-runbook.md` has the justification text).
3. After 0188 is applied, set `PUBLISH_ANALYTICS_ENABLED` to "true" on staging first.

## Next work, in the order the owner was given

1. **"Schedule this" on a generation result — completed in PR #512.** Studio results,
   batch tiles and Library cards open Publish with the image/video selected by job id.
   Behind `PUBLISH_ENABLED`; no migration. Caption suggestions remain future work.
2. **YouTube analytics — implemented on `codex/youtube-analytics`.** Uses the existing
   `youtube.readonly` grant and refresh adapter. No new consent or migration; collection
   remains behind `PUBLISH_ANALYTICS_ENABLED`. See the follow-up below.
3. **X, TikTok, LinkedIn analytics.** Each needs scopes the connect flows do not request
   today (`user.info.stats` and `video.list` on TikTok; LinkedIn member post statistics
   need a different API product). X reads are billed by X. Each scope change is an owner
   decision and a re-consent for connected accounts.
4. **Best time to post** and **posting frequency against engagement** (the Zernio screen),
   computed from `social_analytics_posts`. Technical spec §2.5 describes the cache table.
5. **Calendar** (month, week, list; drag to reschedule). There is no reschedule RPC yet.
6. Plan gating for analytics, if ADR-0063 should cover it. Not decided.

## Traps met on this branch

- A git worktree here resolves `node_modules` from the main checkout, which can be on an
  older branch. Lint failed to load and one Miniflare test failed until `npm ci` was run
  inside the worktree.
- `worker_task_health.task` has a CHECK list of names (0157). The analytics sweep is not
  wrapped in `observeRecovery` for that reason; wrapping it needs a migration that widens
  the list and carries `refresh_recovery_health` forward.
- `ON CONFLICT (account_id)` inside a `RETURNS TABLE (account_id ...)` function needs
  `#variable_conflict use_column`.
- The acceptance tests in `packages/db` depend on being run in file order against one
  database; a single file run alone against a base-schema database fails for want of
  objects an earlier file created. Run against a replayed database when working on one file.
- The Metricool connector available to Claude sessions is the owner's own account, and the
  brand in it belongs to the separate wallet business. Use it for metric definitions only,
  never as product data (see the hard wall in `CLAUDE.md`).

## Codex follow-up: YouTube analytics (2026-10-03)

- `fetchAnalytics` in `packages/adapters/social/youtube.js` reads the connected channel,
  its uploads playlist (latest 50), and one batched video-statistics response. It checks
  the returned channel against the stored connection and ignores foreign/missing videos.
- Channel snapshots store subscribers (`followers` for the shared chart), views and
  public video count. Posts store lifetime views, likes and comments, plus video titles
  and publication dates. Missing counters are omitted; subscriber counts are rounded.
- The analytics sweep refreshes expired/expiring YouTube tokens with the existing
  refresh adapter and encrypts/persists the replacement via `update_social_account_token`.
  A refused token update (including disconnect during refresh) stops that account's fetch.
  The Worker passes its YouTube client configuration directly from bindings.
- Both `FETCHERS` and `ANALYTICS_NETWORKS` include YouTube. The dashboard calls its
  audience Subscribers and its posts Videos, displays channel totals, and shows video
  Views independently of Instagram Reach. Date ranges filter video publication dates;
  they do not turn lifetime counters into views/interactions earned during that range.
- No live YouTube API call or OAuth refresh has been verified. Test with a real staging
  channel after 0188 is applied and the analytics switch is enabled there. Watch time,
  revenue, subscriber gains/losses and period-specific views need the separate YouTube
  Analytics API and are outside this slice.

Sources checked: [channel statistics](https://developers.google.com/youtube/v3/docs/channels),
[upload playlists](https://developers.google.com/youtube/v3/docs/playlistItems/list), and
[video statistics](https://developers.google.com/youtube/v3/docs/videos).

Local verification for the YouTube slice: 1,235 unit tests pass, one skipped, none fail;
Next.js production build, OpenNext Worker packaging, lint (zero errors, 67 existing warnings), foundation type check,
client credential boundaries, hard-wall, migration numbering and catalog guards pass.
The dashboard was driven in the gstack browser with local fixture API responses:
YouTube cards/chart/video views, Instagram reach/views, unsupported-network messaging,
and the 375px mobile layout. No database/RPC definition changed; no database replay was
repeated for this slice. Real YouTube data and OAuth refresh remain unverified.
