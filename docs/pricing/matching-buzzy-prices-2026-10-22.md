# How Veyrnox could price as low as Buzzy — 22 October 2026

Question: Buzzy looks 2x to 10x cheaper than us. How much of that gap can we close, and how, without
breaking the 50% contribution margin (ADR-0014, ADR-0037)?

Inputs: our live packs and catalog (`veyrnox.ai/api/credit-packs`, `/api/catalog`), our margin rules
(`50-percent-margin.md`, migrations 0041 and 0121), the earlier wholesale survey and review in this
folder, Buzzy's pricing page read on 2026-10-21, and web searches today. Provider costs are recorded
catalog costs, not a fresh invoice audit. Supplier-blog figures conflict with each other and are marked.

## Bottom line

1. **Supplier prices will not close the gap.** Verified wholesale is roughly at list. The best
   realistic buying gains are 10% to 30% on video, not 3x to 10x.
2. **The gap is mostly ours to close**, through three things we control: how steeply our price per
   credit falls from the entry pack to the top pack, the whole-credit rounding on cheap images, and
   which models we put in front of beginners.
3. **Buzzy's headline counts cannot be true for premium models.** Their top annual plan is $99.50 for
   about 1,300 videos, which is $0.077 a video. Our cheapest verified 5 s video cost is $0.10. So
   their counts assume the cheapest models, short or low-resolution clips, and heavy breakage (users
   who do not spend the allowance).

## What Buzzy's plans must assume

| Plan (annual, per month) | Revenue | Their "~videos" | Revenue per video | Premium-model reality |
|---|---:|---:|---:|---|
| Basic | $11.50 | 60 | $0.19 | Kling-class at $0.45 a clip: 25 clips |
| Pro | $20 | 180 | $0.11 | 44 clips |
| Ultra | $33 | 300 | $0.11 | 73 clips |
| Infinite | $99.50 | 1,300 | $0.077 | 221 clips |

Wholesale reference points per 5 s clip: Seedance 1.0 Pro Fast $0.10 (BytePlus list, 720p), Veo 3.1
Lite $0.15 (kie, 8 s), Wan 2.5 $0.30, Kling 3.0 $0.45 (kie, 1080p, no audio). Buzzy's Seedance 2.0
promo of "$0.05 a second" is $0.25 a 5 s clip, which sits between BytePlus's Seedance 2.0 Mini list at
480p ($0.18) and 720p ($0.38): either a Mini-class model or a loss leader. Its "unlimited for 1 to 365
days" windows on named models are loss leaders funded by users who never reach their allowance.

## Where our own prices sit

Our credits cost $0.100 (entry pack) down to $0.043 (top pack). The database floor is $0.043 a credit
(`credit_packs_sticker_floor`, migration 0121). After the 8% + $0.30 fee a top-pack credit nets $0.0395,
so a credit may carry at most $0.0197 of provider cost at 50% margin.

| Model | Cost | Credits now | Price at top pack | Price if credits were fine-grained, 50% margin | Same at 35% margin |
|---|---:|---:|---:|---:|---:|
| Sana 1.5 image | $0.01 | 1 | $0.043 | $0.024 | $0.018 |
| Nano Banana image | $0.02 | 2 | $0.086 | $0.048 | $0.035 |
| Flux.2 pro image | $0.03 | 2 | $0.086 | $0.071 | $0.053 |
| Seedance 1.0 Pro Fast 5 s | $0.10 | 6 (staged, inactive) | $0.258 | $0.238 | $0.175 |
| Veo 3.1 Lite 8 s | $0.15 | 10 | $0.430 | $0.357 | $0.263 |
| Kling 3.0 (kie) 5 s | $0.45 | 28 | $1.204 | $1.071 | $0.789 |

Entry-pack buyers pay $0.100 a credit, so their price per item is 2.3x the top-pack figures above.

## Levers, ranked by size of effect

| # | Lever | Effect | Cost or risk | Who decides |
|---|---|---|---|---|
| 1 | **Flatten the pack curve.** Entry pack from $0.100 a credit toward $0.050 to $0.060. The DB allows down to $0.043. At $10 for about 215 credits the worst-costed credit is still near 48% margin | Entry price per item falls 40% to 50% with no supplier change | Gives up margin on small buyers (about 72% today). Needs Stripe pack rows and an ADR-0014 note | Owner |
| 2 | **Finer credit unit** (1 credit = a tenth of today's). Whole credits waste margin on cheap rows: Nano Banana earns 68% against a 50% floor | Images about 45% cheaper (Nano Banana $0.086 to $0.048). Video 8% to 11% cheaper. Bigger balance numbers also read better next to Buzzy's 2,000 credits | Touches every catalog price, ledger display, mobile app and API docs; the integer ledger stays valid. Large migration | Owner, needs an ADR |
| 3 | **Beginner models.** Put Sana, Seedance 1.0 Pro Fast ($0.258 at 6 credits) and Veo Lite first; keep Kling and Veo premium behind a label | Our default video lands at $0.26, inside Buzzy Basic's implied $0.19 to $0.32 | Quality complaints; the BytePlus row has activation gates (ADR-0058) | Product |
| 4 | **Subscription with annual prepay.** Plans exist (`credit_subscription_plans`), production checkout is closed. Annual rows need a new interval | Breakage funds a lower per-credit rate; annual cuts the $0.30 fee count | Stripe and Finance approvals named the current prices; credit expiry has to be disclosed | Owner |
| 5 | **Lower the margin floor to 35% on cheap rows only** | Another 25% to 30% off images and cheap video (table above) | Margin before overhead, refunds and retries is already unverified | Owner |
| 6 | **Buy better.** kie gives 10% bonus at $1,250 top-up; Kling direct 10% off from $3,780 prepaid with 180-day expiry; aggregators list Kling 3.0 Std at $0.071 to $0.095 a second against our $0.09 a second on kie | 10% to 20% on video | Prepaid cash lock-up, expiry, reseller terms; aggregator figures are vendor blogs and conflict | Owner, after quotes |
| 7 | **Startup and partner credit programs.** Google for Startups AI tier is reported at up to $350,000 over two years (needs seed to Series A institutional funding, covers Google Cloud services only). NVIDIA Inception is free and routes to partner credits, set per application. Buzzy advertises both partner statuses | Could subsidise Veo and Imagen via Vertex for a year or two | Eligibility depends on our funding status; Veo and Gemini image coverage unverified; credits end | Owner |
| 8 | **Self-host open-weight models** (Wan 2.x, Flux). Rough cost per clip: $0.17 to $0.38 on a rented H100 at 5 minutes of GPU time (my arithmetic from $1.99 to $4.56 an hour; generation time unverified) | No better than the $0.30 hosted Wan price at low volume | Operations burden; earlier notes found self-hosting not cheaper at low volume | Defer |

Combining 1, 3 and 5 lands our entry-level price per item inside Buzzy's range for images and cheap video
with no supplier change. Lever 2 is the cleanest way to get there without lowering the margin floor.

## What not to copy

- Struck-through list prices, countdown banners, "unlimited" labels backed by 7-day windows.
- Sourcing that cannot be verified. Buzzy lists Midjourney, which has no official API.
- Selling premium-model clips at an allowance that only works if users do not use it.

## Checks still open

- Buzzy's real credit cost per clip and its expiry rules (needs a signed-in account).
- Whether Buzzy's "Google Partner" and "NVIDIA Inception" statuses come with credits or discounts.
- Current BytePlus enterprise terms (nothing public) and Veo coverage under Google startup credits.
- A fresh invoice-level read of what fal, kie and GrsAI actually charged us per row.

## Sources

- Buzzy pricing: https://www.buzzy.now/pricing (read 2026-10-21)
- [Atlas Cloud on cheapest Kling API](https://ask.atlascloud.ai/cheapest-kling-api), [Seedance 2.5 pricing guide](https://www.atlascloud.ai/it/blog/guides/seedance-2-5-api-pricing-atlas-cloud-vs-official-providers) (vendor blogs)
- [NVIDIA Inception guide](https://thundercompute.com/blog/nvidia-inception-program-guide), [Google for Startups Cloud](https://cloud.google.com/startup/faq) (third-party summaries; confirm on the official pages)
- [Runpod pricing](https://www.runpod.io/gpu-cloud/pricing)
- Internal: `50-percent-margin.md`, `wholesale-survey-2026-09-26.md`, `wholesale-review-2026-09-28.md`,
  `syntx-competitor-analysis-2026-09-26.md`, ADR-0014, ADR-0037, ADR-0058, migrations 0041, 0121.
