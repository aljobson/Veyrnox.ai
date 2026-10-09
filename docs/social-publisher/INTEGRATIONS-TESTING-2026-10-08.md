# Native social integration tester handover — 2026-10-08

Owner direction: build all eleven networks and have other people test them.
The owner does not need or want a personal Meta account. A designated company
developer-app administrator can supply provider credentials and invite testers.
This is the native adapter build from ADR-0061, not a Metricool/Zernio API proxy.

## What testers can exercise

| Network | Connection / destination | Publishing in this build | Analytics |
| --- | --- | --- | --- |
| Instagram | Instagram Login; Business/Creator account | One image | Existing basic metrics; insights need approved additional consent |
| LinkedIn | OAuth; member profile | One image | Not implemented |
| X | OAuth with PKCE; user profile | One image | Not implemented; API access/cost must be confirmed separately |
| TikTok | OAuth; creator account | One photo delivered to inbox; creator finishes in TikTok | Existing optional analytics consent |
| YouTube | OAuth with PKCE; channel | Video, resumable upload | Existing channel and video metrics |
| Facebook | OAuth; explicit Page choice | One image on the chosen Page | Not implemented |
| Threads | OAuth; profile | One image; container processing is polled across cron ticks | Not implemented |
| Pinterest | OAuth; explicit owned-board choice | One image Pin | Not implemented |
| Bluesky | Handle + dedicated app password; Bluesky-hosted PDS | One image up to 1,000,000 bytes; 300 graphemes | Not implemented |
| Twitch | OAuth; channel | No image/video upload destination | Latest 20 videos and their individual view counts; no invented channel totals |
| Google Business Profile | OAuth with PKCE; explicit location choice | One image in a standard local post | Not implemented |

The six new integrations have automated contract and database tests. They have
**not been exercised against real provider accounts**. Existing live YouTube
evidence is in [ACCEPTANCE-2026-10-07.md](ACCEPTANCE-2026-10-07.md).
This build does not claim full format or analytics parity with Metricool.

## Build verification

- Full unit suite: 1,697 passed, one skipped, zero failures.
- Database acceptance suite with CI's base-migration setup: 360 passed.
- All 214 migrations replayed on a fresh local database, including 0228.
- Browser-function grant and leading foreign-key index checks passed.
- Lint: zero errors (existing warnings); TypeScript check passed.
- Next.js and OpenNext Worker builds passed. Local Publish inspection confirmed
  all eleven platform logos and the existing Apple/passkey sign-in options.

These checks use stubbed provider responses and a disposable local database;
they do not replace the real-account steps below.

## Administrator setup before inviting testers

1. Merge the implementation and apply **0228_social_extended_connections.sql**
   through the owner-approved apply-migrations workflow. Production changes
   remain off until explicitly activated. Never run this migration through an
   ad hoc production SQL session.
2. Set credentials as Worker secrets in the intended environment. Use separate
   staging/test apps where the provider supports them. Do not paste secrets
   into issues, PRs, repository files or the tester report.
3. Register callback URLs below, replacing `ORIGIN` with the deployment's
   exact `PUBLIC_HOST`, e.g. `https://veyrnox-ai-staging.al-jobson.workers.dev`.
4. Add testers to developer-app roles / test-user lists as required. Successful
   local tests do not confer provider app approval or public access.
5. Set `PUBLISH_EXTENDED_NETWORKS_ENABLED="true"` on staging after the migration
   and shared secrets are present. `PUBLISH_ENABLED` must also be true.
   `PUBLISH_ANALYTICS_ENABLED` enables the existing sweep and Twitch statistics.
   Production keeps the extended switch false; staging activation is recorded below.

Shared prerequisites: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SOCIAL_OAUTH_STATE_SECRET`, `SOCIAL_TOKEN_ENCRYPTION_KEY` (base64 32-byte key),
`PUBLIC_HOST`, configured R2 and the normal five-minute publish cron.
Threads media transfer also needs `SOCIAL_MEDIA_PROXY_SECRET`.

| Network | Worker secrets | Callback path / consent |
| --- | --- | --- |
| Instagram | `META_APP_ID`, `META_APP_SECRET` | `/social/connect/callback/instagram`; `instagram_business_basic`, `instagram_business_content_publish` |
| LinkedIn | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | `/social/connect/callback/linkedin`; `openid`, `profile`, `w_member_social` |
| X | `X_CLIENT_ID`, `X_CLIENT_SECRET` | `/social/connect/callback/twitter`; `tweet.read`, `tweet.write`, `users.read`, `offline.access`, `media.write` |
| TikTok | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | `/social/connect/callback/tiktok`; `user.info.basic`, `video.upload` |
| YouTube | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | `/social/connect/callback/youtube`; see adapter's existing scopes and review runbook |
| Facebook | `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET` | `/social/connect/callback/facebook`; `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` |
| Threads | `THREADS_CLIENT_ID`, `THREADS_CLIENT_SECRET` | `/social/connect/callback/threads`; `threads_basic`, `threads_content_publish` |
| Pinterest | `PINTEREST_CLIENT_ID`, `PINTEREST_CLIENT_SECRET` | `/social/connect/callback/pinterest`; `user_accounts:read`, `boards:read`, `pins:read`, `pins:write` |
| Bluesky | No developer-app secret | No OAuth redirect; create a dedicated app password in Bluesky settings |
| Twitch | `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | `/social/connect/callback/twitch`; no privileged scopes; token client/user validated |
| Google Business Profile | `GMB_CLIENT_ID`, `GMB_CLIENT_SECRET` | `/social/connect/callback/gmb`; `https://www.googleapis.com/auth/business.manage` |

Facebook can fall back to `META_APP_ID` / `META_APP_SECRET` if the same app is
appropriate. Prefer the dedicated Facebook variables when provider app IDs or
products differ. Google Business Profile needs its APIs enabled and approved
access; a YouTube OAuth client alone does not establish Business Profile access.

Instagram insights and TikTok analytics permissions retain their existing
separate switches. Do not enable an unapproved permission for a test invitation.
See [OAuth review runbook](06-oauth-review-runbook.md) for existing review work.

## Tester steps and evidence

Use each tester's own Veyrnox staging sign-in and social account. The current
one-account entitlement still applies: disconnect a tester's connection before
switching platforms. Do not disconnect the owner's existing YouTube channel.

1. Open Publish. All eleven logos should be visible. A missing app configuration
   reads **Setup required**; the extended rollout switch reads **Testing not
   enabled**. Configuration readiness does not guarantee provider approval.
2. Choose Connect, complete the provider's consent, and return in the same
   browser/tab. Facebook, Pinterest and Business Profile require an explicit
   destination selection even if only one eligible destination exists.
   Verify that no foreign Page/board/location is offered or connected.
3. For Bluesky, use a dedicated app password, never the main account password.
   The password is cleared from the form on submit and is not retained by the
   server; only encrypted session tokens are stored. Custom/self-hosted PDSs
   are intentionally rejected in this first tester implementation.
4. Select a small owned image (or a video for YouTube), enter a short caption,
   choose **Post now** or **Schedule post**, and confirm the intended account.
   This action publishes real content. Use a test Page/channel/board/location
   and label the content clearly. Test a future scheduled post separately.
5. Allow the five-minute cron to run. New synchronous providers checkpoint the
   provider result, then complete on a following tick. Threads and Business
   Profile may need several ticks for processing. Business Profile completes
   only once Google reports LIVE. TikTok must read delivered, not published.
6. Verify the actual post from the provider's UI and check its caption, image,
   account and visibility. Record the Veyrnox post ID and provider permalink.
7. Test disconnect and ensure queued work for that account stops. Reconnect and
   verify new credentials replace the old connection without adding a slot.
8. Test denied consent, an ineligible resource, expired destination selection,
   unsupported media and excessive caption length. These should fail clearly
   without posting. Twitch must never appear as a composer destination.
9. For Twitch, verify latest-video statistics after the analytics sweep runs.
   No channel follower or subscriber count is claimed by this integration.

For each network report: environment, browser, tester identity (no credentials),
provider app mode/approval status, connection result, selected destination,
post ID, actual visibility, permalink, disconnect result, error code and time.
Never attach access/refresh tokens, app passwords or signed media URLs.

## Recovery and boundaries

- Page/board/location selection payloads are encrypted in a table with forced
  RLS and no browser grants. Selections expire after ten minutes, replace a
  previous pending attempt for that user/network, and are consumed once.
  Failed completion requires starting the connection again.
- Pinterest, Google Business Profile, Twitch and Bluesky refresh tokens rotate
  atomically. Threads renews its long-lived access token before expiry. A stale
  refresh cannot overwrite a reconnect, disconnect or competing rotation.
  Invalid/revoked provider grants still require reconnection.
- Facebook Page tokens come from the selected Page, not the personal profile.
  Page revocation or loss of posting tasks requires reconnecting.
- New public submissions are marked durably before the provider request. If
  the response is lost, `provider_result_unknown_reconcile_before_retry` stops
  another public submission. Check the provider first and reconcile the result
  before scheduling replacement content. This is deliberate duplicate avoidance,
  not a guarantee of automatic reconciliation across every provider.
- The switch gates new connections and new post creation. Already queued
  targets can finish, consistent with the existing Publish rollout policy.
- Weekly automatic brand drafts retain the original five-network scope.
  New integrations are tested through the manual composer in this release.
- Provider review, credentials, quotas, billing access and live acceptance are
  separate from implementation. No review submission or live post is made by
  this build task, and no provider billing tier is purchased.

## Primary API references

- [Facebook Pages posts](https://developers.facebook.com/docs/pages-api/posts/)
- [Meta's Threads API collection](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api)
- [Pinterest authentication](https://developers.pinterest.com/docs/getting-started/set-up-authentication-and-authorization/)
- [Pinterest Create Pin collection](https://www.postman.com/pinterest/pinterest-collections/request/42fo1gv/create-pin)
- [Bluesky post records and images](https://docs.bsky.app/docs/tutorials/creating-a-post)
- [Twitch OAuth](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/)
- [Twitch API reference](https://dev.twitch.tv/docs/api/reference/)
- [Business Profile location listing](https://developers.google.com/my-business/reference/businessinformation/rest/v1/accounts.locations/list)
- [Business Profile local post creation](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts/create)

Meta's direct documentation was rate-limited during this audit; its published
Threads collection was used for the request shapes. Provider contract tests
must be followed by real-account acceptance before broader activation.

## Staging activation — 2026-10-08

- PR #637 squash-merged as `21cb32d8469b2dc975be98bf52b4906b94a6e81e`.
- Owner approved production workflow [37812866934](https://github.com/aljobson/Veyrnox.ai/actions/runs/37812866934);
  0228 applied successfully and the migration ledger check passed.
- The same 0228 file was applied to staging project `yrqzwqywxfesmbvhzjgj`.
  Read-only checks confirmed forced RLS and no anonymous table read or
  authenticated submission-marker execute grants.
- Explicit staging build and Wrangler dry run passed; deployed Worker
  `veyrnox-ai-staging`, version `46341992-80fa-4ee0-aa28-01b54f58e843`.
  Live settings confirmed `APP_ENV=staging`, the staging Supabase URL and
  `PUBLISH_EXTENDED_NETWORKS_ENABLED=true`. Production's switch remains false.
- Browser inspection confirmed all eleven logos, the existing active YouTube
  connection, library/device-upload controls and Post now / Schedule post.
- At activation, staging had shared secrets and YouTube OAuth credentials. Instagram,
  LinkedIn, X, TikTok, Facebook, Threads, Pinterest, Twitch and Business Profile
  still need administrator-provided OAuth app credentials; their connection
  controls correctly show Setup required.
- Bluesky needs no app secret and is configured for tester connections.
  The owner's one-account slot is occupied by YouTube and was not changed.
  Each tester should use their own staging sign-in and dedicated app password.
- No real provider connection, disconnection or public submission was made
  during this activation. New-provider acceptance remains outstanding.

## Google setup update — 2026-10-09

The dedicated Google project is `veyrnox-ai-publish` (number `79068620878`).
Its OAuth app, **Veyrnox Publish**, remains External and in **Testing**.
Google's Verification Center confirms that OAuth verification is not required
in Testing. This is separate from Business Profile API access approval.

- The existing **Veyrnox Publish — staging** client remains for YouTube.
- A separate **Veyrnox Business Profile — staging** web client was created on
  2026-10-08 with callback
  `https://veyrnox-ai-staging.al-jobson.workers.dev/social/connect/callback/gmb`.
  `GMB_CLIENT_ID` and `GMB_CLIENT_SECRET` were installed and their names verified
  in Worker `veyrnox-ai-staging`. No secret values belong in this handover.
- OAuth test users are `al.jobson1@gmail.com` and `support@veyrnox.com`.
  Other Google testers must be added to the test-user list before authorizing.
- Data Access now declares exactly the adapter scopes:
  `https://www.googleapis.com/auth/youtube.readonly`,
  `https://www.googleapis.com/auth/youtube.upload`, and
  `https://www.googleapis.com/auth/business.manage`.
  Google confirmed **Data access changes saved!** on 2026-10-09.
- Branding links are `https://veyrnox.ai/`,
  `https://veyrnox.ai/legal/privacy`, and `https://veyrnox.ai/legal/terms`;
  all three public pages were inspected. The support contact is
  `support@veyrnox.com`. Authorized domains are `al-jobson.workers.dev` and
  `veyrnox.ai`. Google confirmed **Branding changes saved!** on 2026-10-09.
  Domain registration here does not establish Search Console ownership or
  production OAuth verification. No consent-screen logo was uploaded.
- The Business Profile API access application was submitted on 2026-10-08:
  case **7-6874000042012**, with Google's estimate of **7–10 business days**.
  The owner confirmed that VEYRNOX's profile has been verified for at least
  60 days. API approval is still pending; no real Business Profile API call
  or post has been tested.

### Next acceptance steps

1. After Google approves Business Profile API access, enable the required APIs
   in this dedicated project and verify the approved quota before connecting.
2. Have a listed tester use their own Veyrnox staging sign-in and Google account.
   Verify connect, explicit location selection, denied consent and disconnect.
   Preserve the owner's existing YouTube connection and one-account slot.
3. With a tester-selected location and explicit approval for the actual content,
   exercise Post now and Schedule post, verify Google's LIVE result and the
   real public post, and record the evidence described above.
4. Complete the separate production OAuth verification preparation before
   requesting public access. The Testing configuration is not public approval.

Instagram, LinkedIn, X, TikTok, Facebook, Threads, Pinterest and Twitch still
need administrator-provided OAuth app credentials and provider-specific tester
access. Bluesky needs no developer-app secret and can be tested independently
with a tester's dedicated app password. Neither configuration nor stubbed
contract tests establish live acceptance for these networks.
