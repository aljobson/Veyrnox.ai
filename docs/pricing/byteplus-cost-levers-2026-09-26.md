# BytePlus ModelArk: every cost lever, account constraint and resale term — 26 September 2026

Full-site crawl of byteplus.com and docs.byteplus.com for anything that changes what we would
pay for Seedance, Seedream, OmniHuman and speech models, and for anything that constrains a
metered creator app using them. Extends the BytePlus section of
`wholesale-survey-2026-09-26.md`. Numbers are from the cited page on the crawl date; where two
BytePlus pages disagree both values are given.

## Cost levers that apply at our spend

These need no sales contact and no monthly commitment.

| Lever | Effect on a 5s clip | Terms | Source |
|---|---|---|---|
| **Seedance 2.0 resource packs** | 2.0: $4.30 per 1M tokens (list $7.00 to $7.70). Fast: $3.30 (list $5.60). Mini: $2.10 (list $3.50). About 40% off. | Minimums $30.10 (2.0), $29.70 (Fast), $42 (Mini). 3 months, non-refundable, deducted before PAYG, not purchasable with vouchers, individuals and enterprises. | docs.byteplus.com/en/docs/ModelArk/2191775, ai.byteplus.com/en/activity/seedance2-0 |
| **Seedance 2.5 resource packs** | $6.40 per 1M tokens (list $10.70 to $11.70 without video input). 40% off. Video-input jobs are already $6.40 list, so no saving there. | $32 / 5M, $64 / 10M, $640 / 100M. Docs say 90 days, activity page says 3 months. Non-refundable. | ModelArk/2191775, ai.byteplus.com/en/activity/seedance2-5 |
| **Seedance 2.0 Fast and Mini PAYG promo** | Fast 25% off, Mini 60% off, 480p and 720p only. | Enterprise accounts only. 14:00 UTC+8 2026-08-07 to 2026-10-07. Per-model token caps from 2026-09-18 (Fast 1.2B, Mini 3.6B tokens), then list resumes. Does not stack with packs or savings plans; the lowest single factor applies. The savings-plan page dates the same promo to 2026-09-07; the campaign page is taken as normative. | ModelArk/2630943 |
| **Free quota** | Seedance 1.0 Pro 2M tokens (about 8 clips at 1080p). Seedream 4.5 / 4.0 / 3.0: 200 images each. SeedTTS 20,000 chars. Nothing for Seedance 2.x, Seedream 5.x or OmniHuman. | Once per verified entity, enterprise information submitted, used before anything else. Expiry: "does not expire" on the activity page, "may have a validity period" in the T&C. | byteplus.com/en/activity/free, ModelArk/1399514 |
| **Seedream 5.0 Lite first purchase** | $6.99 for 400 images (list $13.99), up to $49.99 for 2,000. | Once per new customer, 30 days, unused quota lost. | byteplus.com/en/activity/Seedream5-0-Lite-First-Purchase |
| **Savings Plan monthly packages** | 3% to 6% off Category A, 8% to 11% off Category B. | $145 to $4,300 per month, one month validity, Seedance 2.0 excluded. First purchase $6.99 to $49.99 at about 30% off, once. | byteplus.com/en/activity/ai-savingsplans |
| **Referral voucher** | Referrer gets a voucher worth 10% of the referee's first order. | Scope is Coding Plan and postpaid Seed LLM fees; not clearly video. Vouchers valid 90 days, campaign to 2026-09-30. | ModelArk/2165246 |
| **0% tax** | Avoids 20% UK VAT at source. | Corporate account with a tax ID. Personal accounts pay local VAT. | byteplus-platform/docs-tax-rate-reference |

Effective Seedance costs with packs, 5s 16:9, no video input, our floor credits at
ceil(cost / 0.01796):

| Model | 480p | 720p | 1080p | Floor credits at 720p | Cheapest elsewhere at 720p |
|---|---:|---:|---:|---:|---|
| Seedance 2.0 Mini, pack | $0.11 | $0.23 | n/a | 13 | kie $0.205, promo $0.15 (enterprise, to 2026-10-07) |
| Seedance 2.0 Fast, pack | $0.165 | $0.35 | n/a | 20 | OpenRouter $0.454, promo $0.45 |
| Seedance 2.0, pack | $0.21 | $0.47 | $1.04 | 27 | Segmind $0.76, kie $1.025 |
| Seedance 2.5, pack | $0.31 | $0.69 | $1.55 | 39 | Segmind $1.19, kie $1.575 |

With packs, BytePlus is the cheapest verified source for every Seedance 2.x model, 23% under
our current OpenRouter cost on 2.0 Fast and 38% to 56% under the next source on 2.0 and 2.5.
Seedance 1.x stays cheaper on kie (1.5 Pro 720p no audio $0.0875) except 1.0 Pro Fast, which
kie does not list.

## Levers that do not apply at our spend

| Lever | Why not | Source |
|---|---|---|
| AI Savings Plans (16% to 50% off) | Needs $7,000 per month committed for six or twelve months. Category C (Seedance 2.0, 2.5, 1.5 Pro without audio) gets 0% at every tier. Seedance 2.0 Fast and Mini are sales-only. Resale of discounted capacity prohibited; unavailable to reseller end-users. | byteplus-platform/AI_Savings_Plans |
| Business discount / Order Form | Negotiated fixed price, discount or tiers via an account manager, with a minimum commitment. No public numbers. Must accept within 30 days. | byteplus-platform/business-discount-management |
| Batch inference (50%+ off) | LLM only; video and image batch not confirmed on the page. | ModelArk/1399517 |
| Flex inference | Text APIs only. | ModelArk/1399517 |
| Model Units (dedicated capacity) | No price table for video models. | ModelArk/1848593 |
| AI Startups Accelerator (vStart) | "Up to $100,000 in cloud coupons", "$6.5K voice AI credits", no statement that video or image models are covered. Round D or earlier, company email, valuation. Worth an application; not a pricing input. | byteplus.com/en/contact-us/vstart |
| Partner Network (30%+ partner discount) | Reseller and agency programme. End-users of resellers lose access to business discounts and savings plans. | byteplus.com/en/partners |
| Advanced Creation Rights | Raises cost: $1,400 per month for 120 requests per minute and a private asset library. Only relevant if the default 180 requests per minute and 3 concurrent jobs for individual accounts, or 600 and 10 for enterprise, become a ceiling. | modelark/2377608 |
| Credit limit / post-payment | Cash flow, not price. Three times average monthly bill, 1.5% per month late interest, ModelArk suspends after two hours in arrears. | byteplus-platform/docs-post-payment |

Category assignments conflict between pages. The savings-plan doc lists Seedance 1.5 Pro with
audio, 1.0 Pro and 1.0 Pro Fast in Category B; the product page lists them in Category A. It
only matters above $7,000 per month.

## Account, region and throughput constraints

- **United States is excluded by contract.** Service Specific Terms, Model Services 2(1): the
  Model Services "are not available in the United States". Also absent from the availability
  list: China, India, Russia, Iran, North Korea. UK and all EU states are listed. Whether the
  exclusion binds the customer's location only or also end-user location is not stated. Get
  that in writing before serving US users through a BytePlus route.
- **Restricted Model tag.** An earlier version of the availability page barred any "sale,
  resale, operation, or any form of use of Restricted Models" in the EU. The sentence is gone
  from the current page and the tagged models are not published. Check each model card before
  an EU rollout.
- **Enterprise verification changes price and capacity.** Organisation real-name verification
  (business registration number, certificate photos, one to two working days) unlocks the
  Seedance 2.0 promo, 0% tax, 600 requests per minute and 10 concurrent jobs on Seedance 2.x
  (individual accounts get 180 and 3), no-upfront savings plans and the free-token terms.
- **Account profile** (type, organisation, country, phone, card or PayPal) is required before
  ordering. Bank transfer needs a verified account and takes up to seven days.
- **Refunds.** All purchases final except unprovisioned within 24 hours or erroneous within 90
  days. A seven-day unconditional refund exists for unused resource packages once per product
  per year, but promotional packs are excluded and every Seedance pack is marked non-refundable.
  Failed generations are not charged.
- **Minimum token consumption** applies to Seedance 2.0 and 2.5 when the input includes video,
  by resolution and aspect ratio. Short video-input jobs cost more than the per-second rate.

## Resale and third-party-app terms, quoted

These are the clauses that decide whether Veyrnox.ai can run on BytePlus at all.

1. Service Specific Terms, Model Services 4.2, "Platform Customers". A Platform Customer
   "integrates BytePlus video generation model APIs into its own platform and makes them
   available to external enterprises or creators." 4.2.3: "You may not: resell or re-integrate
   the APIs into UGC platforms, including AI content creation tools. If you operate an
   aggregation platform, end users may only generate video content for their own use; or resell
   the APIs without our written authorization." 4.2.2 minimums: "identity verification for
   enterprise and individual end users; a security incident response process; tiered violation
   handling (including content traceability, warnings, takedowns, and account action) with
   complete records; and processes to verify and retain rights in user-uploaded content,
   including real-person imagery." 4.2.4(b): unauthorised resale means an immediate ban and
   "liquidated damages equal to 20% of the minimum commitment amount in your Order Form (if
   any) or Service Agreement". 4.1.2: any breach, "liquidated damages equal to 10% of the
   greater of" total video orders or total committed spend.
   docs.byteplus.com/en/docs/legal/docs-service-specific-terms, updated 2026-09-08.
2. Platform Customer Code of Conduct 2.1: "If you operate an aggregation platform, your end
   customers shall be limited to users generating video content for their own purposes, and you
   shall not provide or re-integrate the APIs to or into any UGC platforms, especially AI
   content creation tools." docs.byteplus.com/en/docs/ModelArk/2353368.
3. Customer Agreement 6.2(1): no holding out as a "SaaS provider, Model as a Service provider,
   service provider, reseller, or distributor of the Services". 6.2(3): no renting, selling,
   sublicensing or distributing the Services. But 1.5 and 18.1 define "End User" as "your
   customers and/or end users of your products or services, including those who use or receive
   Outputs". docs.byteplus.com/legal/docs/customer-agreement.
4. Acceptable Use Policy (iv): no reselling "any of the services (for a fee or otherwise) or
   any derivative works thereof", and no "commercial offering or services that directly or
   indirectly competes with an offering or services from BytePlus".
5. General Terms for AI Services 2.1: "you own the Output generated in response to your Input".
   GenAI AUP: do not remove "watermarks, identifiers, metadata" that mark BytePlus output, and
   disclose that content is AI generated.

**Reading for Veyrnox.ai.** A consumer-facing generation product is an "AI content creation
tool" and an "aggregation platform" under 4.2. The permitted shape is end users generating
video "for their own use", with the four 4.2.2 controls in place. Anything that reads as
reselling API access, including a developer API on top of BytePlus, needs written authorisation.
Compared with what we have today: Turnstile and email confirmation cover identity verification
only loosely; there is no documented incident response process, no tiered violation log, and
no rights-verification step for uploaded real-person imagery. Those four items are the gate,
not the price. Note that syntx.ai sells Seedance to anonymous Telegram users at cost, which is
the pattern 4.2.3 was written against.

## Recommendation

- Open a BytePlus enterprise account (UK company, tax ID, organisation verification) and buy
  Seedance 2.0 Fast and Mini packs at $30 to $42 minimum. That alone takes our Seedance 2.0
  Fast cost from $0.454 to $0.35 and opens Mini at $0.23 and Seedance 2.5 at $0.69, all at
  about 40% under list with no commitment.
- Before the first paid generation for a user, write down the four 4.2.2 controls and where
  each lives in the codebase, and confirm US end-user handling with BytePlus in writing. Record
  the answer in an ADR alongside the adapter decision.
- Apply to the startup accelerator in parallel. It costs nothing and may cover video.
- Ignore savings plans, order forms and model units until spend approaches $7,000 per month.
