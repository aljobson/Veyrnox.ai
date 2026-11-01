# ADR-0312: One-off Credit Packs are sold at the monthly subscription rate

Status: accepted by the owner 2026-11-01 (chat). Migrations 0420 (web) and 0421 (iOS and Android) replay cleanly on a fresh Postgres; neither is applied. Amends the 2026-10-24 correction in [ADR-0064](0064-core-subscriptions.md).

## Context

ADR-0064 (corrected 2026-10-24, migration 0382) required every recurring plan to be strictly cheaper per credit than the best one-off pack. In 2026-11 the live prices were:

| | price | credits | per credit |
|---|---|---|---|
| Packs | $10 / $25 / $75 | 100 / 300 / 1,000 | 10.0¢ / 8.3¢ / 7.5¢ |
| Monthly plans | $10 / $19 / $59 / $129 | 209 / 398 / 1,171 / 2,411 | 4.8¢ / 4.8¢ / 5.0¢ / 5.4¢ |
| Yearly plans (monthly share) | $109 / $209 / $609 / $1,238 | same | 4.3¢–4.4¢ |

A $10 pack bought 100 credits where a $10 Lite plan buys 209. The owner asked for parity between top-ups and subscriptions, with the 50% minimum margin kept.

## Decision

A web pack gives the same credits per dollar as the best monthly plan (Starter: 398 credits for $19), rounded down so a pack is never cheaper per credit than a plan. The three price points do not change.

| retired | new | per credit | worst-case margin |
|---|---|---|---|
| web-100 ($10, 100) | web-209 ($10, 209) | 4.78¢ | 51.5% |
| web-300 ($25, 300) | web-523 ($25, 523) | 4.78¢ | 53.2% |
| web-1000 ($75, 1,000) | web-1571 ($75, 1,571) | 4.77¢ | 54.0% |

Margin is the owner's rule from ADR-0037: after an 8% + $0.30 fee, with every credit carrying the catalog's worst-case provider cost of $0.01796, half of the price remains (`price_cents*420 - 30000 >= credits*1796`). The ceiling at these prices is 217, 567 and 1,737 credits. The new packs also clear `credit_packs_sticker_floor` (0121) and the legacy net floor (0041).

Migration 0420 follows the 0121 and 0365 rule: new ids, old rows deactivated and never rewritten, exact-shape guards with asserted row counts, a margin guard on every active web pack, and a parity guard (each active web pack sits within 1% of, and never below, some active monthly plan's rate).

What a plan still offers that a pack does not: a plan is cheaper only when yearly. Monthly plans no longer beat packs on price; Subscription Credits refresh monthly and expire with the billing period, Pack Credits never expire.

## Consequences

- Plans no longer show a saving against packs. `subscriptionSavingPercent` returns nothing when the saving rounds to under 1% (Starter would otherwise read "Save 1%" from a 0.0002% gap).
- Pack cards: with near-equal rates the "Save N%" badge disappears; "Best value" lands on the 1,571 pack by a 0.2% margin. Revisit if that reads as misleading.
- Two sentences that claimed plans cost less per credit than packs are reworded in all 11 languages (`pricing.subs.valueLead`, `pricing.packs.valueLead`). New wording is machine-drafted: it needs native review like the rest of the site translation.
- Rollback is a forward migration that reactivates web-100, web-300 and web-1000.

## Amendment 1, 2026-11-01: store packs carry the same credits as web

Owner: the store packs must be aligned with the web packs, and the 50% rule holds after the store's fee. Store fees are 15% (Small Business Program) or 30%, not the web's 8% + $0.30, so the same credits need higher store prices. At 15%, with no flat fee, a pack must satisfy `price_cents*350 >= credits*1796`: at least $10.72 / $26.84 / $80.61 for 209 / 523 / 1,571 credits. The next App Store price points are used. Outside the US, Apple's consumable tiers in this range are $79.99 / $89.99 / $99.99, so $80.99 would apply to the US only; $79.99 breaks the margin. The largest pack is therefore the worst value per credit in the store (5.26¢, 5.16¢, 5.73¢); "Best value" goes on the 523 pack in the store paywall. Making 1,571 the best value needs more credits, which is a new product:

| store product | credits | store price | web price | worst-case margin at 15% |
|---|---|---|---|---|
| `ai.veyrnox.credits.209` | 209 | $10.99 | $10 | 50.9% |
| `ai.veyrnox.credits.523` | 523 | $26.99 | $25 | 50.2% |
| `ai.veyrnox.credits.1571` | 1,571 | $89.99 | $75 | 54.9% |

- **New products.** A store product id is permanent and the app reads the credit count from it, so these are new products. `ai.veyrnox.credits.100/300/1000` (and their $9.99 / $24.99 / $74.99 prices) are retired: the rows stay, inactive, so a refund or delayed event for an old transaction still resolves.
- **Migration 0421** adds `ios-` and `android-` rows for the three sizes, retires the old six by exact shape, and guards margin at 15% and that web, iOS and Android sell the same sizes.
- **Needs the Small Business Program.** At the standard 30% fee none of these prices holds 50%. They still clear the existing net floor (`credit_packs_net_floor`, 0344), which is written against 30%.
- **App and catalog.** `WEB_PARITY_PACK_CREDITS` in `apps/mobile/src/lib/billing.ts` becomes `[209, 523, 1571]`; `scripts/store-billing-catalog.mjs` reads the packs from 0421. An app build made before this merges shows no new packs, and a new build shows none until the new products exist in App Store Connect and RevenueCat.
