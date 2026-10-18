# Veyrnox.ai Publish — marketing copy draft

**Status:** draft for owner review, 2026-10-18. Not wired into any page.
**Structure borrowed from:** the Content360 sales page (get.content360.io). Structure and ideas only; every line below is our own wording, and every claim is checked against the built state in [README.md](README.md) (flags as of 2026-10-16).

## Claim check before anything ships

| Content360 says | We can say? | Why |
|---|---|---|
| Unlimited accounts, lifetime price | **No** | Free is one account + Post now. Publish Plan ($15/month) is five accounts. |
| AI writes your captions | **No** | "AI caption suggestions" are listed as not built in 01-product-spec. |
| DM sequences, auto-reply on Instagram/Facebook | **No** | Instagram/Facebook are not in `PUBLISH_RELEASED_NETWORKS` (`youtube,linkedin,twitter,tiktok`). Inbox workflows exist; do not promise Meta automation. |
| Posts to every platform | **Careful** | Only YouTube, LinkedIn, X and TikTok are released in production. Name them. |
| 14-day money-back guarantee | **Not ours** | No such policy exists. Owner decision; do not invent one. |
| "20,000+ creators" social proof | **No** | Do not claim numbers we do not have. |
| Competitor price stack ($197/month) | **Only after checking** | Re-verify each competitor price on the day of publishing and cite the date. Placeholder table below. |

Hard wall: no wallet, on-chain or payout language anywhere on this page.

## What actually differentiates us

Content360 starts at "load your content". We start one step earlier: the content is made here. **Generate it, schedule it, publish it, without leaving the tab.** The Publish composer reads straight from the user's Veyrnox.ai library of generated images and videos.

---

## Page copy

### Hero

**Make it here. Schedule it everywhere.**
Generate the video or image, write the caption, pick the days, and Publish posts it to your accounts. One tab, one login, no exporting and re-uploading.

[Start free] — one account and Post now are free. No card.

### Load it once. Let it run.

Pick a finished asset from your Veyrnox.ai library, or upload your own. Choose the accounts. Choose the day and time. Add the caption for each network if it should differ.

Then close the laptop. Publish sends it at the time you set, and tells you if a network refuses it.

Ten minutes on a Monday instead of a little every day.

### Monday, 9:00 AM

- 9:00 — Short goes to YouTube
- 9:01 — Clip goes to TikTok
- 9:02 — Post goes to X
- 9:02 — Update goes to LinkedIn

You were still on your first coffee.

*(Use only the four released networks until more are switched on. Update this list when `PUBLISH_RELEASED_NETWORKS` changes.)*

### Everything around the posting

Posting is the start. The rest of the workflow is in the same place.

- **Calendar you can drag.** Month, week and list views. Move a post and confirm; a Reschedule button gives a keyboard and touch path.
- **Draft review.** Approve or discard drafts before they go out.
- **Approval links.** Send a post to a reviewer or client with a link. They approve it without an account.
- **Queues and saved presets.** Save captions and destinations you reuse. Add posts to a queue and they take the next slot.
- **RSS autolists.** Point Publish at a feed and new items are scheduled for you.
- **One inbox.** Comments and messages from your connected accounts in one list, with reply suggestions, labels, assignment and workflows.
- **Analytics.** Followers, growth and your best posts. The Publish Plan keeps 366 days of history and shows best times to post.
- **SmartLink.** A link-in-bio page with click counts.
- **Brands, teams and clients.** Separate brands, roles for teammates, and approval flows for clients.
- **Reports and API.** Scheduled and exported reports; a customer API and webhooks for your own tools.

### Not another scheduler

The aim was never a social scheduler on its own. It was to remove the gap between making something and getting it seen. The generation, the schedule, the approval and the numbers sit under one login.

### Picture your Monday

You sit down and load the week. You pick the days and the times. You close the laptop.

Tuesday you are in a meeting. Wednesday you are at the gym. Friday you clocked off an hour ago. The posts go out anyway.

When something needs you, a failed post or a comment worth answering, it is waiting in your inbox, not lost in four apps.

### Pricing (the honest version)

| | Free | Publish Plan |
|---|---|---|
| Price | $0 | $15/month |
| Connected accounts | 1 | 5 |
| Post now | Yes | Yes |
| Scheduling | No | Yes |
| Analytics | Basic | 366 days of history + best-time recommendations |

The Publish Plan is a separate subscription. It never touches your generation credits, and your credits never pay for it.

*(Weekly $4.99 and yearly $126 options exist in migrations 0340/0341 but the README marks the interval migrations as pending deployment. Do not list them until they are live. Confirm the Free column against the live plan page before publishing — the ADR-0062 amendment of 10 October described five free accounts, while the README built-state line says Free keeps one.)*

### What you would otherwise rent

Placeholder. Fill with checked, dated prices.

| Job | Typical tool | Price (verified on ____) |
|---|---|---|
| Scheduling | |  |
| Unified inbox | |  |
| Analytics | |  |
| Link-in-bio | |  |
| AI image and video generation | |  |

### Three honest answers to "why this price?"

1. **Scheduling should not be the expensive part.** The generation is what costs us money, and that stays on credits. The scheduling is software; we price it like software.
2. **We would rather you stay than lock you in.** It is a monthly plan you can cancel. *(Confirm cancel flow wording against Stripe Billing Portal behaviour before publishing.)*
3. **We build from what users ask for.** Publish is new. Tell us what is missing.

### No learning curve

Connect an account (about two minutes). After that it is: pick the asset, pick the accounts, pick the time.

*(Do not claim "24/7 live chat with real humans". We do not have that.)*

### FAQ

- **Is the Publish Plan separate from credits?** Yes. Credits pay for generation. The Plan pays for scheduling, extra accounts and analytics history.
- **Which networks work today?** YouTube, LinkedIn, X and TikTok. Others are built and being switched on as each platform's review finishes.
- **How many accounts?** One on Free, five on the Publish Plan.
- **Can I use it for client work?** Yes: separate brands, team roles and approval links.
- **Does it post automatically?** Yes, at the time you schedule. If a network rejects a post you are told, and nothing is retried silently.
- **What if a post fails?** It shows as failed with the reason, and you can reschedule it.

---

## Open decisions for the owner

1. Where does this live: a new public `/publish` page, a section on `/pricing`, or the landing page? (No public Publish page exists today.)
2. Free tier: one account (README) or five (ADR-0062 amendment 10 Oct)? The copy above follows the README.
3. Do we want a refund or trial promise? Content360's 14-day guarantee is the strongest part of their page, but we have no such policy.
4. Competitor price table: who fills and dates it?
