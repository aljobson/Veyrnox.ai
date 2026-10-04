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
| `TIKTOK_ANALYTICS_SCOPE_ENABLED` | Adds `user.info.stats` and `video.list` to TikTok consent. Needs Display API/scopes approval and reconnect first |
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
2. **YouTube analytics — completed in PR #513.** Uses the existing
   `youtube.readonly` grant and refresh adapter. No new consent or migration; collection
   remains behind `PUBLISH_ANALYTICS_ENABLED`. See the follow-up below.
3. **TikTok analytics — implemented on `codex/tiktok-analytics`.** The owner approved
   proceeding after TikTok was recommended. Its new consent scopes ship off. See below.
   **X and LinkedIn remain.** LinkedIn member post statistics need a different API
   product; X reads are billed by X. Each is still an owner decision.
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


## Codex follow-up: TikTok analytics (2026-10-03)

- `fetchAnalytics` in `packages/adapters/social/tiktok.js` checks the token's `open_id`
  against the stored connection before reading videos. `user.info.stats` enables
  followers, following, account likes and public video count; `video.list` enables
  views, likes, comments and shares for the latest 50 public videos (20 + 20 + 10).
  Partial grants are honored. Invalid/missing counters are omitted, not reported as zero.
- The consent switch is `TIKTOK_ANALYTICS_SCOPE_ENABLED`, default "false". Add Display
  API and submit `user.info.stats` and `video.list` for approval using the justification
  in `06-oauth-review-runbook.md`; enable only after approval, then reconnect accounts.
  The callback stores the token response's actual grants, never the requested scope list.
- TikTok token refresh is new. Migration `0190_tiktok_token_rotation.sql` stores both
  encrypted tokens, expiry and grants atomically, checking the old token pair and active
  TikTok status. Reconnect/disconnect/concurrent refresh refuses stale writes. Apply
  this migration through the main workflow before collecting TikTok analytics.
- The dashboard shows account likes/public video totals and a Shares column. Date
  ranges select video publication dates; video counters are lifetime, public-only.
- No real TikTok API request, live OAuth consent or refresh has been verified. Staging
  needs an approved app/test account, 0188/0190 applied, Publish/analytics enabled and
  a new consent grant. Production switches remain off. Best-time/calendar and X/LinkedIn
  are still future work; no pricing/entitlement decision was made here.

Sources checked: [Get User Info](https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info),
[List Videos](https://developers.tiktok.com/doc/tiktok-api-v2-video-list),
[Video Object](https://developers.tiktok.com/doc/tiktok-api-v2-video-object), and
[User Access Token Management](https://developers.tiktok.com/doc/oauth-user-access-token-management).

Local verification for the TikTok slice: 1,277 unit tests pass, one skipped, none fail;
290 database acceptance tests pass on fresh local Postgres 16, all 180 migrations replay,
and all 25 database script checks from `ledger-tests.yml` pass. Token-rotation tests
cover atomic updates, competing refreshes, stale tokens, disconnect/reconnect, input
validation, role privileges and replay. Next.js production build/OpenNext packaging,
lint (zero errors, 67 existing warnings), type check, client credential boundaries,
hard-wall, migration numbering and catalog guards pass. Browser fixture checks cover
TikTok totals/chart/Views/Shares/interactions at desktop and 375px, Instagram Reach/Views,
and unsupported-network messaging. The table scrolls inside its container on mobile;
the page does not overflow. The local fixture emitted auth/CAPTCHA console errors;
this was UI verification with fixture responses, not a clean live-account smoke test.


## Posting insights implementation (2026-10-03)

Migration **0191_social_posting_insights.sql** adds weekly cached timing and posting-frequency
aggregates. `PUBLISH_POSTING_INSIGHTS_ENABLED` defaults to `"false"`; apply 0191 through the
protected main migration workflow before enabling it. Publish and analytics collection must
also be enabled. No additional platform permission or external API is required.

The implementation uses publication timestamps and counters in `social_analytics_posts`,
not daily account snapshots. One JSON aggregate per account updates timing, frequency and
empty-history metadata atomically. It covers twelve complete weeks in the brand timezone,
independent of the dashboard's date filter. Invalid timezones fall back to UTC.

Measured posts need numeric likes and comments and must be at least 48 hours old. Timing
recommendations need ten measured posts spanning fourteen days and three posts in a slot.
Unknown scores stay null; sparse histories receive no generic recommendation. Frequency
counts every stored post and weights averages by measured posts. Lifetime counters favour
older posts; these observations do not establish causation or audience availability, and
collection may omit older/private/deleted posts. These choices amend the original heatmap
schema and generic cold-start proposal in technical spec §2.5.

Owner-only reads, service-only functions, RLS/FORCE RLS and denied direct table grants match
analytics security. Cache failure does not block successful ingestion or other dashboard
analytics. Next engineering slice: the calendar view. X/LinkedIn analytics and live account
verification remain dependent on owner API-access and permission decisions. Staging Publish
schema provisioning remains outstanding; this change does not enable any remote switches.

Posting-insights validation: 1,288 unit tests pass (one existing skip), 296 database
acceptance tests pass, and all 181 migrations replay on a fresh PostgreSQL 16 database.
The 25 database integration/guard scripts pass. Lint has zero errors and 67 existing
warnings; typecheck, security boundary, migration numbering, catalog guards and hard-wall
checks pass. Fixture browser checks cover desktop/mobile, light/dark themes, 168 heatmap
cells, weighted frequency, sparse history, isolated errors/retry, keyboard scrolling and
an independent fixed date window. The 21st review's heatmap minimum-width warnings are
intentional: its labelled, focusable panel scrolls within a 375px-wide page. The account
selector warning predates this change. Existing local auth/Turnstile errors and a repaired
fixture-proxy socket reset mean browser console checks were not clean. No real platform
account or remote posting-insights RPC was exercised.
The Next.js production build and full OpenNext Worker packaging also pass.

## Calendar implementation (2026-10-04)

The month/week/list calendar lives at `/app/publish/calendar`. Its link appears in the
existing Scheduled & published section only when `PUBLISH_CALENDAR_ENABLED` is exactly
`"true"`. This switch defaults to `"false"`; apply **0192_social_publish_calendar.sql**
through the protected main workflow before enabling it. Publish must also be enabled.
No platform permission or analytics collection is required for the calendar.

Dates use the viewer's browser timezone, matching the existing composer. Month and list
cover the same six-week Monday-first grid, including adjacent-month dates; week covers
seven days. Status and network filters execute in the database. The indexed date-range
reader excludes drafts, uses an exclusive end and returns 100 posts per page with an
explicit Load more control. It reads scheduled timestamps, not platform publication times.

Drag an unstarted post to a day to open a confirmation form, preserving its local time.
The same form is available through the Reschedule button for keyboard and touch users.
Daylight-saving gaps and times less than a minute ahead are rejected. All targets move
together, and started/retried/submitted/partially published or terminal posts cannot move.

The reschedule RPC checks owner identity, locks targets before the parent without waiting,
compares the original timestamp, and also updates every target's next-attempt time. Moving
that target field makes the existing worker recheck an updated target even if its parent
snapshot predates the move. Concurrent edits return a conflict; busy locks return POST_BUSY.
A replay of the same requested time is a no-op, and a successful change appends exactly one
post_rescheduled audit event. Both new RPCs revoke browser/PUBLIC execution and grant only
service_role. No direct table grants or credit/ledger changes are introduced.

Next owner work remains migration approval and staging Publish schema provisioning; live
account checks and X/LinkedIn API-access decisions are still outstanding. Plan gating is
not implemented because the product decision remains open. Calendar work completes this
handover's currently specified engineering sequence.

Calendar validation: 1,297 unit tests pass (one existing skip); the full database suite
passes 304 tests, including the locked-post conflict test. All 182 migrations replay on a fresh local
PostgreSQL 16 database and all 25 integration/guard scripts pass. Lint has zero errors and
67 existing warnings; typecheck, security boundaries, migration numbering, catalog guards
and hard-wall checks pass. Browser fixtures verify month/week/list, mobile containment,
filters, confirmation, saving, conflict messages, empty/error/refresh states, Escape/focus
restoration and synthetic drag events (no write until confirmation). The native modal and
existing design tokens are reused without adding dependencies. 21st review warnings are
intentional contained calendar width and the responsive page maximum width. Existing local
Supabase auth/Turnstile failures and intentional fixture 409/502 responses mean the console
is not clean. No live platform account or remote calendar RPC was exercised. Repeated
fall-back hours use the browser's chosen offset; the form displays the proposed UTC instant.
The final Next.js production build and complete OpenNext Worker packaging pass.


## Rollout follow-up (2026-10-04)

This section supersedes the earlier outstanding migration and switch status.
Production migrations through 0192 applied successfully in protected workflow run
37182909856. PR #518 enabled `PUBLISH_CALENDAR_ENABLED`; production deployment
37183276498 passed all five site health checks. `PUBLISH_ENABLED`, analytics collection,
posting insights and provider consent switches remain off in production.

Staging project `yrqzwqywxfesmbvhzjgj` was missing the Publish schema. The existing main
migrations 0154, 0156, 0157, 0160, 0161, 0168, 0169, 0175, 0176, 0182, 0188, 0190,
0191 and 0192 were applied byte for byte, individually under their repository names.
Staging already had 0177 before the social audit table existed. Its idempotent SQL was
applied separately as `staging_publish_append_only_no_truncate` to install the missing
audit truncate guard without duplicating the existing migration name. This is staging
history only; it is not a new production migration.

Staging verification found all twelve Publish/quota tables with RLS and FORCE RLS,
no browser SELECT grants, no browser execution of social SECURITY DEFINER RPCs,
and the social audit truncate guard present. Calendar, reschedule, analytics and
posting-insights RPCs reject invalid identities with USER_NOT_FOUND. These checks
exercise the remote database but do not constitute an authenticated provider test.

The staging configuration change explicitly enables Publish, analytics collection, posting insights
and calendar; environment variables are not inherited from production. Instagram insights
and TikTok analytics consent remain off pending provider approval.

At provisioning, staging had zero brands, accounts and posts and no social OAuth client
or token/state/media-signing secrets. The next live test needs a privately configured
provider OAuth app and an owner-controlled test account. YouTube is recommended first
because its analytics uses the existing youtube.readonly consent. After connecting,
verify actual API fetch/refresh, stored metrics and timing cache, then calendar reads and
rescheduling of an unstarted test post. Do not claim a live provider test from empty
pages, anonymous health checks or fixture data. Production Publish remains closed.

Security advisors report informational no-policy notices for the deliberately closed RPC-only
tables; no Publish definer function is browser-executable. Other reported warnings concern
existing public status/catalog RPCs, project inspection and leaked-password protection, outside
this rollout. The three internal Publish secrets are generated independently for staging;
provider OAuth client credentials still require private configuration.


Staging deployment completed: initial version `23aeec60-0f39-4462-b34d-546aff3e3aed`,
final secret-bearing version `b64839da-d5c3-40fd-9097-501c11f14967` at 100% traffic.
Both versions have the same script etag. All four Publish switches read back as true;
the three internal secrets exist, and the Supabase binding targets staging. The protected
temporary secret file was removed after deployment. Production was not deployed or mutated.

Verification: 20 focused feature/calendar/insights unit tests pass; a staging-identity
Next.js/OpenNext build and Wrangler dry run pass; all five remote site-health probes pass.
The in-app browser loads Publishing calendar and its sign-in state, replacing the previous
404. Anonymous calendar API access returns typed 401 unauthorized. No authenticated calendar
read/write, real OAuth consent, provider API call or token refresh was performed: staging
still has no connected accounts and no provider OAuth client credentials. PR #519 preserves
this configuration and handover for subsequent merges/deployments.


## Live staging acceptance — 2026-10-04

This section supersedes the earlier statements that real YouTube data and OAuth
refresh had not been verified. The owner connected **The Adventures of Pip,
Hazel & Ollie** to the AI staging project (`yrqzwqywxfesmbvhzjgj`) using the
separate Google Cloud project `veyrnox-ai-publish`. The connection is active,
granted `youtube.readonly` and `youtube.upload`, and has a stored refresh token.
No credential values belong in this handover.

- **Initial real analytics fetch passed at 13:30:30 BST.** The scheduled Worker
  stored 2,260 subscribers (YouTube's rounded count), 79,715 lifetime channel
  views, 15 public videos and 15 video analytics records. The signed-in staging
  dashboard rendered the same channel totals. Its 30-day period showed zero
  videos because publication dates fall outside that period; channel totals
  are lifetime totals.
- **Real OAuth refresh passed at 13:45:29 BST.** For this staging-only acceptance
  test, the account's stored token expiry was marked past via the existing
  service-only `update_social_account_token` RPC, and its analytics sync was
  made due. The test guarded the account identity, active status, unchanged
  encrypted token, original expiry and sync time, and absence of post targets.
  The next existing cron run replaced the encrypted access-token value,
  persisted expiry **14:45:27 BST**, completed another successful analytics
  fetch with 15 stored videos and left both sync error fields null. This tests
  the refresh branch by making expiry metadata due; it does not claim the
  original Google access token naturally expired during the test.
- The sync resumed its normal six-hour schedule, next due **19:45:28 BST**.
  The connected account remains active. No posts were scheduled or published,
  and production configuration was not changed by this acceptance test.
- Google OAuth was configured in **Testing** for this acceptance. This verifies the owner's test account,
  not a public rollout or long-term refresh-token longevity.

### Sign-in prerequisites completed

PR #520 keeps Apple and passkeys visible in every shared authentication dialog
and is merged. Production deployment passed. Staging Supabase now reports
Apple, Google and passkeys enabled. The existing AI Apple Services ID
`ai.veyrnox.web` has both production and staging Supabase domains and callbacks;
its existing signed client secret was entered into staging by the owner. Apple
staging authorize returns a 302 to Apple with the expected Services ID, staging
callback and `form_post` response mode. A complete Apple token exchange and a
real staging passkey sign-in have not been observed in this acceptance test.
Production passkey RP ID remains `veyrnox.ai`; staging uses its separate Worker
hostname, so credentials are enrolled separately.

### Remaining work

1. Verify complete Apple and passkey sign-ins on staging using owner-controlled
   accounts and devices.
2. Complete the remaining calendar cases listed below. Real YouTube upload and
   publication are still unverified and require an explicit owner-approved post.
3. Complete provider review and real account acceptance for Instagram insights
   and TikTok analytics before enabling their new consent scopes.
4. Decide X/LinkedIn analytics scope and cost before implementation. Analytics
   plan gating and caption suggestions remain product decisions.

YouTube read analytics and token renewal no longer block the next acceptance
slice. They do not by themselves approve production Publish activation.

## Live staging calendar acceptance — 2026-10-04

The deployed calendar was tested in the owner's signed-in session on AI staging
(`yrqzwqywxfesmbvhzjgj`) with one deliberately non-publishable fixture:
`416c53ec-6d0e-4b0c-89fe-ae301600d83f`, captioned
“Calendar acceptance test (no media; never publish)”. It had one pending
YouTube target and zero media rows. It was seeded directly for this test;
this does not verify draft approval, media selection or the compose flow.
The initial schedule was 5 October at 13:00 BST (12:00 UTC), safely in the future.

- Month, week and list views rendered the fixture. Week navigation moved from
  28 September–4 October to 5–11 October and showed the expected post.
- The scheduled-status filter retained it. The Instagram filter excluded it
  and showed the empty state; the YouTube filter restored it.
- The reschedule form rejected 1 October at 13:00 BST as a past time.
  Saving 6 October at 13:00 BST succeeded and the list showed the new date.
  Database verification confirmed both the parent schedule and the target's
  `next_attempt_at` moved to `2026-10-06T12:00:00Z`, with exactly one
  `post_rescheduled` audit event recording the original and new timestamps.
  A same-time save was idempotent and did not add an audit event.
- A service-only RPC attempt using the original schedule as its expected
  value returned `SCHEDULE_CHANGED`. This verifies stale-write rejection in
  the deployed database; the browser's conflict-message path was not exercised.
- Cleanup canceled the parent, marked its pending target failed with
  `acceptance_fixture_canceled`, and appended a cancellation audit event.
  The canceled-status filter showed the retained fixture with “Schedule locked”
  and no reschedule control. Its target remained at zero attempts, unclaimed,
  with no platform post ID or URL and zero media rows. Nothing was published.

No code change, migration or Worker deployment was needed for this acceptance.
Production was not changed. Drag-and-drop, daylight-saving boundaries, pagination,
multiple-target rescheduling and active-worker lock contention remain unverified
in the live browser; existing automated coverage is not a substitute for those
live cases. Complete owner-controlled Apple/passkey sign-ins next, then agree
an explicit test post before testing real YouTube publication.

Passkey enrollment attempt at 14:22:05 BST reached staging Supabase but returned
403 `insufficient_aal`: the owner's MFA-enabled account requires an AAL2 session
to manage passkeys. The owner must use the existing authenticator-code “Unlock
this session” control before enrolling. No passkey was created by this attempt.
The passkey error copy now explains that step instead of suggesting a connection
problem; 18 focused passkey tests pass. Successful enrollment and sign-in remain
unverified until the owner completes the device authentication prompt.
