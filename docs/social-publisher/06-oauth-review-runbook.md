# 6. OAuth App Review Runbook — Meta, TikTok, YouTube (and the six tester-stage networks)

> **As of 2026-10-08 (repo `main` at `bee1ea4f`).** §6.0 is new and records where each network stands,
> taken only from `docs/social-publisher/ACCEPTANCE-2026-10-07.md`, the analytics handover, ADR-0061,
> `docs/product/HANDOVER-2026-10-03.md`, `wrangler.jsonc` and, for the six networks added by PR #637, [INTEGRATIONS-TESTING-2026-10-08.md](INTEGRATIONS-TESTING-2026-10-08.md) (§6.8). **No provider approval is recorded
> anywhere in the repo.** Where the records are silent this runbook says *unverified* instead of
> guessing; the owner holds the developer-console state and should confirm each line below.

**Purpose:** everything needed to actually click "submit" on each platform's developer app
registration and API review, without an agent having to hold business credentials or make
verification claims on Veyrnox's behalf. This is prep work, not the submission itself — see
[§6.5](#65-what-only-a-human-can-do-and-why) for exactly where the line is and why.

**Honesty note, matching this pack's existing discipline** (ADR-0061 §"What each platform is
expected to require of us"): the process descriptions below reflect general, current-at-writing
knowledge of each platform's developer program. Exact scope names, review-tier thresholds, and
turnaround times drift — **re-check each platform's own developer docs immediately before
submitting**, don't submit from memory of this document alone. Where a claim is genuinely uncertain
this doc says so rather than asserting a number that hasn't been checked live.

## 6.0 Review status by network (2026-10-08)

"Live-tested" means a real provider call on a real connected account recorded in the acceptance
documents; fixtures and stubbed tests do not count. "Approved" means the repo records a provider
approval. Nothing was found that does.

| Network | Live-tested | Provider approval | Submitted / in review | What is outstanding |
|---|---|---|---|---|
| **YouTube** | **Yes, on staging.** OAuth connect with `youtube.readonly` and `youtube.upload`; real channel analytics (2026-10-04); real token refresh (2026-10-04); a real owner-approved video **uploaded, processed and published publicly on 2026-10-07** (queued 20:30 UTC, public 20:40 UTC); real video analytics fetched 22:05 UTC | None. The Google OAuth consent screen is in **Testing** (the Google Cloud project is `veyrnox-ai-publish`), which only lets listed test users authorize. Sensitive-scope classification of `youtube.upload` still unchecked | Verification submission: not recorded (*unverified*) | Move from Testing to production verification (demo video, privacy policy, scope justification); confirm the scope classification; file a quota increase once real usage exists (default 10,000 units/day, an upload costs about 1,600); publishing is always public, so each real test needs an owner-selected video and visibility |
| **Instagram** | **No.** No Instagram connection, publish or analytics call is recorded; fetchers and the publish path are unit-tested against stubs. The acceptance record's next step is to choose an owner-controlled Business or Creator account | None. `instagram_business_content_publish` and `instagram_business_manage_insights` both need Meta App Review. Meta approval of the insights permission is explicitly still required (acceptance 2026-10-07) | Submission: not recorded (*unverified*). The owner approved *requesting* the insights permission on 2026-10-03; the justification text is in §6.2 | Meta Business Verification, App Review for both permissions with a screencast (the connect to publish path now exists to record, but has not been proven on Instagram), live acceptance on an owner account, then turn on `INSTAGRAM_INSIGHTS_SCOPE_ENABLED`. `wrangler.jsonc` still says `META_APP_ID/SECRET` are "not yet provisioned" (*unverified* whether that is stale) |
| **TikTok** | **No.** No real TikTok OAuth consent, publish or analytics request is recorded | None. The app is **unaudited**, so posts go through MEDIA_UPLOAD (draft in the creator's inbox) and the product says so. Analytics scopes `user.info.stats` and `video.list` need Display API plus approval (acceptance 2026-10-07: provider review still required) | Submission: not recorded (*unverified*). The TikTok DNS verification record was still listed as awaited on 2026-10-03 (`HANDOVER-2026-10-03.md`) and is not recorded as done | Domain verification, Content Posting API audit (needs the posting UX reviewed; Direct Post uses `video.publish`, not requested today), Display API approval for the analytics scopes then `TIKTOK_ANALYTICS_SCOPE_ENABLED` and a reconnect, apply and use migration 0190 rotation on a real account |
| **X** | **No** | None recorded. No App-Review-style queue; posting sits behind a paid API tier | n/a | Confirm the posting tier and its cost (ADR-0061 open question 2, still open), provision `X_CLIENT_ID/SECRET`, live test. Analytics for X is not built and its scope and cost are an owner decision |
| **LinkedIn** | **No** | None recorded | Application for the posting product: not recorded (*unverified*) | Provision `LINKEDIN_CLIENT_ID/SECRET`, request the posting product, live test. Member post statistics need a different API product and are not built |
| **Facebook** | **No.** Contract tests with stubbed responses and a local database acceptance suite only. Staging shows "Setup required" (no Facebook or Meta app credentials set) | None | Not recorded (*unverified*) | A company developer-app administrator supplies `FACEBOOK_CLIENT_ID/SECRET` (or reuses `META_APP_ID/SECRET`) and adds testers; Meta App Review for `pages_manage_posts` and the other Page permissions; a real test Page. The owner does not want to use a personal Meta account for this |
| **Threads** | **No** (stubs only; "Setup required" on staging) | None | Not recorded (*unverified*) | `THREADS_CLIENT_ID/SECRET`, testers, review of `threads_content_publish`; `SOCIAL_MEDIA_PROXY_SECRET` for image transfer; live test across several cron ticks |
| **Pinterest** | **No** (stubs only; "Setup required" on staging) | None | Not recorded (*unverified*) | `PINTEREST_CLIENT_ID/SECRET`, Pinterest app access to `pins:write`; live test on an owned board |
| **Bluesky** | **No** (stubs only). Needs no developer app, so it is the one new network that is configured on staging | n/a (no app approval; user-supplied app password) | n/a | A tester's own staging sign-in and dedicated app password; live test. The owner's one-account slot is held by YouTube and was not changed |
| **Twitch** | **No** (stubs only; "Setup required" on staging) | None | Not recorded (*unverified*) | `TWITCH_CLIENT_ID/SECRET`; live check of latest-video statistics after an analytics sweep. Statistics are collected but the dashboard page does not yet list Twitch |
| **Google Business Profile** | **No** (stubs only; "Setup required" on staging) | None. A YouTube OAuth client does not establish Business Profile API access | Not recorded (*unverified*) | `GMB_CLIENT_ID/SECRET`, the Business Profile APIs enabled and access approved by Google, a real location; the target completes only when Google reports the post LIVE |

The six rows after LinkedIn were added on 2026-10-08. Their status is "built and tested with stubbed
provider responses, not live-tested, no provider approval", and nothing more; "Setup required" is the
connect button's state when the deployment lacks the provider's app secrets, and does not imply approval.

Configuration facts that bear on review: the provider scopes the code requests today are in technical
spec §2.4; the two optional scope families (Instagram insights, TikTok analytics) are off on both
staging and production; production keeps `PUBLISH_ENABLED` off until the reviews and the Publish Plan
land, and keeps `PUBLISH_EXTENDED_NETWORKS_ENABLED` off (on in staging since PR #638) (`wrangler.jsonc`). Whether the provider client secrets are set in **production** is *unverified*.

The earlier handover record "Google OAuth was configured in Testing for this acceptance. This verifies
the owner's test account, not a public rollout or long-term refresh-token longevity" still applies.

## 6.1 Sequencing — what can start now vs. what needs the composer built first

As of 2026-10-08 the composer, connect flow and publishing engine all exist, and the connect to
publish path has been proven end to end for YouTube on staging (§6.0). It has not been proven for the
other four networks, so their screencasts need a real connected account first. The split below still
holds:

| Can start immediately | Needs a working composer first |
|---|---|
| Register the business/developer accounts (Meta Business Manager, Google Cloud project, TikTok developer account) | Meta App Review's demo screencast (must show the real OAuth consent + publish flow) |
| Create each platform's app shell (name, icon, category, privacy policy/ToS URLs) | TikTok's Content Posting API audit (needs the actual posting UX to review) |
| Set up the Google Cloud OAuth consent screen in **Testing** mode (up to 100 test users, no verification needed yet) | Google's OAuth verification submission (needs a demo video of the real consent flow) |
| Draft and publish the required privacy policy / ToS pages | — |
| Domain verification (TikTok, Google Search Console) | — |

**Recommended order:** the left column should already be done wherever it is not recorded as done in
§6.0 (it was meant to run in parallel with engineering). The right column is now unblocked for YouTube
(record the Testing-mode flow and submit verification) and needs an owner-controlled account for
Instagram and TikTok (record the connect → publish path once on a real account, then submit).

## 6.2 Meta (Instagram + Facebook — Graph API)

### Prerequisites
- A **Meta Business Manager** account for the Veyrnox.ai business entity (not a personal Facebook
  account). Requires business name, address, phone verification.
- A published **Privacy Policy URL** and **Terms of Service URL** — Meta checks these are live and
  specific to data use, not a generic placeholder.
- At least one Instagram account converted to **Business or Creator** — Instagram's
  content-publishing API only works on Business/Creator accounts, never personal ones. This should
  be called out in Publish's own onboarding UX (a user with a personal IG account needs to convert
  it before connecting). No linked Facebook Page is required (see App setup below).

### App setup
1. Create an app in Meta for Developers, type "Business."
2. Add product: **Instagram API with Instagram Login** ("Business Login for Instagram") —
   `packages/adapters/social/instagram.js` implements this directly against
   `www.instagram.com/oauth/authorize`, not the older Facebook Login + Pages-resolution chain. It
   authorizes a Business/Creator Instagram account with no linked Facebook Page at all, so the
   **Facebook Login** product and its Pages permissions are not needed for v1.
3. Fill in Privacy Policy URL, ToS URL, App Icon, Category, and complete the **Data Use Checkup**.
4. Complete **Business Verification** (Meta's own KYB process — legal business documents, domain
   ownership proof). This gates access to advanced permissions and is a separate step from the app
   review below; start it early, it has its own multi-day turnaround.

### Scopes needed for v1 (Instagram only — Facebook is a separate adapter, see §6.8)
Matches `INSTAGRAM_SCOPES` in `packages/adapters/social/instagram.js` — Meta's newer scope names
for Instagram API with Instagram Login, not the older Facebook Login scopes:
- `instagram_business_basic` — read the connected account's identity (id, username, profile
  picture).
- `instagram_business_content_publish` — the actual publish permission; this is an **Advanced
  Access** permission requiring App Review.
- `instagram_business_manage_insights` — reach, views, saves and shares for the analytics page
  (`INSTAGRAM_INSIGHTS_SCOPE` in the adapter). Also needs App Review. The connect flow requests
  it only when `INSTAGRAM_INSIGHTS_SCOPE_ENABLED` is "true": add it to the submission, and turn
  the switch on once Meta approves it. Justification for the reviewer: the user opens
  Publish → Analytics and sees reach and views for their own account and posts.

### App Review submission
- For each Advanced Access permission: written justification of *why* Publish needs it, mapped to
  the actual feature (e.g. "`instagram_content_publish` is used when a user clicks Schedule in the
  composer to post their own content to their own connected Instagram account").
- A **screencast** showing a reviewer-testable path: connect an Instagram account via the real OAuth
  flow, compose a post, schedule/publish it, show it live on Instagram. This is why the composer
  needs to exist first (§6.1).
- Test accounts: add reviewers as App Testers so they can go through the flow themselves if the
  video isn't sufficient — Meta sometimes asks for this.

### Timeline and gotchas
- Business Verification: days to a couple of weeks.
- Permission review: often 3–7 business days per submission, but **first submissions bounce
  regularly** with specific, fixable feedback — budget 2–6 weeks end to end including at least one
  resubmission cycle, not just the quoted per-review window.
- Established scheduling tools (Metricool, Buffer, Hootsuite) are Meta Business Partners, a
  higher-trust tier with a separate application process — worth investigating once Publish has
  production traction, not a v1 blocker.
- Meta's Platform Policy generally permits scheduled/automated posting (this is the entire
  Metricool/Buffer category) — the risk area to watch is spam/authenticity policy, not scheduling
  itself; make sure the App Review justification frames Publish as "user posts their own content on
  their own schedule," not an automation/bot product.

## 6.3 TikTok (Content Posting API)

### Prerequisites
- A TikTok for Developers account (email/phone verified).
- Published Privacy Policy and ToS URLs.
- **Domain verification** — a TXT DNS record or file upload proving ownership of the callback
  domain.

### App setup
1. Create an app in the TikTok Developer Portal; select the **Content Posting API** product (distinct
   from Login Kit / Display API — make sure the right product is added, not just "Login Kit," which
   covers auth but not posting).
2. New apps start **unaudited** — this is TikTok's default, not a mistake to fix in setup. Unaudited
   apps can typically only post privately, to a small set of the developer's own test accounts, and
   sometimes with a forced watermark, exactly as flagged in ADR-0061.

### Scopes needed for v1
- `user.info.basic` — identify the connected account.
- `video.upload` — the current MEDIA_UPLOAD flow sends a draft to the creator's TikTok
  inbox for them to finish. `video.publish` belongs to a future audited Direct Post flow.
- `user.info.stats` — followers, following, total likes and public video count.
- `video.list` — list the creator's public videos with views, likes, comments and shares.

The two analytics scopes are requested only when `TIKTOK_ANALYTICS_SCOPE_ENABLED` is
"true" (ships "false"). Add **Display API** to the app and obtain approval for these
scopes before enabling that switch. Existing accounts must reconnect. Users may grant
only some scopes; the callback stores TikTok's actual `scope` response and the sweep
requests only the fields/endpoints covered by that grant. No grant means no analytics
network request. Apply `0190_tiktok_token_rotation.sql` before collecting TikTok analytics;
it persists both rotated tokens atomically without overwriting a newer connection.

Suggested review justification: "Veyrnox Publish lets creators view analytics for their
own connected TikTok account and public videos alongside their publishing schedule.
user.info.stats provides audience and account totals; video.list provides public video
views, likes, comments and shares. These figures appear only in the creator's signed-in
analytics dashboard."

References checked 2026-10-03: [Get User Info](https://developers.tiktok.com/doc/tiktok-api-v2-get-user-info),
[List Videos](https://developers.tiktok.com/doc/tiktok-api-v2-video-list),
[Video Object](https://developers.tiktok.com/doc/tiktok-api-v2-video-object), and
[User Access Token Management](https://developers.tiktok.com/doc/oauth-user-access-token-management).

### Audit submission ("Direct Post" / production access)
- Requires demonstrating the actual posting UX — TikTok has specific UX requirements around what the
  user sees before a post goes live (their guidelines describe an explicit confirmation step in some
  flows; verify current requirements before building the composer's final publish-confirmation UI,
  not after, since a UX mismatch is a common rejection reason).
- Same "needs the real thing built" dependency as Meta — sequence per §6.1.

### Timeline and gotchas
- Audit turnaround: commonly a few weeks; TikTok has also been known to periodically re-audit
  already-approved apps, so this isn't a one-time cost — budget for occasional re-verification.
- Rate limits and content-posting quotas apply per app; check current limits against Publish's
  expected v1 volume (small at launch, but confirm there's no per-minute cap that would break the
  publish-sweep's batching if many users' scheduled posts land in the same minute).

## 6.4 YouTube (Data API v3, via Google Cloud)

Status: connected and publishing on staging in **Testing** mode with the owner's test account; see §6.0.

### Prerequisites
- A Google Cloud project for Veyrnox.ai.
- Domain ownership verified in Google Search Console (needed for the OAuth consent screen's
  authorized domains).
- Published Privacy Policy meeting Google's specific content requirements (must clearly state what
  data is collected, how it's used, and how it's shared — a generic policy has been a rejection
  reason for other apps historically; write this one specifically with YouTube's checklist open).

### App setup
1. Enable **YouTube Data API v3** on the project.
2. Configure the **OAuth consent screen**: app name, logo, support email, the exact scopes to be
   requested, and authorized domains.
3. While in **Testing** publishing status, only explicitly added test users (by Google account
   email, up to 100) can authorize the app — this is enough to develop and internally QA the whole
   connect → publish flow before any external review is needed. Start here immediately (§6.1).

### Scopes needed for v1
- `youtube.upload` — requested today (`YOUTUBE_SCOPES` in `packages/adapters/social/youtube.js`) for
  resumable video upload. Google has changed scope granularity before; check the live scope list.
- `youtube.readonly` — requested today for channel identity and the analytics fetch (channel, uploads
  playlist, batched video statistics). No YouTube Analytics API scope is requested.
- Confirm whether a separate scope or API field is needed for `madeForKids` / `isAiGeneratedContent`
  metadata. The current upload sets the title, description and a fixed `public` privacy status only, so
  these fields are not set (*unverified* against YouTube's current requirements).

### Verification submission (to go from "Testing" to public production)
- YouTube's upload scope is a **sensitive** (not necessarily restricted) scope in Google's
  classification — this matters because *restricted* scopes can trigger a costly, lengthy annual
  third-party security assessment, while *sensitive* scopes go through a lighter branding + demo
  review. **Confirm the current classification before assuming the lighter path** — this is exactly
  the kind of thing that should be checked live, not carried forward from this doc unchecked.
- Requires: a demo video of the real OAuth consent screen and the scope's actual use, a written
  justification per scope, and the domain-verified privacy policy.

### Quota
- YouTube Data API's default daily quota (historically 10,000 units/day) is shared across **all**
  users of the app combined, not per-user. A video upload has historically cost roughly 1,600 units,
  meaning the default quota supports only a handful of uploads per day platform-wide until a
  **quota increase** is separately requested (its own form, its own justification, typically needs
  real usage data to support the ask) — plan to file this well before Publish's YouTube volume would
  hit the ceiling, not after users start seeing failures.

### Timeline and gotchas
- OAuth verification: commonly days to a few weeks if only the lighter "sensitive scope" path
  applies; materially longer if a security assessment is triggered — confirm which applies early,
  since it changes the whole planning timeline.

## 6.5 What only a human can do, and why

This runbook stops short of the actual account creation and submission steps, on purpose:

- **Business verification is identity verification.** Meta, Google and TikTok all confirm you're a
  real, authorized representative of Veyrnox.ai — phone numbers, business documents, domain proof.
  There's no version of this an agent should do on your behalf.
- **App Review demo videos need a person's judgment call** about what to show and how to frame the
  use case — this is product communication, not a mechanical step.
- **Submitting starts a clock and a relationship** with each platform's review team; resubmissions,
  appeals, and policy clarifications go better as continuous human ownership, not handed off
  mid-review.

What this doc *does* give you: the account/app setup can start today (left column of §6.1) without
waiting on engineering, and the scope lists above are enough to start the developer-console setup
immediately, so the review clock on Meta and TikTok specifically (the two that need a working demo)
starts as soon as the composer's connect flow exists — not weeks after, because setup was still
pending.

## 6.6 Appendix — X and LinkedIn (lighter paths, also v1 per ADR-0061)

Scopes requested today: X `tweet.read tweet.write users.read offline.access media.write` (OAuth 2.0 with
PKCE; confidential client, HTTP Basic at the token endpoint); LinkedIn `openid profile w_member_social`
(posting on the member's own profile, not a Page). Neither has been live-tested (§6.0).

Not asked for by name, included for completeness since both are in Publish's v1 platform list:

- **X (Twitter) API v2** — posting access sits behind a paid API tier; the specific tier and current
  pricing need confirming directly from X's developer portal (flagged as unverified in ADR-0061
  §"What each platform is expected to require of us") before this platform's cost is locked into any
  plan. No App-Review-style content demo is typically required for basic posting scopes, unlike
  Meta/TikTok/YouTube — mainly an account + billing setup, not a review queue.
- **LinkedIn API** — organization-page posting requires the connecting user to be an admin of that
  LinkedIn Page and the app to be approved for the relevant Marketing/Community Management API
  product. LinkedIn's review is generally lighter-weight than Meta's or TikTok's but still requires
  an application describing the use case — start this in the same "left column" batch as Google
  Cloud project setup (§6.1), since it doesn't need a working demo either.

## 6.7 Consolidated pre-submission checklist

- [ ] Privacy Policy published, meets each platform's specific content requirements (not one generic
      page assumed to satisfy all three — verify against each platform's checklist).
- [ ] Terms of Service published.
- [ ] Meta Business Manager created and Business Verification started.
- [ ] Meta app created, Instagram Graph API product added, scopes identified and confirmed live.
- [ ] TikTok developer account created, domain verified, Content Posting API product added.
- [ ] Google Cloud project created, YouTube Data API v3 enabled, OAuth consent screen in Testing mode
      with internal test users added.
- [ ] X developer account + billing tier confirmed and budgeted.
- [ ] LinkedIn developer app created, Marketing/Community Management API product requested.
- [x] Composer's connect → publish flow works end to end for YouTube (staging, 2026-10-07). [ ] Still
      to prove for Instagram and TikTok on an owner-controlled account (blocks Meta App Review and
      TikTok's audit specifically — see §6.1).
- [ ] Demo screencasts recorded for Meta, TikTok and YouTube, each framed around the specific
      justification for its scopes.
- [ ] Google's scope classification (sensitive vs. restricted) confirmed for `youtube.upload` before
      committing to a timeline.
- [ ] YouTube quota-increase request filed once real usage data exists to support it.
- [ ] For Facebook, Threads, Pinterest, Twitch and Business Profile: an administrator-owned developer app, testers added, callback URL registered, secrets set, and a real-account run recorded (§6.8).

## 6.8 Appendix — the six tester-stage networks (PR #637, 2026-10-08)

Built natively (not through a scheduling-tool API) for other people to test; production stays off and none
has a recorded provider approval. Callback URLs are `ORIGIN/social/connect/callback/{network}` with
`ORIGIN` the deployment's exact `PUBLIC_HOST` (for Business Profile the network key is `gmb`). Scopes the
code requests, from the adapters:

| Network | Worker secrets | Scopes / credential |
|---|---|---|
| Facebook | `FACEBOOK_CLIENT_ID`, `FACEBOOK_CLIENT_SECRET` (fallback `META_APP_ID/SECRET`) | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`; the Page token comes from the chosen Page |
| Threads | `THREADS_CLIENT_ID`, `THREADS_CLIENT_SECRET` | `threads_basic`, `threads_content_publish` |
| Pinterest | `PINTEREST_CLIENT_ID`, `PINTEREST_CLIENT_SECRET` | `user_accounts:read`, `boards:read`, `pins:read`, `pins:write` |
| Bluesky | none | dedicated app password; Bluesky-hosted accounts only |
| Twitch | `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | none (token client and user are validated) |
| Google Business Profile | `GMB_CLIENT_ID`, `GMB_CLIENT_SECRET` | `https://www.googleapis.com/auth/business.manage`, offline access, PKCE |

Administrator steps before inviting testers (from the handover): apply 0228 through the owner-approved
`apply-migrations` workflow; set the secrets as Worker secrets (separate staging apps where the provider
allows), never in issues or the repository; register the callback URLs; add testers to the provider app's
roles or test-user lists; then set `PUBLISH_EXTENDED_NETWORKS_ENABLED` and keep `PUBLISH_ENABLED` true.
Never enable an unapproved permission for a test invitation; Instagram insights and TikTok analytics keep
their own switches. Whether provider review, quotas and billing access (for example for Business Profile
or X reads) are obtainable is *unverified*. Tester evidence to record per network is listed in the
handover (environment, destination, post id, visibility, permalink, disconnect result, error code; never
tokens, app passwords or signed media URLs).
