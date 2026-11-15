# ADR-0343: One plan and pack price list on web, iOS and Android; yearly 20% off; 50% margin on every channel

Status: proposed 2026-11-15; the owner chose the rules in chat. Migrations 0539, 0540 and 0541 are drafted, not applied. Amends [ADR-0064](0064-core-subscriptions.md), [ADR-0312](0312-packs-at-subscription-rate.md) and migrations 0381, 0383, 0407.

## Context

Yearly discounts were 10% (Lite, Starter), 15% (Plus) and 20% (Ultra), so the monthly price per credit rose with plan size. The owner set four rules: web and mobile pricing are identical (price and credits); every plan and pack keeps a 50% worst-case margin, in the stores too; yearly is 20% off; packs follow the plans.

The binding limit is the store yearly plan. After Apple's and Google's 15% fee (Small Business Program) with every credit at the repo's worst-case provider cost of $0.01796, credits a month must satisfy `credits <= yearly price * 0.35 / (12 * 0.01796)`. The web fee (8% + $0.30) leaves more room, so the stores set the credits for everyone. At the plans we sold before, the stores kept about 43%.

## Decision

| Plan | Monthly | Yearly sold | Yearly discount | Credits a month | Monthly per credit | Yearly per credit |
|---|---:|---:|---:|---:|---:|---:|
| Lite | $10 | $96.99 | 19.2% | 157 | 6.37¢ | 5.15¢ |
| Starter | $19 | $182.99 | 19.7% | 297 | 6.40¢ | 5.13¢ |
| Plus | $59 | $569.00 | 19.6% | 924 | 6.39¢ | 5.13¢ |
| Ultra | $129 | $1,238.40 | 20.0% | 2,011 | 6.41¢ | 5.13¢ |

The yearly price is the exact 20% price ($96, $182.40, $566.40, $1,238.40) rounded up to the next App Store point, as in 0407 and charged identically on the web. **$96.99, $182.99 and $569.00 are unverified**: confirm each exists in App Store Connect and Play before 0539 applies. Ultra is above the App Store maximum and stays web and Android only. The monthly plan carries the same credits as the yearly plan.

Worst-case margins:

| Plan | Web monthly | Web yearly | Store monthly | Store yearly |
|---|---:|---:|---:|---:|
| Lite | 60.8% | 56.8% | 56.8% | 50.1% |
| Starter | 62.3% | 56.9% | 56.9% | 50.0% |
| Plus | 63.4% | 56.9% | 56.9% | 50.0% |
| Ultra | 63.8% | 57.0% | 57.0% | 50.0% |

Packs follow the best plan rate (Lite, 0.157 credits a cent), rounded down, at the App Store consumable points so web and stores match exactly (the store has no $10.00 / $25.00 / $75.00):

| Pack | Was (web) | Now (web, iOS, Android) | Per credit | Web margin | Store margin |
|---|---|---|---:|---:|---:|
| Small | $10 / 209 | $9.99 / 156 | 6.40¢ | 61.0% | 57.0% |
| Medium | $25 / 523 | $24.99 / 392 | 6.38¢ | 62.6% | 56.8% |
| Large | $75 / 1,571 | $74.99 / 1,177 | 6.37¢ | 63.4% | 56.8% |

## Consequences

- **A credit costs about 18–20% more than in the earlier draft and 20–33% more than on today's live monthly plans (Ultra +20%, Lite and Starter +33%).** Credits fall 17–25% (Lite 209 to 157, Starter 398 to 297, Plus 1,171 to 924, Ultra 2,411 to 2,011; the $10 pack 209 to 156). That is the price of holding 50% in the stores at an identical price with a 20% yearly discount. Relaxing any of the four rules lifts it: a smaller yearly discount, or a lower store margin, or different store prices.
- Margins above are higher than 50% on the web and on monthly plans; that slack is where per-row prices can come down without touching the floor.
- Running subscriptions keep their own price and credits snapshot (0186). Stripe prices are inline, so none change. Store plan rows are the same rows, so no store product moves.
- New store pack products `ai.veyrnox.credits.156/392/1177` must exist in App Store Connect, Play Console and RevenueCat before an app build offers them.
- Needs the Small Business Program (15%); at 30% no plan or pack here holds 50% in the stores.
- Pinned tests and the store catalog generator (`scripts/store-billing-catalog.mjs`), the mobile pack list (`WEB_PARITY_PACK_CREDITS`) and the pricing UI still read the old numbers.
- Four rows (Veo 3.1 Lite, Veo 3.1 Fast, Seedream, Seedance 2.0 Fast) look under 50% on old costs; check provider invoices.
- Apply order: 0539, then 0540, then 0541 (0540 refuses to run before 0539).
- Rollback: forward migrations restoring 209 / 398 / 1,171 / 2,411 credits, yearly 10899 / 20900 / 60900, and reactivating the old packs.
