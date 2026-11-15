# Plan curve fix: proposal for the owner — 15 November 2026

Status: proposal, nothing applied. No ADR or migration written until the owner picks an option.

## The problem

Monthly plans get worse per credit as they get bigger (live `/api/credit-subscription-plans`):

| Plan | Price | Credits | Per credit |
|---|---:|---:|---:|
| Lite | $10 | 209 | 4.78¢ |
| Starter | $19 | 398 | 4.77¢ |
| Plus | $59 | 1,171 | 5.04¢ |
| Ultra | $129 | 2,411 | 5.35¢ |

Higgsfield (secondary sources, re-check on their page): $19/270, $59/1,200, $129/3,000, so Ultra is 4.3¢ monthly and about 3.3¢ annual. We lose on Ultra by about 24% in credits.

## Why it happens

Each plan's credits were set by the yearly price (migrations 0383, 0385), which sits exactly on the 50% floor with a $0.01796 worst-case provider cost per credit. Monthly plans were then held to the same credits as yearly. Monthly alone has room:

`max credits = (price × 0.42 − 0.30) / 0.01796`, giving 217 / 427 / 1,363 / 3,000 for $10 / $19 / $59 / $129.

## The catch

Yearly pays one fee for twelve months but is discounted, and it already sits at the floor. More credits at the same yearly price breaks 50% on the worst-case model. So the fix is a trade-off between credits per dollar and annual discount.

## Options

Monthly credits are the same in A and B: **215 / 425 / 1,360 / 2,990**. Per credit: 4.65¢ / 4.47¢ / 4.34¢ / 4.31¢. Worst-case margin 50.1–50.4% on every tier.

| | Yearly price (Lite / Starter / Plus / Ultra) | Yearly discount | Yearly worst-case margin |
|---|---|---|---|
| **A. Hold 50% everywhere** | $111 / $219 / $699 / $1,535 | 1–7% | 50% |
| **B. Recommended: 20% off yearly** | $96 / $182.40 / $566.40 / $1,238.40 | 20% | 40–43% |
| **C. Do nothing** | unchanged | unchanged | unchanged; inverted curve stays |

Option B reaches 3.45¢ a credit on Ultra annual, close to Higgsfield's reported 3.3¢. Today's Ultra yearly is 4.28¢.

Worst-case margin assumes every credit is spent on the priciest rows, nothing expires unused, and costs are as recorded. Real blended margin is higher; production usage was not read for this note.

## Owner decision, 2026-11-15

"Minimum 50% or more." That is **option A**: monthly 215 / 425 / 1,360 / 2,990 credits, yearly at the 50% floor, so the annual discount shrinks to 1–7%. Option B is rejected. Annual discount can come back only if worst-case provider cost per credit falls: a 20% yearly discount at 50% needs about $0.0145 per credit (now $0.01796), which means repricing the rows above that line (Seedream, Veo Lite, Veo Fast, Seedance Fast, Nano Banana and others).

Files that pin today's numbers and must move together: `tests/planCreditLimits.test.mjs`, `tests/activateYearlyPlans.test.mjs`, `tests/creditPackValueSeparation.test.mjs`, `tests/storeBillingCatalog.test.mjs`, `scripts/test-credit-subscriptions*.mjs`, `app/veyrnox/_components/CreditSubscriptions.js`, migrations 0383/0385/0393/0394/0407, plus Stripe prices and the store catalog.

## Owner follow-up, 2026-11-15: 50% on yearly after discount too

Not possible with a better monthly credit rate. At 50% both floors are about 4.3¢ a credit (cost per credit $0.01796 / 0.42). A yearly discount therefore requires the monthly rate to sit above that floor, which is exactly today's structure (monthly 5.35¢ vs yearly 4.28¢ on Ultra; yearly is already 50.0–50.8%). The inverted curve is the discount.

The credit rate also barely moves what an item costs at a hard 50%, because price is bound to provider cost. Minimum credits per row at 50% (old recorded costs, re-check on invoices):

| Row | Now | Minimum at 50% (4.78¢ credit) |
|---|---:|---:|
| Veo 3.1 Lite | 5 | 8 |
| Veo 3.1 Fast | 9 | 15 |
| Seedream | 1 | 2 |
| Seedance 2.0 Fast | 19 | 23 |
| Hailuo 02 | 9 | 8 |
| Wan 2.5 | 17 | 15 |
| Kling 2.6 | 18 | 14 |
| Kling 3.0 Pro | 29 | 23 |

Recommended instead of changing plans: reprice rows. Raise the four under-50% rows, lower Kling, Wan and Hailuo to the 50% minimum, keep plans and yearly as they are. Real competitiveness at 50% comes from cheaper supplier cost.

## Owner decision, 2026-11-15 (final): 20% off yearly, 50% margin on yearly

Option E: every tier gets exactly 20% off yearly, and credits are set at the yearly 50% ceiling (`floor((0.42 × yearly price − 0.30) / (12 × 0.01796))`). Monthly plans carry the same credits.

| Tier | Monthly | Yearly (20% off) | Credits per month | Monthly per credit | Yearly per credit | Monthly margin | Yearly margin | Credits vs now |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Lite | $10 | $96.00 | 185 | 5.41¢ | 4.32¢ | 55.8% | 50.2% | −11% |
| Starter | $19 | $182.40 | 354 | 5.37¢ | 4.29¢ | 57.0% | 50.0% | −11% |
| Plus | $59 | $566.40 | 1,102 | 5.35¢ | 4.28¢ | 57.9% | 50.0% | −6% |
| Ultra | $129 | $1,238.40 | 2,411 | 5.35¢ | 4.28¢ | 58.2% | 50.0% | 0% |

The curve is flat to falling (5.41¢ down to 5.35¢) and no longer inverted. Yearly is at least 50% on every tier. The cost: Lite, Starter and Plus carry 6–11% fewer credits than today, because today they get only 10–15% off yearly. Monthly margin is 56–58%, so there is room to lower row prices without touching the floor.

## Before any of this ships

1. Yearly floor: B takes yearly below the owner's 50% rule (ADR-0014/0037). The owner must say whether 40% worst-case on yearly is acceptable.
2. Four video/image rows look under 50% on old recorded costs: Veo 3.1 Lite, Veo 3.1 Fast, Seedream, Seedance 2.0 Fast. Re-read provider invoices first; repricing those rows lowers the worst-case cost per credit and creates room for every option.
3. Packs: ADR-0312 ties packs to the best monthly plan rate, and the $10 pack ceiling is 217 credits, so packs cannot reach 4.3¢. The parity guard in 0420 needs a decision of its own.
4. Store plans (Apple/Google, ADR-0312 amendment 1) carry 15–30% fees and need their own price points; they are not covered here.
5. Existing subscribers: new rows with new ids, old rows deactivated (the 0121, 0365, 0420 pattern); nobody's current plan changes silently.
6. Needs: an ADR, a migration with exact-shape guards and asserted row counts, number of the migration taken from `main` after checking open PRs, and a flagged rollout.
