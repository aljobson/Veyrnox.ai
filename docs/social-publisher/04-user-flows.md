# 4. User Flows — Veyrnox Publish

Each flow lists the trigger, steps, system behavior, and edge cases. States referenced
(`draft`/`scheduled`/etc.) map to `social_posts.status` and `social_post_targets.publish_status`
in the technical spec.

## 4.1 Connect a social account (first-run)

**Trigger:** User opens Publish for the first time, or clicks "Connect" in the Accounts tab.

1. Empty state on the Planner tab: "Connect your first account to start scheduling," with network
   icons as quick-connect buttons (mirrors Metricool's own "trusted by 3.5M professionals" empty
   state energy, restyled to syntx palette).
2. User clicks a network icon → `POST /api/v1/social/accounts/:network/connect` → redirect to the
   platform's OAuth consent screen in a popup window (not a full-page redirect, so the user doesn't
   lose their place).
3. User approves scopes on the platform's own screen (Veyrnox never sees their platform password —
   this is a live third-party OAuth flow, not a credential form).
4. Platform redirects to `/api/v1/social/accounts/:network/callback` → token exchange → encrypted
   storage → `social_account_actions` logs `connect` → popup closes, posts a `postMessage` back to
   the opener.
5. Opener window shows a success toast ("Instagram connected — @handle") and the new account
   appears as a card in the Accounts tab and as a selectable chip in the Compose tab.

**Edge cases:**
- User closes the popup before approving → opener detects the closed popup (polling `window.closed`)
  and shows nothing (no false failure toast).
- Platform returns an error (denied scope, app-review-restricted feature) → toast surfaces the
  platform's own error text, never a generic "something went wrong."
- Reconnecting an account that was previously disconnected re-activates the same `social_accounts`
  row rather than creating a duplicate (matched by `(brand_id, network, external_account_id)`).

## 4.2 Compose and schedule a multi-network post

**Trigger:** "New post" button (Planner tab), or "Schedule this" from a Veyrnox generation result
(the differentiator flow, §4.3).

1. Composer opens with all connected, active accounts shown as chips; user toggles which networks
   this post targets (default: all connected).
2. User writes a global caption. Per-network character limits are shown live as a counter under the
   caption box (e.g. Bluesky's 300-char cap flagged in red before submit, matching the exact
   client-side check specified in §2.4 of the technical spec).
3. User attaches media: either from the Veyrnox asset library (searchable grid of past generations)
   or a direct upload. The composer validates media against each selected network's requirement
   (e.g. selecting Instagram Reel without a video disables "Schedule" and highlights the missing
   requirement inline).
4. User optionally opens a network's tab to override: post type (Post/Reel/Story), first comment,
   alt text, network-specific fields (Pinterest board, YouTube title/audience/privacy, TikTok
   privacy/duet/stitch toggles, LinkedIn poll options).
5. A best-time-to-post chip appears near the date/time picker once at least one network is selected
   (§4.5 for personalization details); clicking it fills in the suggested time.
6. User picks a date/time (or "Publish now") and clicks "Schedule." Client re-validates every
   selected network's requirements one last time; on success, `POST /api/v1/social/posts` creates
   the post (`status = scheduled`) and one `social_post_targets` row per selected network
   (`publish_status = pending`).
7. Composer closes; the new post appears on the Planner calendar at the scheduled time, with a
   composite badge showing all target networks.

**Edge cases:**
- Scheduling with zero networks selected → "Schedule" stays disabled, not a submit-time error.
- Scheduling in the past → rejected client-side with a clear message, matching the API's own "date
  can't be in the past" rule for approval-flow scheduling.
- A selected network's account token is `expired`/`error` → that network's chip shows a small
  warning badge and is excluded from "Schedule" until reconnected, rather than silently failing
  later at publish time.

## 4.3 Generate → Schedule handoff (Veyrnox differentiator)

**Trigger:** User finishes a generation (image/video) in Veyrnox's existing generation flow.

1. On the generation result screen, a new "Schedule this" action sits alongside existing actions
   (download, save to library).
2. Clicking it opens the Compose flow (§4.2 step 1 onward) with the generated asset pre-attached
   (`source_job_id` set) and, where the generation had a text prompt/scene description, a
   AI-drafted caption suggestion grounded in that prompt (editable, never auto-submitted).
3. From here the flow is identical to §4.2 — the only difference is media and an optional caption
   arrive pre-filled.

### Implemented slice (2026-10-03)

When `PUBLISH_ENABLED` is true, completed image/video results in Studio (including each
batch tile) and Library show "Schedule this". The link opens
`/app/publish?job=<job UUID>#schedule`. The composer validates the UUID and retrieves the
asset through the existing ownership-checked job asset API, then selects its image/video
type. The user still chooses accounts, writes the caption and confirms the posting time.
No post is created by opening the link. Caption suggestions remain future work.

Audio, failed jobs and unavailable assets do not show the shortcut. Invalid, inaccessible
or unsupported linked assets show an error and let the user choose from the library.
Production keeps this path hidden while Publish is off. No migration is required.

## 4.4 Calendar drag-to-reschedule

**Trigger:** User drags a scheduled post card to a different day/time slot on the Planner calendar.

1. Card lifts (see motion spec §3.6) and follows the cursor; valid drop targets (future date/time
   slots) highlight.
2. On drop, an optimistic UI update moves the card immediately; `PATCH /api/v1/social/posts/:id`
   fires in the background with the new `scheduled_at`.
3. On success, nothing further happens (the optimistic state was correct). On failure (e.g. the post
   was published by the cron sweep in the split second before the drag completed), the card snaps
   back to its original slot and a toast explains why ("This post already went out — can't
   reschedule a published post").

**Edge cases:**
- Dragging a post that's already `pending_review` shows a tooltip explaining it must be
  un-submitted from review before rescheduling, rather than allowing a silent conflicting edit.

## 4.5 Best time to post

**Trigger:** Automatic — surfaces in the composer (§4.2 step 5) and as a standalone "Best times"
view under Analytics.

1. **Cold start** (account connected under ~2 weeks, per §2.5 of the technical spec): shows a
   general best-practice heatmap per network with a small "Based on general trends — personalizing
   as you post more" note.
2. **Warm state:** heatmap is computed from the account's own `social_analytics_snapshots` history,
   refreshed weekly, rendered as a 7×24 grid (day × hour) with color intensity mapped to the score —
   this is the same shape Metricool's own API returns, so the visualization can be a direct 1:1
   translation of that data structure.
3. Hovering a cell shows the exact score and a plain-language label ("High engagement window").
4. Clicking a cell from the standalone Analytics view, not just the composer, pre-opens a new
   composer with that time filled in — a shortcut for "I want to post something in this good slot."

## 4.6 Approval workflow (Phase 2)

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

**Trigger:** The publish sweep (§2.6) attempts a scheduled post and the platform rejects it, or the
account's token has expired.

1. Transient failure (rate limit, 5xx) → automatic retry with backoff, invisible to the user unless
   all retries are exhausted.
2. Permanent failure → `social_post_targets.publish_status = failed`, `last_error` set to a
   human-readable reason, and the creator gets a notification ("Your Instagram post didn't go out:
   [reason]"). The Planner card shows a `failed` (danger) pill for that network specifically — a
   post targeting 3 networks where only 1 failed shows partial success, not a blanket failure.
3. If the cause was an expired/revoked token, the notification's call-to-action routes straight to
   the Accounts tab's reconnect flow (§4.1) for that specific network.
4. From the failed card, "Retry" re-queues just the failed target (not the whole multi-network post)
   for the next sweep, after the underlying issue (e.g. reconnect) is resolved.

## 4.8 Analytics review

**Trigger:** User opens the Analytics tab.

1. Default view: brand-level summary across all connected networks for the last 30 days — follower
   count, total reach, total engagement, posts published, each as a stat tile with a sparkline and
   delta vs. the prior period (directly modeled on Metricool's "Brand Summary" cross-network feed,
   §2.5 of the technical spec).
2. User can filter to a single network for the deeper per-network view: evolution line chart, a
   sortable table of recent posts with per-post reach/likes/comments/saves/shares, and (once
   competitor tracking ships in Phase 2) a benchmark overlay line.
3. Clicking a post row opens a detail panel with that post's full metric breakdown and a link to
   view it live on the platform.
4. "Export" produces a shareable report (Phase 2 — Reports feature) rather than a raw CSV dump, to
   match Metricool's own emphasis on presentable client-facing reports for the agency persona.

## 4.9 SmartLink (link-in-bio) setup (Phase 2)

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

## 4.10 Multi-brand switching (agency persona)

**Trigger:** User with more than one `social_brands` row clicks the brand switcher in the top bar.

1. Dropdown lists all brands the user owns or is a collaborator on, each with a small avatar/label.
2. Selecting a brand re-scopes the entire Publish surface (Planner, Compose, Analytics, Accounts) to
   that brand's connected accounts and data — no full page reload, just a client-side re-fetch keyed
   on the new `brand_id`.
3. The composer's network chips, the calendar's posts, and the analytics tiles all reflect only the
   selected brand — cross-brand data leakage is prevented at the RLS layer (§2.2/2.7 of the
   technical spec), not just hidden in the UI.
