# syntx.ai competitor analysis and three-way price comparison — 26 September 2026

Question asked: how does syntx.ai price generations so far below us, and where do we
sit against syntx.ai and Higgsfield on the same units?

Sources: `syntx-2026-09-26.json` (pulled from syntx's tariffs API, not the marketing
page), `higgsfield-2026-09-24.json`, `live-catalog-2026-09-24.json` (our catalog),
`50-percent-margin.md`, ADR-0014, ADR-0037. Provider costs are our recorded catalog
costs, not a fresh invoice audit. Matching model names does not establish identical
output quality, resolution or provider.

## Who syntx.ai is

- Legal entity: SYNTX INTELLIGENCE FZCO, Dubai Silicon Oasis, registered
  2025-10-21 (public offer, updated 2026-07-03).
- Telegram bot first (`@syntxaibot`), web app second. The FAQ says the bot has the
  full feature set and the web version is catching up.
- Docs and status page default to Russian. An unofficial clone repo describes the bot
  as having over a million users. Treat that figure as unverified.
- Stack visible from outside: Vue frontend and a Python JSON API on Cloudflare,
  media on Cloudflare R2 (`r2.syntx.ai`). No public source repository exists. The
  only GitHub presence is a third-party MCP/SDK wrapper around their bearer-token
  API (`ssm82/syntx-ai-mcp`).
- Payments: card checkout in EUR for an EU visitor. Processor not identified. A
  UAE FZCO serving a Telegram audience has access to processors that declined us
  (LemonSqueezy refused AI media generation, see the 2026-09-22 note).

## Their pricing model

Prices as shown to a Spanish IP, excluding tax and promotions.

| Plan | Monthly | Annual, per month | Tokens per month (monthly plan) | Tokens per year (annual plan) | EUR per token |
|---|---:|---:|---:|---:|---|
| Basic | €8.90 | €7.56 | 260 | 3120 | 0.029 to 0.034 |
| Pro | €16.90 | €14.36 | 680 | 8160 | 0.021 to 0.025 |
| VIP | €39.90 | €33.90 | 1700 | 20400 | 0.020 to 0.023 |
| Elite | €59.90 | €50.91 | 2600 | 31200 | 0.020 to 0.023 |
| Ultra Elite | €119.00 | €101.15 | 3000 | 36000 | 0.034 to 0.040 |

Rules that matter for the economics:

- Tokens never expire but can only be spent while a subscription is active.
- Top-ups are only available with an active subscription.
- LLM chat is included and request-limited, not token-metered. Higher tiers get
  ×3, ×6, ×10, ×15 the Basic request limit.
- Elite and Ultra Elite advertise "unlimited" video and image on a named subset
  (Veo 3.1 Lite, Nano Banana, MiniMax 01/02, GPT Image, Runway, Topaz), gated by
  the same request multipliers.
- Every card shows a struck-through anchor (€342.90 for Basic, up to €1,341.90
  for Ultra Elite) labelled "if you buy all the neural networks separately".
- Every video row is quoted with a trailing "+". The "+" price is the shortest,
  lowest-resolution variant. Longer clips, 1080p, 4K and audio cost more. The
  headline "up to 516 videos a year" on Basic assumes every token goes to the
  cheapest 6-token mode.

## Why they can price this way

1. **Prepaid subscription with breakage.** Annual plans are paid up front. Tokens
   are locked to an active subscription, so lapsed subscribers forfeit use and
   light users subsidise heavy ones. We sell one-off packs whose credits never
   expire and are always spendable, so we carry no breakage.

2. **Base price is the floor, not the price.** Our `credits_5s` is quoted for the
   verified output (mostly 1080p with audio where the model supports it). Their
   table quotes the minimum variant and scales up from there.

3. **Grey sourcing for models with no official pay-per-use API.** Midjourney, Suno,
   Sora video, "GPT Image" and a "Veo 3.1 Fast (relax)" background tier are all
   listed. "Relax" is Google Flow / AI Ultra consumer-plan vocabulary. None of
   these has an official API at those prices, so part of the catalog is either
   pooled consumer accounts or grey-market resellers. This is not a route we
   should copy.

4. **Kling and Seedance 1.x at 6 tokens (€0.12 to €0.20)** sits below the kie.ai
   wholesale we pay for Kling 2.6 ($0.275) and below fal list for Kling 2.1
   ($0.25). Either they buy direct from Kuaishou and ByteDance at volume tiers,
   or these rows are loss leaders inside the subscription. Not verifiable from
   outside.

5. **Thinner margin target.** Our floor is 50% contribution margin after an
   assumed 8% + $0.30 payment fee (ADR-0037, `50-percent-margin.md`). At their
   VIP rate on kie-equivalent costs, Veo 3.1 Fast clears roughly 25% and Kling
   2.6 is near zero. They price for volume and lock-in, not per-generation margin.

6. **Fixed-cost amortisation.** Unlimited cheap LLM chat and "unlimited" cheap
   image models cost little per user and make the subscription feel bottomless.

## Three-way comparison on the same unit

Rates used:

| Seller | Rate basis | Per credit or token |
|---|---|---|
| Veyrnox | $129 / 3000 one-off pack, never expires | $0.043 |
| Higgsfield | $129 / 3000 Ultra monthly subscription | $0.043 |
| syntx VIP | €39.90 / 1700 monthly subscription | €0.0235, about $0.027 |
| syntx Basic | €8.90 / 260 monthly subscription | €0.0342, about $0.039 |

FX assumption: 1 EUR = 1.15 USD. Not a quoted rate. Change it and the syntx USD
column moves in proportion.

Higgsfield credits are the 2026-09-24 published rates with the confidence flags
from `higgsfield-2026-09-24.json`. syntx tokens are the base "+" charge.

| Unit | Veyrnox credits | Veyrnox $ | Higgsfield credits | Higgsfield $ | syntx tokens | syntx $ (VIP) | syntx $ (Basic) | syntx vs us | Higgsfield vs us |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Nano Banana image | 2 | 0.086 | 1 | 0.043 | 1.5 | 0.041 | 0.059 | 0.48× | 0.50× |
| Nano Banana Pro 2K image | 6 (kie) | 0.258 | 2 | 0.086 | 2 | 0.054 | 0.079 | 0.21× | 0.33× |
| FLUX image (ours FLUX.2 Pro, theirs FLUX 1.1 Pro) | 2 | 0.086 | 1 | 0.043 | 1.5 | 0.041 | 0.059 | 0.48× | 0.50× |
| Seedream v4 image | 2 | 0.086 | 1 | 0.043 | 1.2 | 0.032 | 0.047 | 0.37× | 0.50× |
| Wan 2.5, 5s 720p | 19 | 0.817 | 7 | 0.301 | 20+ | 0.540 | 0.787 | 0.66× | 0.37× |
| Kling 2.6, 5s no audio | 17 | 0.731 | 5 | 0.215 | 14+ | 0.378 | 0.551 | 0.52× | 0.29× |
| Kling 3.0, 5s | 34 | 1.462 | 8 | 0.344 | 9+ | 0.243 | 0.354 | 0.17× | 0.24× |
| Hailuo 02, 6s 768p | 9 | 0.387 | 6 | 0.258 | 10+ | 0.270 | 0.394 | 0.70× | 0.67× |
| Seedance 2.0 Fast, 5s 720p | 28 | 1.204 | 12 | 0.516 | 9.8+ (Pro plan and up) | 0.265 | n/a | 0.22× | 0.43× |
| Veo 3.1 Fast, 8s | 19 | 0.817 | 32 (extrapolated from 4s) | 1.376 | 19+ | 0.513 | 0.748 | 0.63× | 1.68× |
| Veo 3.1, 8s | 76 | 3.268 | 80 (extrapolated from 4s) | 3.440 | 119+ | 3.216 | 4.686 | 0.98× | 1.05× |
| Veo 3.1 Lite, 8s | 10 | 0.430 | not listed | | 13.4+ | 0.362 | 0.528 | 0.84× | |
| Music track (ours ACE-Step 1.5, theirs Suno v6) | 3 | 0.129 | not listed | | 10 | 0.270 | 0.394 | 2.09× | |

Notes on the table:

- The Nano Banana Pro row uses our live kie route at 6 credits. The GrsAI route
  at 2 credits ($0.0271 cost) was activated by migration 0124 per ADR-0037; if it
  is the live default, our figure becomes $0.086 and the ratios become 0.63× and
  1.00×.
- Higgsfield Veo rows are 4s prices doubled. Higgsfield sells Veo shorter and
  dearer than both of us.
- syntx's Kling 3.0 and Seedance 2.0 Fast rows are far below anyone's wholesale
  list price. Treat them as loss leaders or direct-sourced, not as a benchmark.
- On music we are the cheapest, but ACE-Step and Suno are not comparable outputs.

## Plan and pack structure side by side

| | Veyrnox | Higgsfield | syntx |
|---|---|---|---|
| Sales unit | One-off credit packs | Monthly or annual subscription | 1, 3, 6 or 12 month subscription |
| Entry | $10 / 100 credits ($0.100) | $19 / 270 ($0.070) | €8.90 / 260 tokens (€0.034) |
| Mid | $59 / 1200 ($0.049) | $59 / 1200 ($0.049) | €39.90 / 1700 (€0.023) |
| Top | $129 / 3000 ($0.043) | $129 / 3000 monthly; $1188 / 36000 annual ($0.033) | €119 / 3000 (€0.040); €1214 / 36000 annual (€0.034) |
| Expiry | Paid credits never expire, always spendable | Monthly allotment, subscription rules | Never expire, spendable only while subscribed |
| Free tier | Signup grant after email confirmation | Daily free pool | 5 tokens plus 5 LLM requests, no time limit |
| Unlimited rows | None | Promotional unlimited on some models | Elite and above, fair-use limited |
| Margin policy | 50% contribution after fees (ADR-0037) | Unknown | Unknown, estimated 0 to 30% on video at wholesale prices |

## Would buying direct from Kuaishou and ByteDance close the gap?

Checked 2026-09-26 against [kling.ai/dev/pricing](https://kling.ai/dev/pricing) and
[BytePlus ModelArk pricing](https://docs.byteplus.com/en/docs/ModelArk/1544106).

**Kling direct (Kuaishou).** Prepaid resource packages only. Minimum $700 for 5000
units at $0.14 per unit, 180-day validity, no rollover, 20 concurrent jobs. A 10%
discount starts at $3,780 up front. List rates: Kling 3.0 without audio 0.6 units/s
at 720p and 0.8 units/s at 1080p, so a 5s 1080p clip is $0.56. That is exactly our
recorded fal cost for `kling-3.0-i2v`. fal is reselling Kling at Kling's list price,
so going direct saves 0% at list and 10% with a $3,780 lock-up that expires in six
months. syntx's Kling 3.0 at 9 tokens (€0.18 to €0.31) is below Kling's own list
price, so they are not simply buying direct either. Either a negotiated enterprise
package or a loss leader.

**ByteDance direct (BytePlus ModelArk, Singapore entity).** Pay-as-you-go, postpaid,
no minimum, billed per video token. Only successful generations are charged.

| Model, 5s 16:9 | 480p | 720p | 1080p | What we pay today |
|---|---:|---:|---:|---|
| Seedance 2.5 | $0.51 | $1.16 | $2.84 | not offered |
| Seedance 2.0 | $0.35 | $0.76 | $1.87 | not offered |
| Seedance 2.0 Fast | $0.28 | $0.60 list, $0.45 with 25% promo to 2026-10-07 | n/a | $0.454 via OpenRouter |
| Seedance 2.0 Mini | $0.18 | $0.38 list, $0.15 with 60% promo to 2026-10-07 | n/a | not offered |
| Seedance 1.5 Pro, silent / with audio | $0.06 / $0.12 | $0.13 / $0.26 | $0.29 / $0.58 | not offered |
| Seedance 1.0 Pro Fast | $0.05 | $0.10 | $0.24 | not offered |
| Seedream 4.0 image | | $0.03 | | $0.03 via fal |
| Seedream 5.0 Flash image | | $0.018 | | not offered |

Two things fall out of that table:

- Our OpenRouter Seedance 2.0 Fast cost ($0.454) is already the BytePlus promo price.
  Going direct on the one Seedance model we sell saves nothing today and costs more
  after the promo ends unless ByteDance extends it.
- syntx's Seedance rows line up with BytePlus costs almost token for token:
  Seedance 2.0 Mini 6.7 tokens (€0.16) against a $0.15 promo cost, Seedance 1.5 Pro
  7.5 tokens (€0.15 to €0.26) against $0.13 silent 720p, Seedance 1.0 Pro Fast
  6 tokens (€0.12 to €0.20) against $0.10. They are selling ByteDance's cheap tiers
  at roughly cost inside the subscription. Their cheapness on Seedance is model
  selection, not a better wholesale rate.

**Why we have not done it.** Each direct vendor is a new adapter (its own auth,
polling, moderation semantics, failure and refund path) plus an account onboarding
and a new reconciliation surface. Kling adds a prepaid lock-up. ADR-0011 put
provider swaps out of Phase-1 scope, and fal, kie, OpenRouter and GrsAI already
gave us one adapter per many models at or near list price. For Kling that trade
is still right. For ByteDance it is now the wrong trade, because the cheap
Seedance tiers we do not sell only exist on ModelArk.

**Recommendation.** Build a BytePlus ModelArk adapter, not a Kling one. Postpaid
with no minimum, and it unlocks a sub-$0.15 video cost tier that clears the 50%
floor at 6 to 9 credits: Seedance 1.0 Pro Fast 720p at $0.10 is 6 credits
($0.26), Seedance 1.5 Pro 720p silent at $0.13 is 8 credits ($0.34), Seedance
2.0 Mini 720p at $0.38 list is 22 credits ($0.95), or 9 credits while the promo
holds. That gives us a €0.25-class video row against syntx's €0.12 to €0.20
without breaking the margin policy. Revisit Kling direct only when Kling spend
passes roughly $700 per six months, and expect at most 10%.

## What to take from this

- Both competitors sell subscriptions with breakage and both price mainstream
  video at roughly one third to two thirds of our one-off credit price. syntx and
  Higgsfield are close to each other on most rows. The gap to us is mostly the
  margin policy and the pack-versus-subscription model, not a secret cheaper API.
- We are at or below both on Veo 3.1 and Veo 3.1 Fast, and cheapest on music.
- Do not chase syntx's Kling 3.0, Seedance 2.0, Suno or Midjourney prices. Those
  rows either lose money at any wholesale we can buy, or come from sourcing that
  would break provider terms.
- If subscriptions are ever revisited, model the syntx mechanic (tokens carry
  over but only spend while subscribed) rather than their per-generation prices.
- Their tariffs endpoint is public and changes weekly. It is a cheap live
  benchmark to add alongside the catalog watcher. Endpoints are listed in
  `syntx-2026-09-26.json`.
