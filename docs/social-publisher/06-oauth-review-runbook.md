# 6. OAuth App Review Runbook — Meta, TikTok, YouTube

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

## 6.1 Sequencing — what can start now vs. what needs the composer built first

Per ADR-0061, no code exists yet. That doesn't block everything here — split the work:

| Can start immediately | Needs a working composer first |
|---|---|
| Register the business/developer accounts (Meta Business Manager, Google Cloud project, TikTok developer account) | Meta App Review's demo screencast (must show the real OAuth consent + publish flow) |
| Create each platform's app shell (name, icon, category, privacy policy/ToS URLs) | TikTok's Content Posting API audit (needs the actual posting UX to review) |
| Set up the Google Cloud OAuth consent screen in **Testing** mode (up to 100 test users, no verification needed yet) | Google's OAuth verification submission (needs a demo video of the real consent flow) |
| Draft and publish the required privacy policy / ToS pages | — |
| Domain verification (TikTok, Google Search Console) | — |

**Recommended order:** do the left column now, in parallel with engineering. Queue the right column
to start the moment the composer's OAuth connect flow (technical spec §2.7) is functional enough to
screen-record — don't wait for the full feature to be feature-complete, just for the connect →
publish path to work once, end to end, for the demo.

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

### Scopes needed for v1 (Instagram only — Facebook is Phase 2)
Matches `INSTAGRAM_SCOPES` in `packages/adapters/social/instagram.js` — Meta's newer scope names
for Instagram API with Instagram Login, not the older Facebook Login scopes:
- `instagram_business_basic` — read the connected account's identity (id, username, profile
  picture).
- `instagram_business_content_publish` — the actual publish permission; this is an **Advanced
  Access** permission requiring App Review.

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
- `user.info.basic` — read the connected account.
- `video.publish` — the Content Posting API's publish scope. **Confirm live** whether photo-post
  publishing (TikTok's photo mode, referenced in the technical spec's per-network rules) needs the
  same scope or a separate one — this repo's own technical spec (§2.4) already notes TikTok's
  `isAigc` AI-disclosure flag applies to video only, so photo and video may have diverging API
  surfaces worth checking before the audit submission, not after.

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
- `youtube.upload` (or the narrower current equivalent — Google has changed scope granularity
  before; check the live scope list) for publishing video/Shorts.
- Confirm whether a separate scope is needed for setting `madeForKids` / `isAiGeneratedContent`
  metadata (technical spec §2.4's required fields) or whether `youtube.upload` covers it.

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
- [ ] Composer's connect → publish flow works end to end (blocks Meta App Review and TikTok's audit
      specifically — see §6.1).
- [ ] Demo screencasts recorded for Meta, TikTok and YouTube, each framed around the specific
      justification for its scopes.
- [ ] Google's scope classification (sensitive vs. restricted) confirmed for `youtube.upload` before
      committing to a timeline.
- [ ] YouTube quota-increase request filed once real usage data exists to support it.
