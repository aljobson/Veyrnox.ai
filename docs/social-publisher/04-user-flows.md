# 4. User Flows — Veyrnox Publish

> **As of 2026-10-08 (repo `main` at `bee1ea4f`).** Each flow below says what is built. §4.6 (reviewer
> approval), §4.9 (SmartLink) and §4.10 (multi-brand) are **design only (not built)** and are kept as the
> plan. Items marked *unverified* could not be confirmed from the code or the acceptance records.
> Publish is closed in production (`PUBLISH_ENABLED` is `"false"`); every flow here runs on staging.
> The six networks added by PR #637 (Facebook, Threads, Pinterest, Bluesky, Twitch, Google Business
> Profile) also need `PUBLISH_EXTENDED_NETWORKS_ENABLED` (`"false"` in production, `"true"` on staging) and
> have not been run against real provider accounts.

Each flow lists the trigger, steps, system behavior, and edge cases. States referenced map to
`social_posts.status` (`draft`, `scheduled`, `published`, `failed`, `canceled`) and
`social_post_targets.publish_status` (`pending`, `publishing`, `submitted`, `delivered`, `published`,
`failed`) in the technical spec.

## 4.1 Connect a social account (first-run)

**Trigger:** User opens `/app/publish`, signed in.

1. The page lists the eleven networks (Instagram, LinkedIn, X, TikTok, YouTube, Facebook, Threads,
   Pinterest, Bluesky, Twitch, Google Business Profile) with their logos and, under "Connect an account",
   a button for each. The button reads "Connect", "Setup required" when the provider app is not
   configured on that deployment, or "Testing not enabled" when the extended-network switch is off. With no accounts the list reads "No accounts
   connected yet."
2. User clicks Connect. The client creates a PKCE verifier, keeps it in `sessionStorage`, calls
   `POST /api/v1/social/accounts/:network/connect` with the S256 challenge, and **navigates the whole
   page** to the provider's consent screen (not a popup).
3. User approves scopes on the provider's own screen; Veyrnox never sees a platform password.
4. The provider redirects to `/social/connect/callback/:network`. That page posts the code and state
   (and, for X, the verifier) to `POST /api/v1/social/accounts/:network/callback`, which verifies the
   signed state, exchanges the code, encrypts the tokens and stores them
   (`record_social_account_connection`, which also appends a `connect` or `reconnect` audit row).
5. The page shows "Connected {network}. Redirecting…" and returns to `/app/publish`, where the account
   appears in the account list with its name, network and status and can be chosen in the composer
   (Twitch is listed for statistics but is never offered as a destination).

**Variants (PR #637, tester-stage).**
- **Facebook, Pinterest, Business Profile.** After consent the callback page shows "Choose a Page /
  board / location to connect" with a select, even when only one eligible destination exists. The
  choices come from a ten-minute, single-use selection held encrypted on the server; the browser gets
  only labels and ids. Choosing connects that destination only (Facebook stores the Page's own token;
  Pinterest offers boards the user owns). An expired or reused selection shows "This selection has
  expired. Start connecting again."; no eligible destination shows "No eligible Page, board or business
  location was found…".
- **Bluesky.** No redirect. Connect opens a form for the handle and a dedicated app password (created in
  Bluesky Settings, never the main password). The password is cleared from the field on submit and not
  stored; only encrypted session tokens are. Accounts on a custom or self-hosted server are refused.
- **Threads and Twitch.** Ordinary consent and return; the profile or channel is the account.

**Edge cases:**
- Free users can connect **one** active account. The page disables the other Connect buttons and says
  "Your plan connects one account. Disconnect it to connect a different one"; the database enforces the
  same limit (`ACCOUNT_LIMIT`, 0169). Because the Publish Plan is not built, no user can raise it, so a
  multi-network post is only possible for accounts connected before 0169.
- Platform error or a failed exchange: the callback page shows a network-specific message and "Nothing
  was connected. Go back and try again." The provider's own error text is not surfaced.
- A personal Instagram account cannot complete Instagram Login for publishing (Business or Creator
  accounts only); it surfaces as an ordinary connect failure.
- Reconnecting an account that was previously disconnected re-activates the same `social_accounts`
  row (matched by `(brand_id, network, external_account_id)`).
- Disconnect asks for confirmation ("Scheduled posts to this account will stop going out"), revokes the
  account, clears both tokens and fails its open targets at once (0168).

## 4.2 Compose and schedule a post

**Trigger:** the "Create a post" section of `/app/publish`, or "Schedule this" from a generation (§4.3).

1. The composer lists the connected accounts with network logos; the user selects which this post
   targets.
2. User writes one caption (up to 4,000 characters). The same text goes to every selected account;
   there are no per-network overrides and no live per-network character counter, but submitting checks
   each selected network's limit (X 280, Bluesky 300 graphemes, Threads 500, Pinterest 800, Business
   Profile 1,500, Instagram and TikTok 2,200, LinkedIn 3,000, Facebook and YouTube 4,000).
3. User attaches **one** image or video, from their generations or, when uploads are on, **Upload from
   device** (progress and cancel, reusable list, previews, automatic selection once complete; an
   explicit rights confirmation is required; JPG/PNG/WebP up to 20 MiB, MP4 up to 100 MiB). Uploading
   alone never creates a post, spends credits or needs a connected account.
4. User picks a date and time (default one hour ahead, in the browser's timezone) and chooses one of two
   actions: **Post now** (the API assigns server time and queues it for the next sweep) or **Schedule
   post** (the chosen future time). The helper text says publishing can take a few minutes.
5. `POST /api/v1/social/posts` creates the post (`scheduled`) and one target per selected account
   (`pending`). The UI reports that the post was queued, not that it published. A retried submit reuses
   the same idempotency key, so it never double-schedules.
6. The post appears in the recent-posts list with a badge per target (network logo, status, and a "view"
   link once published) and on the calendar (§4.4).

**Edge cases:**
- No account selected, no media or an invalid time: the action fails with a message; a time more than
  five minutes in the past is rejected by the API.
- Writes are limited to 20 per user per minute (posts, drafts, uploads); a 429 carries a retry time.
- Since PR #637 the composer and the API stop a media type a selected network cannot take, before
  anything is queued: every network except YouTube takes one image only, YouTube takes one video only,
  and Twitch takes nothing. The message reads "… does not support this media type." (API codes
  `unsupported_media_type`, `publishing_not_supported`, `caption_too_long`, `network_unavailable`).
- There is no pre-check of token health. Instagram, X, LinkedIn and Facebook Page tokens are not
  refreshed (Pinterest, Business Profile, Twitch, Bluesky and Threads renew automatically before the
  sweep uses them) and no account moves to `expired` or `error`, so a dead token shows up as a failed
  target (§4.7).
- Google Business Profile and Threads posts stay "in progress" until the provider finishes processing
  (Business Profile completes only once Google reports the post LIVE).

## 4.3 Generate → Schedule handoff (Veyrnox differentiator)

**Trigger:** User finishes a generation (image/video) in Veyrnox's existing generation flow.

1. On a completed image or video result, a "Schedule this" action sits alongside the existing actions
   (Studio results, each batch tile and Library cards). It is hidden while Publish is off and for audio,
   failed jobs and unavailable assets.
2. It opens `/app/publish?job=<job UUID>#schedule`. The composer validates the UUID, retrieves the asset
   through the ownership-checked job asset API and selects it as the media (`source_job_id`).
3. From here the flow is identical to §4.2: the user chooses accounts, writes the caption and confirms
   the posting time. Nothing is created by opening the link. Invalid, inaccessible or unsupported linked
   assets show an error and let the user choose from the library.

Caption suggestions grounded in the generation prompt are **not built**.

## 4.4 Calendar and confirmed reschedule

**Trigger:** the "Scheduled & published" section links to `/app/publish/calendar` (only when
`PUBLISH_CALENDAR_ENABLED` is `"true"` and Publish is open).

1. Month, week and list views (month and list share the six-week Monday-first grid, week shows seven
   days) in the browser timezone, with status and network filters applied in the database, 100 posts per
   page and a Load more control. Drafts are excluded.
2. Dragging an unstarted post to another day opens a confirmation form showing the proposed time
   (preserving the local time of day and the UTC instant). **Nothing is saved until the user confirms.**
   The Reschedule button opens the same form for keyboard and touch users.
3. Confirming calls `PATCH /api/v1/social/posts/:id/schedule` with the original and the new time. All
   targets move together; success shows "Post rescheduled" and appends one `post_rescheduled` audit
   event.

**Edge cases:**
- Only a `scheduled` post whose targets are all untouched can move. Started, retried, submitted,
  partially published and terminal posts show "Schedule locked".
- A time less than a minute ahead or inside a daylight-saving gap is rejected; a repeated hour picks the
  earlier occurrence. A stale original time returns a conflict message and leaves the schedule
  unchanged; a busy row returns `POST_BUSY`.
- A replay of the same requested time is a no-op with no audit event.
- Dragging a draft or a published post is not offered; there is no `pending_review` state.

## 4.5 Best time to post and posting frequency

**Trigger:** the analytics page (`/app/publish/analytics`), when `PUBLISH_POSTING_INSIGHTS_ENABLED` is
`"true"`.

1. There is no cold-start heatmap of general trends. An account with fewer than ten measured posts over
   fourteen days shows an insufficient-evidence message instead of a recommendation.
2. With enough history, a 7 by 24 (168-cell) day-by-hour grid is computed weekly from the account's own
   stored posts (twelve complete weeks in the brand timezone) with up to three ranked slots, and a
   posting-frequency comparison by week. The panel is labelled and keyboard-scrollable.
3. These are descriptive, not predictive: lifetime counters favour older posts, and collection can omit
   older, private or deleted posts.
4. Clicking a cell to open a composer at that time, and a best-time chip inside the composer, are **not
   built**.

## 4.6 Approval workflow (Phase 2)

> **Design only (not built).** Single-owner draft review exists (below); the multi-reviewer approval
> workflow does not.

**Built, single-owner draft review (0182).** Once a week the owner's own brand accounts get a batch of
draft posts built from the previous seven days of their generations (captions are catalog data, never
written copy). The "Drafts to review" section of `/app/publish` lists each batch; **Approve** schedules
the whole batch (never earlier than the approval time; a draft whose account was disconnected meanwhile
becomes `failed`) and **Discard** cancels one draft or the rest of a batch. Nothing in a draft batch is
published before approval. Editing or rescheduling a draft is not supported (discard and regenerate).

**Design only: reviewer approval.**
**Trigger:** A creator without publish authority (or anyone who wants sign-off) clicks "Send for
review" instead of "Schedule" in the composer.

1. A dialog collects reviewer emails (comma-separated — internal Veyrnox teammates on the brand are
   detected automatically and marked "internal"; unrecognized emails are treated as external) and
   an approval policy: **Any** (one approval is enough), **All** (everyone must approve), or
   **Optional** (auto-approved unless someone actively rejects).
2. Submitting creates a `social_approval_requests` row (`status = pending`) and one
   `social_approval_reviewers` row per email; internal reviewers get an in-app notification + email
   (unless "notify" is turned off), external reviewers always get an email with a single-use signed
   link (no Veyrnox account required to review).
3. The post shows a `pending_review` status pill on the Planner calendar, visible to the whole brand
   team.
4. A reviewer opens the link (or the in-app approval queue) and sees a read-only preview identical
   to the composer's per-network preview, with **Approve** / **Reject** (+ optional comment).
5. On the policy's resolution condition being met (`any`: first approval; `all`: last approval;
   `optional`: no rejection recorded and every reviewer has responded, or a timeout policy TBD),
   the post's status flips to `scheduled` and proceeds through the normal publish sweep (§2.6).
   A single rejection at any point flips it to `rejected` and stops it from ever auto-publishing —
   this can't be un-rejected without the original creator editing and resubmitting.
6. The requester gets a notification of the final decision either way.

**Edge cases:**
- A reviewer's single-use link is reused after decision → shows "Already reviewed" with the recorded
  decision, not an error page.
- The scheduled time arrives while still `pending_review` → the publish sweep skips it (only
  `status = scheduled` posts are eligible) and the calendar shows an overdue indicator until a
  decision is made.

## 4.7 Publish failure and recovery

**Trigger:** the publish sweep attempts a target and the platform rejects it, or the account's token has
expired.

1. A failed attempt is retried automatically after 5, 10 then up to 60 minutes; the target is `failed`
   after the third attempt. Every error counts as an attempt. TikTok and YouTube continuations are not
   failures: a TikTok post stays `submitted` (shown "in progress") while its publish id is polled and a
   YouTube video stays `submitted` while it uploads and processes. A YouTube day-quota exhaustion waits
   for the next Pacific midnight without failing the post. Threads and Google Business Profile
   continuations behave the same way while the provider processes the image.
2. On a permanent or exhausted failure the target shows `failed` with the reason on hover, per network:
   a post to three networks where one failed shows the others as published. The post itself is
   `published` if any target succeeded and `failed` if none did.
3. There is **no failure notification** and **no Retry control**. To try again the user creates a new
   post. If the cause was an expired or revoked token the user must reconnect the account from
   `/app/publish`; nothing routes them there.
4. TikTok is not a failure but a different outcome: `delivered` ("finish in TikTok app") means the
   content reached the creator's TikTok inbox as a draft, not a public post.
5. Disconnecting an account fails its open targets immediately with `account_disconnected`.
6. **Uncertain result (Facebook, Threads, Pinterest, Bluesky, Business Profile).** A durable marker is
   written before the provider request. If the response was lost or the worker died mid-request, the
   target shows `provider_result_unknown_reconcile_before_retry` and is not sent again. Check the
   provider for the post first; only then create replacement content. There is no automatic
   reconciliation.

## 4.8 Analytics review

**Trigger:** User opens `/app/publish/analytics` (or follows "See your analytics").

1. The user selects a connected account (Instagram, YouTube or TikTok; every other network, including
   X, LinkedIn and Twitch, shows a message that analytics for that network are not available. Twitch
   video statistics are collected in the background but not yet displayed) and a range of 7, 30 or 90 days. There is no
   cross-network brand summary.
2. The page shows account cards (followers or subscribers, and the other totals the network provides),
   a followers chart over time, and a table of the account's recent posts or videos. Columns depend on
   the network: Instagram likes and comments, plus reach, views, saves and shares once the insights
   grant exists; YouTube views, likes and comments; TikTok views, likes, comments and Shares.
3. Counters are lifetime values. The range selects publication dates; it does not turn a lifetime
   counter into numbers earned inside the range. YouTube subscribers are rounded by YouTube.
4. Data refreshes about every six hours per account. A failed refresh is kept on the account's sync row
   and the last good numbers stay visible; the posting-insights panel fails independently of the rest.
5. There is no per-post detail panel, competitor overlay or export/report.

## 4.9 SmartLink (link-in-bio) setup (Phase 2) — design only (not built)

**Trigger:** User opens the SmartLinks section and creates their first link-in-bio page.

1. User picks a slug (`veyrnox.ai/s/<slug>` or a custom domain later), a title, and starts adding
   blocks: **Button** (label + destination URL) or **Image** (image + destination URL), each
   reorderable by drag.
2. Live preview renders the page as visitors will see it, styled per §3 of the design guide.
3. Publishing makes `GET /s/:slug` live immediately (no scheduling — this is a persistent page, not
   a timed post).
4. Analytics for the SmartLink (visits, per-block clicks, CTR) appear in the same Analytics tab
   under a "Link in bio" section, reusing the stat-tile pattern from §4.8.
5. The SmartLink URL becomes available as a one-click insert in the composer's caption field (the
   natural place a creator drops their "link in bio" reference when the actual link can't go in an
   Instagram/TikTok caption).

## 4.10 Multi-brand switching (agency persona) — design only (not built)

There is one default brand per user (`get_or_create_default_social_brand`), no brand switcher and no
collaborator model; every Publish action is owner-only.

**Trigger:** User with more than one `social_brands` row clicks the brand switcher in the top bar.

1. Dropdown lists all brands the user owns or is a collaborator on, each with a small avatar/label.
2. Selecting a brand re-scopes the entire Publish surface (Planner, Compose, Analytics, Accounts) to
   that brand's connected accounts and data — no full page reload, just a client-side re-fetch keyed
   on the new `brand_id`.
3. The composer's network chips, the calendar's posts, and the analytics tiles all reflect only the
   selected brand — cross-brand data leakage is prevented at the RLS layer (§2.2/2.7 of the
   technical spec), not just hidden in the UI.
