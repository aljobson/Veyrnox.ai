# Veyrnox Publish production rollout

Prepared 9 October 2026. Release platforms individually, starting with YouTube.
The owner does not need accounts on every platform: designated administrators
provide developer apps and designated testers perform real-account acceptance.
This document prepares the release; it does not activate production.

## Current production evidence

Read-only checks on 9 October against Worker `veyrnox-ai`, account
`fb18d9f7052afbea5a5e0eae69948af2`:

- Production Supabase is `xdxdzmsztyzbnzeforxx`; staging is a different project.
- Observed live version: `3dfea0d0-0fa2-406e-8f57-a7fc4497d690`, 100% traffic.
  Re-read the current version immediately before release; other work continues.
- Live flags match the repository: Publish, analytics, posting insights,
  uploads and extended networks are false; calendar is true but remains behind
  the overall Publish gate. Instagram insights and TikTok analytics consent
  remain false.
- Secret names confirm the three shared social secrets exist. Production has
  no `YOUTUBE_CLIENT_ID` or `YOUTUBE_CLIENT_SECRET`. Values were not retrieved.
- Production already has `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`.
  `networkReadiness()` makes a base network available when its credentials and
  shared prerequisites exist. Therefore flipping `PUBLISH_ENABLED` alone is
  **not a YouTube-only release**. The extended switch does not gate TikTok.
- The production migration ledger is readable: all 200 applied entries are
  accounted for. Publish foundation/scheduling, async engine, account cap,
  analytics 0188, posting insights 0191, calendar 0192 and extended connections
  0228 are present. This checks migration names, not runtime RPC permissions.
- Latest observed `deploy-production` run
  [37945267499](https://github.com/aljobson/Veyrnox.ai/actions/runs/37945267499)
  completed successfully. Recheck the release commit's CI and deployment.

## What has passed on staging

See [7 October acceptance](ACCEPTANCE-2026-10-07.md) and the
[analytics handover](HANDOVER-analytics-2026-10-03.md): YouTube OAuth, analytics,
refresh, owner-approved video upload/processing/publication and video analytics;
calendar rescheduling, conflicts, pagination, timezone boundaries and locking;
Apple and passkey sign-in on the owner's device.

These results do not prove production OAuth configuration, public Google app
approval, long-term refresh-token behavior or the other providers' acceptance.
Do not republish the staging acceptance video.

## YouTube release gates

Complete these in order before opening Publish to production users:

1. **Isolate YouTube.** Add and verify a server-enforced per-network release
   gate for connections and new post targets, plus matching UI readiness.
   Production should allow only YouTube; staging keeps its tester platforms.
   Do not delete existing TikTok credentials to approximate a release gate.
   Confirm whether production has existing accounts or queued targets before
   changing dispatch behavior. An untested platform must not become available
   simply because credentials exist.
2. **Prepare production Google OAuth.** Use a production app/project separate
   from staging, with the exact callback
   `https://veyrnox.ai/social/connect/callback/youtube`, production branding,
   privacy/terms links, verified domains and the scopes actually requested by
   the adapter (`youtube.readonly`, `youtube.upload`). Verify API activation,
   approved quota, consent configuration and production access. Do not copy
   staging encrypted account tokens or its token encryption key into production.
3. **Resolve public-access requirements.** The staging consent app was last
   observed in External/Testing. Google documents seven-day expiry for Testing
   authorizations and refresh tokens with these API scopes. Complete the
   applicable OAuth verification and check YouTube's separate API audit/private
   upload restrictions for the actual production project. A successful staging
   public upload does not establish the new production project's audit status.
4. **Install production credentials privately.** Store the new client ID and
   client secret as `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET` in Worker
   `veyrnox-ai`, preserving all other settings. Verify names only. Secret writes
   can deploy a Worker version; use the supported staged-version workflow or
   coordinate with the production deploy process. Never put values in chat,
   issues, PRs or repository files.
5. **Verify the database and media path.** Check service-only Publish RPC grants,
   forced RLS, account entitlement/cap, production R2 and generated-media access,
   callback state signing, encrypted token storage and the five-minute cron.
   Check the device-upload migrations and acceptance separately before enabling
   `PUBLISH_UPLOADS_ENABLED`; generation-library media can be the first slice.
6. **Prepare the activation PR.** After the above gates, enable
   `PUBLISH_ENABLED` and `PUBLISH_ANALYTICS_ENABLED` in production source config.
   Keep calendar true. Initially keep posting insights, device uploads, extended
   networks and unapproved provider consent switches false. Do not advertise or
   charge for unaccepted features; preserve the existing free one-account cap
   and do not activate paid Publish billing as part of this release.
7. **Validate and review.** Run relevant network-gate, OAuth, post, sweep and
   readiness tests; lint/typecheck; production-identity Next/OpenNext build;
   packaging dry run. Review the exact diff and observed binding changes.
   Record which checks use stubs. Squash-merge only when the owner authorizes
   the concrete activation PR and its checks pass.

Google references checked 9 October:
[OAuth audience and Testing expiry](https://support.google.com/cloud/answer/15549945?hl=en),
[separate staging and production projects](https://support.google.com/cloud/answer/13464323?hl=en),
[YouTube upload restrictions](https://developers.google.com/youtube/v3/docs/videos/insert).
OAuth verification and YouTube API audit are separate checks.

## Deployment and acceptance

Use the existing `deploy-production.yml` on merged main. It waits for green CI,
checks main's tip, serializes releases, records the live deployment, runs site
health checks and automatically rolls Worker code back on a failed smoke test.
Do not manually deploy a staging build or the diagnostics branch to production.
Use `apply-migrations.yml` for any missing migration, with the owner's required
environment approval; never apply production DDL through an ad hoc SQL session.

After deployment:

- Read back the actual flags and production identity; verify only YouTube is
  connectable in the signed-in UI and direct API requests reject other networks.
- With an owner-designated production tester, verify connect/denied consent,
  account display, analytics, disconnect/reconnect and token renewal. Do not
  assume the staging account exists on production.
- Separately approve the exact video, caption, channel and public visibility
  before testing Post now or Schedule post. Check queue transitions, provider
  processing, real resulting visibility, public video and later analytics.
- Record version/commit, tester consent, timestamps, statuses and sanitized
  identifiers in an acceptance record. Monitor provider failures and queue age
  over multiple cron ticks. UI queuing alone is not successful publication.
- Keep the remaining networks disabled until each has credentials, necessary
  provider approval and its own real-account acceptance.

## Rollback

Record the full live deployment and bindings immediately before activation.
Revert the activation config and deploy through the same workflow, or restore
the recorded Worker deployment when an urgent code rollback is appropriate.
Secret/configuration changes, OAuth grants, database data and provider posts
are not undone by restoring Worker code.

**Turning Publish off does not stop the publish sweep.** Previously queued
targets can still finish. If a release must stop pending posts, inspect their
ownership and dispatch/claim state and use the supported cancellation path;
do not delete targets or assume a flag cancels public submissions. Treat any
already published content as a separate owner-approved provider action.

## Other platforms and known blockers

| Platform | Next gate |
| --- | --- |
| Bluesky | Fix and accept the 502 connection failure in [#695](https://github.com/aljobson/Veyrnox.ai/issues/695); diagnostics PR #689 remains separate |
| LinkedIn | Staging app 266600565 has both products and callback, but current account cannot verify the company Page; credentials are not installed on staging or production |
| Google Business Profile | API access case 7-6874000042012 pending; production OAuth and actual location/post acceptance still needed |
| Instagram, Facebook, Threads | Company developer-app administrator, provider permissions/review and tester acceptance; owner needs no personal Meta account |
| X, TikTok, Pinterest | Confirm developer access, app approval, applicable costs/quotas and real tester acceptance; existing credentials are not acceptance |
| Twitch | Developer app and tester OAuth/statistics acceptance; this adapter does not upload posts |

Use [the integration tester handover](INTEGRATIONS-TESTING-2026-10-08.md) for
platform formats, credential names and test procedures. No fixed public launch
date is asserted while the production Google and network-isolation gates remain.
