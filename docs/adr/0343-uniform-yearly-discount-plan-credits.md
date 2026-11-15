# ADR-0343: Every yearly plan gets 20% off, and every plan holds a 50% margin

Status: proposed 2026-11-15; the owner chose the rule in chat ("20% discount on yearly but we need 50% margin"). Migration 0539 is drafted, not applied. Amends [ADR-0064](0064-core-subscriptions.md) and migrations 0381 and 0383.

## Context

Yearly discounts were 10% (Lite, Starter), 15% (Plus) and 20% (Ultra). Because each plan's credits were held to the yearly 50% limit, the monthly price per credit rose with plan size: 4.78¢, 4.77¢, 5.04¢, 5.35¢. Higgsfield (secondary sources) sells 3,000 credits for $129 a month. At a hard 50% worst-case margin (cost per credit $0.01796, 8% + $0.30 fee) both floors are about 4.3¢ a credit, so a better monthly rate and a yearly discount cannot both hold. The owner kept the 50% rule and asked for 20% off yearly.

## Decision

Every yearly plan is exactly 80% of twelve monthly payments. Credits a month are the most the yearly price holds at 50%: `floor((0.42 × yearly price − 0.30) / (12 × 0.01796))`. The monthly plan carries the same credits.

| Plan | Monthly | Yearly sold | Exact 20% | Discount | Credits a month | Monthly margin | Yearly margin (web) | Credits vs now |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Lite | $10 | $96.99 | $96.00 | 19.2% | 185 | 55.8% | 50.6% | −11% |
| Starter | $19 | $182.99 | $182.40 | 19.7% | 354 | 57.0% | 50.1% | −11% |
| Plus | $59 | $569.00 | $566.40 | 19.6% | 1,102 | 57.9% | 50.2% | −6% |
| Ultra | $129 | $1,238.40 | $1,238.40 | 20.0% | 2,411 | 58.2% | 50.0% | 0% |

Owner, 2026-11-15: round yearly up to the next App Store point, as in 0407, and charge the same on the web. Credits are not raised for the extra cents. **The points $96.99, $182.99 and $569.00 are unverified**: confirm each exists in App Store Connect and Play before 0539 applies. Ultra is above the App Store maximum and stays web-only.

**Store yearly plans (owner, 2026-11-15: 50% after the store fee too).** Store buyers pay the same price as web buyers, so store yearly plans carry fewer credits (migration 0542, new plan rows `*-yearly-store`, the seven annual store products re-pointed to them):

| Plan | Price | Store credits a month | Web credits a month | Store margin at 15% |
|---|---:|---:|---:|---:|
| Lite | $96.99 | 157 | 185 | 50.2% |
| Starter | $182.99 | 297 | 354 | 50.0% |
| Plus | $569.00 | 924 | 1,102 | 50.0% |
| Ultra (Android only) | $1,238.40 | 2,011 | 2,411 | 50.0% |

Monthly store plans already hold 50% at 15% and are unchanged. A store yearly buyer therefore gets 15–17% fewer credits than a web buyer for the same price, which the store paywall should say. The plans API list limit rises from 10 to 20 rows (`lib/subscriptions/api.js`) because the store rows are active; the web checkout still offers only the plans in `LAUNCH_PLANS`.

Monthly price per credit is 5.41¢, 5.37¢, 5.35¢, 5.35¢ (flat to falling); yearly is 4.28–4.32¢.

## Consequences

- Lite, Starter and Plus carry 6–11% fewer credits than today. Ultra is unchanged. Running subscriptions keep their price and credits snapshot (0186).
- **Packs follow the plans (owner, 2026-11-15).** ADR-0312 sells packs at the best monthly plan's rate, rounded down. The best rate is now Ultra's (2,411 credits for $129), so the credits fall. Owner, same day: iOS and Android sell at the same price as web. The App Store has no $10.00 / $25.00 / $75.00 consumable points, so the web moves to $9.99 / $24.99 / $74.99:

  | Channel | Now | After | Per credit | Worst-case margin |
  |---|---|---|---:|---:|
  | Web | $10 / 209, $25 / 523, $75 / 1,571 | $9.99 / 186, $24.99 / 467, $74.99 / 1,401 | 5.37¢, 5.35¢, 5.35¢ | 55.6%, 57.3%, 58.1% (8% + $0.30) |
  | iOS and Android | $10.99 / 209, $26.99 / 523, $89.99 / 1,571 | $9.99 / 186, $24.99 / 467, $74.99 / 1,401 (same as web) | 5.37¢, 5.35¢, 5.35¢ | 51.6%, 51.4%, 51.4% (15% fee) |

  Migrations 0540 (web) and 0541 (store) add new pack ids and retire the old ones by exact shape. Apply 0539, then 0540, then 0541; 0540 refuses to run before 0539. Store products `ai.veyrnox.credits.186/467/1401` are new and must exist in App Store Connect, Play Console and RevenueCat before an app build offers them. This is a 11% cut in credits per pack for the entry size and Starter-priced buyers; it follows from your rule that plans and packs share one rate.
- **Open: store prices.** App Store and Play yearly prices ($108.99, $209, $609 and Android equivalents) are set in the stores. They need the matching points ($96, $182.40, $566.40 are not App Store points, so the next point up applies as in 0407) and a margin check at the store fee. Until then store buyers pay the old yearly price for fewer credits, which only raises margin.
- **Open: provider cost.** The $0.01796 cap is the repo's recorded worst case. Four rows (Veo 3.1 Lite, Veo 3.1 Fast, Seedream, Seedance 2.0 Fast) look under 50% on old costs; check invoices before relying on the plan margins in practice.
- Pinned tests and the store catalog generator (`scripts/store-billing-catalog.mjs`) read 0383/0385/0407 values and must read 0539.
- Rollback: a forward migration restoring 209 / 398 / 1,171 credits and yearly 10899 / 20900 / 60900.
