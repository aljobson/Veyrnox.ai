# Buzzy pricing and competitor comparison — 21 October 2026

Sources: buzzy.now/pricing read live in the Browser pane (page is client-rendered; plain fetch returns
only the heading), `veyrnox.ai/api/credit-packs` and `/api/catalog` (live), earlier notes in this folder
(`syntx-competitor-analysis-2026-09-26.md`, `higgsfield-2026-09-24.json`), and a web search for
Krea, Freepik and Pika. Higgsfield's live page could not be read this session (JS-rendered), so its
numbers are the 2026-09-24 snapshot plus a search snippet that agrees on Starter and Plus.

## Buzzy (buzzy.now)

Creati Gen AI Inc., launched 2026-04-30 as an "AI Video Photoshop" chat editor. Press reports a $20M
round led by Redpoint (company press release, not independently confirmed). A 36Kr piece names a
different company ("Perceptual Leap"), so ownership is unclear. No independent user reviews found.

Prices as shown 2026-10-21, USD. Struck-through "list" price is permanently shown beside the sale price;
a countdown banner pushes "7-day Unlimited Kling 4.0, 51% off".

| Plan | Credits/mo | ~Images | ~Videos | Monthly | Annual per month (billed yearly) | Parallel (monthly / annual) |
|---|---:|---:|---:|---:|---:|---|
| Basic | 2,000 | 300 | 60 | $19 (list $23) | $11.50 ($138/yr) | 1 / 8 |
| Pro | 3,600 | 900 | 180 | $34 (list $40) | $20 ($240/yr) | 1 / 12 |
| Ultra | 6,000 | 1,425 | 300 | $56 (list $66) | $33 ($396/yr) | 4 / 24 |
| Infinite | 20,000 | 7,000 | 1,300 | $169 (list $199) | $99.50 ($1,194/yr) | 8 / 50 |

- Effective $/credit: $0.0085–0.0095 monthly, $0.0050–0.0058 annual.
- Implied cost per item (their "~" counts, almost certainly the cheapest model, duration unstated):
  image $0.024–0.063 monthly, $0.014–0.038 annual; video $0.13–0.32 monthly, $0.08–0.19 annual.
- "Unlimited" windows are time-boxed per model, not permanent. Monthly Basic/Pro: none. Annual
  Infinite: Seedance 2.5 and Kling 4.0 30-day, MiniMax H3 365-day, GPT Image 2.5 / Midjourney V8.2 /
  Nano Banana 2 7-day. Ultra annual: Kling 4.0 5-day. Real-human-face upload and 4K/1080p are Pro and up.
- Annual plans also get more concurrency and "unlimited models" slots than monthly of the same tier.
- Skill discounts: 25% off credits on AI Animation, Music Video, Faceless Reels (annual only).
- Headline promo: Seedance 2.0 "from $0.05/s" (60% off), so about $0.25 per 5 s.
- Models listed: Seedance 2.5, Kling 4.0, MiniMax H3, Wan 3.0, GPT Image 2.5, Midjourney V8.2,
  Nano Banana 2. Midjourney has no official API, so sourcing is worth asking about (same flag as syntx).
- Not retrievable: FAQ answers on top-ups, expiry and 7-Day Unlimited did not expand. The only text
  shown: "Subscription credits refresh with each billing cycle and follow the policy shown in your
  account." Treat expiry and top-up rules as unknown.

## Side by side

| | Veyrnox | Buzzy | Higgsfield (09-24) | syntx | Krea | Freepik | ReelShort |
|---|---|---|---|---|---|---|---|
| Model | One-off packs | Monthly/annual subscription | Monthly/annual subscription | Prepaid subscription (1–12 mo) | Subscription, compute units | Subscription | Coins + weekly/monthly VIP |
| Entry | $10 / 100 cr | $19 / 2,000 cr ($11.50 annual) | $19 / 270 cr | €8.90 / 260 tokens | $9 / 5,000 CU ($5 annual) | $20 ($14.50 annual) | $4.99 / 525 coins |
| Mid | $59 / 1,200 cr | $34 / 3,600 cr | $59 / 1,200 cr | €39.90 / 1,700 | $35 Pro (full video roster) | n/a | $19.99 / 2,400 |
| Top | $129 / 3,000 cr | $169 / 20,000 cr | $129 / 3,000 cr | €119 / 3,000 | n/a | n/a | $99.99 / 20,000 |
| $/credit entry to top | $0.100 to $0.043 | $0.0095 to $0.0085 | $0.070 to $0.043 | €0.034 to €0.040 | n/a | n/a | 0.95¢ to 0.50¢ |
| Expiry | Paid credits never expire | Unknown | Subscription rules | Spend only while subscribed | n/a | n/a | n/a |
| Subscriptions | Built, closed (`subscriptions_not_open`) | Core model | Core model | Core model | Core model | Core model | VIP |

Veyrnox's live pack list: 100 cr $10, 270 cr $19, 1,200 cr $59, 3,000 cr $129.

## Same unit, our price vs Buzzy

Our credits cost $0.043 (top pack) to $0.10 (entry). Per-credit comparison is meaningless because a
Buzzy credit buys far less than ours; compare per item.

| Item | Veyrnox credits | Veyrnox $ (top pack to entry) | Buzzy implied $ (annual to monthly) |
|---|---:|---|---|
| Image (Nano Banana, FLUX, Seedream) | 2 | $0.086 to $0.20 | $0.014 to $0.063 |
| Short video, cheapest row (Veo 3.1 Lite 8 s) | 10 | $0.43 to $1.00 | $0.08 to $0.32 (model unstated) |
| Kling 2.6 5 s | 17 | $0.73 to $1.70 | n/a (they sell Kling 4.0) |
| Kling 3.0 5 s | 34 | $1.46 to $3.40 | n/a |
| Seedance 2.0 Fast 5 s | 28 | $1.20 to $2.80 | about $0.25 promo (Seedance 2.0) |

Reading: on images Buzzy is roughly 2× to 6× below our top pack and up to 14× below entry. Video is
indicative only, since their per-video credit count does not name a model or length.

## What this means

1. Buzzy competes on an annual-prepay, concurrency and time-boxed "unlimited" model, the same shape as
   syntx and Higgsfield. We are the only one in this set selling one-off, never-expiring packs, and
   the only one without a live subscription.
2. Their price gap is not a cheaper wholesale API. Likely sources: breakage from prepaid annual plans,
   cheap-model-weighted "~" counts, promos that run below cost, and possibly pooled or grey sourcing
   for Midjourney (unverified). Our 50% contribution floor (ADR-0014/0037) stops us matching it.
3. Where we can answer without breaking the floor: open the already-built subscription path
   (`credit_subscription_plans`, `subscriptions_not_open` today) so an entry plan exists below $19,
   and add the cheap BytePlus Seedance rows already recommended in the syntx analysis. That is the
   one lever that moves image and short-video cost per item.
4. Do not copy: permanent fake-list strikethroughs, countdown banners, or "unlimited" labels backed
   by 7-day windows. Our refund and no-expiry promises are the contrast.

## Gaps and checks still open

- Buzzy FAQ answers (expiry, top-ups, 7-Day Unlimited terms): open the page signed in, or ask support.
- Higgsfield, Krea, Freepik, Pika numbers are search snippets and a one-month-old snapshot: re-pull
  before quoting externally.
- No competitor was bought from; per-item costs are inferred from published allowances.
