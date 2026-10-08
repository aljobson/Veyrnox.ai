# 1. Product Specification — Veyrnox Publish

> **As of 2026-10-08 (repo `main` at `42150476`).** §1.1 to §1.6 are the original product vision and
> Metricool reference and are unchanged. §1.7 (MVP scope), §1.8 (entitlements) and the new §1.10
> (built state) have been reconciled with the code. Items marked *unverified* could not be confirmed
> from the repo or the acceptance records.

## 1.1 Vision

Veyrnox.ai already lets a creator generate images, video and voice. Veyrnox Publish closes the
loop: connect every social account once, then draft, customize per network, schedule, get
approval, and publish — from the same tab the media was generated in. The wedge against Metricool
is that Veyrnox is the only tool in this category that also **makes** the content: a generated
video can go from "Generate" to "Schedule to Instagram, TikTok and YouTube" in one flow, with no
download/re-upload round trip.

**One-line pitch:** *Generate it here. Schedule it everywhere.*

## 1.2 Why Metricool is the right model to copy

Metricool is the most complete "one dashboard, every network" tool in the category (vs. Buffer's
narrower scheduling focus or Hootsuite's heavier enterprise/team focus). Its own marketing
positioning — "Everything you need in one dashboard," "A management tool as human as you are" —
matches what Veyrnox wants for creators who currently juggle native composer tools per platform.
Its product surface, confirmed via its own public site and its live API (see README §Research
method), breaks into:

| Metricool product area | What it does |
|---|---|
| Metricool Studio | The unified planner + composer + analytics + inbox shell |
| Planner | Calendar of scheduled/published/draft content across all networks |
| Analytics | Per-network performance dashboards, evolution over time, demographics |
| Reports | Exportable/shareable performance reports |
| Looker Studio connector | Pipes Metricool data into Google's BI tool |
| Hashtag Tracker | Tracks hashtag performance over time |
| Approval System | Multi-reviewer sign-off before a post goes live |
| SmartLinks | Link-in-bio microsite with clickable buttons/images and click analytics |
| AI Assistant | Generates captions/post copy |
| Inbox | Unified comments/DM inbox across networks |
| Flows | Automation rules (e.g. auto-post from RSS, recycle evergreen content) |
| Competitors | Tracks competitor accounts' public metrics for benchmarking |
| Ads | Cross-network paid campaign dashboard (Meta Ads, Google Ads, TikTok Ads) |
| Integrations | Google Drive/Dropbox media import, Canva, Zapier, etc. |

Veyrnox Publish should build toward this full surface, phased (§1.7). The AI Assistant and
Integrations rows are the two areas where Veyrnox already wins by default: Veyrnox's own
generation tools **are** a superset of "AI Assistant," and Veyrnox's own asset library replaces
"import media from Drive."

## 1.3 Supported networks (from Metricool's own connector list)

Instagram, Facebook, X (Twitter), LinkedIn, TikTok, YouTube, Pinterest, Threads, Bluesky, Twitch,
Google Business Profile. Per-network publishing rules (what content each one requires) are
specified precisely in [02-technical-spec.md §2.4](02-technical-spec.md#24-per-network-publishing-rules) —
these are not guesses; they come from Metricool's own live API validation rules.

## 1.4 Primary personas

### Solo creator (primary MVP persona)
- Generates images/video/voice in Veyrnox already.
- Wants to post the same asset, adapted per network, without leaving the app.
- Manages one brand/account set.
- Cares about: fast composer, best-time-to-post suggestions, not having to remember platform quirks
  (aspect ratio, caption length, hashtag placement).

### Agency / multi-brand operator
- Manages multiple brands (Metricool calls these "blogs"; each has its own connected accounts).
- Switches between brands from a single login.
- Needs approval workflows: a junior creator drafts, a client or manager approves before it's live.
- Cares about: brand switcher, reporting per client, role-based access.

### Reviewer / approver (not a full seat)
- Gets an email with a preview of a pending post.
- Approves or rejects with a comment. May be external (a client with no Veyrnox account).

## 1.5 Feature list (mapped 1:1 from Metricool, in priority order)

### Core (must ship for v1 to be credible)
1. **Connect accounts** — OAuth per network; disconnect/reconnect; token-expiry handling.
2. **Composer** — one global caption + per-network overrides (text length, hashtags, first comment,
   mentions/tags, link), attach media (from Veyrnox's own generated-asset library **or** upload),
   per-network post-type selection (Instagram Post/Reel/Story/Trial Reel, Facebook Post/Reel/Story,
   YouTube video/short, TikTok video/photo, LinkedIn post/poll, Pinterest pin, GMB
   publication/photo).
3. **Calendar / Planner** — month, week and list views; drag-and-drop reschedule; color-coded by
   network; draft/scheduled/pending-review/published/failed states.
4. **Scheduling engine** — publish automatically at the scheduled time, or (matching Metricool's
   `autoPublish: false` mode) push a mobile notification for manual completion when a network
   requires it.
5. **Best time to post** — a per-network, per-day/hour heatmap suggesting when to schedule, derived
   from the account's own historical engagement.
6. **Basic analytics** — per-network evolution (followers, reach, engagement over time), per-post
   performance (likes, comments, shares, saves, views), exportable summary.

### Phase 2
7. **Approval workflow** — send a draft for review to internal (Veyrnox teammate) or external
   (client email) reviewers; `any`/`all`/`optional` approval policy; a single rejection blocks
   publication; reviewers act from an emailed link, no login required for external reviewers.
8. **Cross-network "Brand Summary"** — one unified feed of everything published anywhere, for a
   single brand, with normalized impressions/interactions/engagement columns.
9. **Competitor tracking** — add a competitor's public profile; track their followers, posts,
   engagement over time as a benchmark line on your own analytics.
10. **SmartLink (link-in-bio)** — a hosted microsite with a stack of clickable image/button blocks,
    each independently trackable (clicks, CTR); this is the one Instagram/TikTok "link in bio" slot
    driving traffic anywhere.
11. **Hashtag tracker** — save a hashtag, track its post volume/engagement over time.

### Phase 3 (parity, lower urgency)
12. **Unified inbox** — comments and DMs across connected networks in one place.
13. **Flows (automation rules)** — e.g. auto-post new Veyrnox generations tagged "auto-publish" on a
    schedule, or recycle evergreen posts.
14. **Ads dashboard** — read-only rollup of Meta/Google/TikTok ad spend and performance (requires ads
    API scopes on top of organic posting scopes — bigger OAuth review lift).
15. **Reports** — scheduled/exportable PDF or shareable-link reports per brand.
16. **Looker Studio-equivalent data connector** — expose Veyrnox Publish analytics via a documented
    read API so power users can pull it into their own BI tool.

### Veyrnox-specific differentiator (not in Metricool)
17. **Generate → Schedule handoff** — from any Veyrnox generation result, a "Schedule this" action
    opens the composer pre-filled with that asset, skipping upload entirely. This is the single
    biggest wedge over Metricool, which has no generation capability of its own.
18. **AI caption assist using the same generation context** — because Veyrnox already has the
    prompt/scene description used to generate the asset, caption suggestions can be grounded in
    that context rather than a generic "write me a caption" call.

## 1.6 What "copy every feature" means in practice, and what it doesn't

The user's ask was to copy every Metricool feature. In practice:

- **Copy the *behavior contract***: what a post needs per network, what approval flow looks like,
  what analytics exist, how a link-in-bio page tracks clicks. All of this is precisely specified in
  §1.5 and the technical spec, sourced from Metricool's own live API rules — not paraphrased from
  memory.
- **Do not copy Metricool's brand, wordmark, or exact pixel-for-pixel screens.** The design system
  is syntx.ai's, per the user's explicit request (see [03-design-style-guide.md](03-design-style-guide.md)).
  Reproducing Metricool's own visual identity (their "metricool" wordmark, their candy-colored
  brand palette) would be copying a competitor's trade dress, not "the feature" — the spec below
  treats Metricool strictly as a functional reference and syntx.ai as the aesthetic reference.
- **Do not copy Metricool's exact pricing numbers.** The pricing page requires login to see current
  tiers in full and was not reachable; inventing numbers here would misrepresent a competitor's
  actual pricing. §1.8 proposes an entitlement *shape* (gate by connected-profile count, matching
  Metricool's own gating axis) without asserting specific competitor price points.

## 1.7 MVP scope

**v1 scope as approved (ADR-0061):**
- Networks: Instagram, X (Twitter), TikTok, LinkedIn, YouTube — the five a solo creator is most
  likely to already use, and the five with the most mainstream OAuth app-review paths.
- Composer using the Veyrnox asset library as the primary media source; device upload was added later
  (§1.10).
- Calendar (month/week/list) with confirmed reschedule.
- Scheduling engine (auto-publish only; manual/mobile-push mode deferred).
- Best time to post, reworked from the first plan: **no generic static windows are shown.** Timing is
  computed only from the account's own stored posts and stays empty until there is enough history
  (ten measured posts over fourteen days, three in a slot — technical spec §2.5).
- Basic per-network analytics (evolution + per-post).

**Deferred to Phase 2/3:** everything in §1.5's Phase 2/3 lists, plus Facebook, Pinterest, Threads,
Bluesky, Twitch, Google Business Profile as additional networks once the adapter pattern (§2.3 of
the technical spec) is proven on the first five.

**Not in the v1 build, although §1.5 lists it as core:** per-network caption overrides, per-network
post types (Reel, Story, Short, poll, pin), first comment, alt text, privacy and audience fields, and
multi-image carousels. The composer sends one caption and one image or video to every selected
account. See §1.10.

## 1.8 Entitlement / plan model

**Accepted as [ADR-0062](../adr/0062-veyrnox-publish-entitlement-model.md)**: an independent "Publish Plan," modelled on the already-Accepted
Cinema Pass pattern (ADR-0057) — a recurring entitlement sold via Stripe Checkout subscription
mode, never touching the generation-credit ledger, with entitlement derived server-side by RPC.
This section keeps the original reasoning for context; ADR-0062 is the source of truth on the
billing *mechanism*, and [ADR-0063](../adr/0063-veyrnox-publish-plan-pricing.md) (**Accepted**)
has the actual numbers: Free (1 account, unlimited posts fair-use bounded) and Publish Plan
($19/mo, 5 accounts, $4/account add-on beyond that), grounded in live Metricool and Buffer pricing.

**Built state (2026-10-08): the Publish Plan is not built.** There is no plan table, checkout or
entitlement RPC; `social_publish_plans` exists only in the ADRs. What is enforced today is the Free
limit alone: `record_social_account_connection` refuses a second active account with `ACCOUNT_LIMIT`
(migration 0169, a constant of 1 for every user; a revoked account does not count, and accounts
connected before 0169 are left alone). Posts are not otherwise metered or gated by plan, and neither
are analytics (a plan-gating decision for analytics is still open). `wrangler.jsonc` notes that
Publish stays dark in production until the platform app reviews and the Publish Plan land.

Metricool's own gating axis is the number of connected profiles ("blogs") and network breadth, not
post volume — the shape ADR-0062 follows:

- Publish is an **independent recurring plan**, not a benefit of the glossary's planned
  `Subscription` (a monthly credit allotment, not yet offered — waiting for it would block Publish's
  launch on an unrelated, unbuilt system) and **not** a draw on the generation-credit ledger: posting
  to a social network doesn't consume a provider API cost proportional to a video/image generation,
  so metering it as credits would conflate two unrelated cost models — exactly the reasoning
  ADR-0057 already established for Cinema Pass, and reapplied here.
- Gate by: number of connected accounts, number of scheduled posts in flight, and access to
  Phase 2+ features (approval workflow, competitor tracking, SmartLinks) — mirroring Metricool's
  own axis of "more profiles / more networks / more power features" per tier, without asserting
  Metricool's specific numbers.

## 1.9 Success metrics

- % of users who generate an asset and schedule/publish it within the same session.
- Time from "generate" to "scheduled" (target: under 60 seconds for a single-network post).
- Number of connected accounts per active user (proxy for "replaced their other scheduling tool").
- Scheduled-post failure rate (token expiry, network API rejection) — should trend toward zero as
  adapters mature.
- Retention lift for users who connect at least one social account vs. those who don't.

## 1.10 Built state (2026-10-08)

Sources: ADR-0061 and its amendments, migrations 0154 to 0223, `wrangler.jsonc`, the code under
`app/api/v1/social/`, `app/veyrnox/app/publish/`, `lib/` and `packages/adapters/social/`, and the
acceptance records in this folder.

| Capability | State |
|---|---|
| Connect accounts (OAuth) for Instagram, X, LinkedIn, TikTok, YouTube; disconnect | Built. Full-page redirect (not a popup). Disconnect stops publishing and clears tokens (0168). Free cap of one account (0169). |
| Composer: pick accounts, one caption (4,000 characters max), one image or video, date and time | Built. Two actions: **Post now** (server time, queued for the next sweep) and **Schedule post**. Media comes from the user's generations or device uploads. |
| "Schedule this" from a generation | Built (Studio results, batch tiles, Library). Opens `/app/publish?job=<id>`; creates nothing until the user confirms. Caption suggestions are not built. |
| Device uploads | Built (0223, `PUBLISH_UPLOADS_ENABLED`): JPG, PNG, WebP up to 20 MiB, MP4 up to 100 MiB; ten files and 200 MiB per account. |
| Publishing engine | Built: five-minute cron sweep, claim and complete with a claim key, bounded retries. |
| Draft posts and batch approval | Built (0182): weekly brand drafts for the owner's own accounts, reviewed and approved or discarded on `/app/publish`. This is a single-owner review step, not the multi-reviewer approval workflow in §1.5 item 7. |
| Calendar (month, week, list) with confirmed reschedule | Built (0192, `PUBLISH_CALENDAR_ENABLED`). Drag opens a confirmation form; a Reschedule button gives a keyboard and touch path. |
| Analytics dashboard | Built for Instagram, YouTube and TikTok (0188, 0190). X and LinkedIn analytics are not built. |
| Best time to post and posting frequency | Built as a weekly cached aggregate (0191) shown on the analytics page. It is not offered inside the composer. |
| Approval workflow with reviewers, competitors, SmartLinks, hashtag tracker, inbox, flows, ads, reports | Not built. |
| Publish Plan | Not built (§1.8). |
| Facebook, Pinterest, Threads, Bluesky, Twitch, Google Business Profile | Not on `main`. The database CHECK lists already name them. A branch (`codex/social-integrations-all`, commit `0ef3bb80`, "native connections for all eleven social platforms") exists but is not merged; it is not described in this pack. |

**What each live network actually publishes** (from the adapters and `lib/socialPublishSweep.js`):

| Network | Result |
|---|---|
| Instagram | One image post, with caption. A video selection fails that target (`UNSUPPORTED_MEDIA_TYPE`). |
| LinkedIn | One image post on the member's own profile. Video fails the target. |
| X | One image tweet (single upload, 5 MB limit). Video fails the target. |
| TikTok | One photo post sent as **MEDIA_UPLOAD**: it lands as a draft in the creator's TikTok inbox to finish there, and the target shows "delivered", not "published". Direct posting waits for TikTok's audit. There is no video path in code. |
| YouTube | One video, uploaded in resumable chunks across sweep ticks, always **public**. The title is the caption text. The Pacific-day upload quota is enforced (0181). |

The composer does not stop a user choosing a media type a selected network cannot take; the target
fails at publish time with the reason in `last_error`.

**Live versus flagged.** Production: `PUBLISH_ENABLED` is `"false"`, which hides `/app/publish`, the
menu link and every `/api/v1/social/*` route; analytics, posting insights and uploads are `"false"`;
`PUBLISH_CALENDAR_ENABLED` is `"true"` but has no effect while Publish is closed. The cron sweep itself
is not gated, so anything already queued still finishes. Staging (`yrqzwqywxfesmbvhzjgj`): Publish,
analytics, posting insights, calendar and uploads are all `"true"`; the Instagram insights and TikTok
analytics consent switches are `"false"` on both environments pending provider review.

**Verified live on staging** (acceptance records, not fixtures): a real YouTube channel connected, a
real owner-approved video published on 2026-10-07 (queued 20:30 UTC, public 20:40 UTC), real channel and
video analytics fetched, YouTube token refresh exercised, calendar views, confirmed drag reschedule,
daylight-saving cases, pagination and lock contention, device uploads to R2, and Apple and passkey
sign-in. **Not verified live:** any Instagram, X, LinkedIn or TikTok publication or analytics fetch, and
production activation of any of it.

**Outstanding.** The Publish Plan; provider reviews (06 §6.0); an owner-controlled Instagram Business or
Creator account for publishing and analytics acceptance; X and LinkedIn analytics scope and cost
decisions; caption suggestions; per-network options in the composer; production approval and apply of
0223 (*unverified* whether applied) and the production switch flip.
