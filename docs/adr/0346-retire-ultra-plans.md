# ADR-0346: Retire Ultra sales and preserve existing subscriptions

Status: implemented for review, 2026-11-16; migrations not applied, deployment and store changes not performed.

## Decision

The owner requires identical web and store prices and has decided to drop Ultra because its $1,238.40 yearly price exceeds the owner's stated $1,000 Apple price ceiling. Lite ($10 / $96.99), Starter ($19 / $182.99, Recommended), and Plus ($59 / $569) remain at [ADR-0343](0343-uniform-yearly-discount-plan-credits.md) prices and credits. Historical tables and applied migrations remain unchanged.

0545 adds nullable `retired_at` and replaces the nine-argument store event RPC with a ten-argument function whose final named `p_purchased_at` argument defaults to NULL. It deactivates nothing. Old callers still resolve using the default; the new webhook must not deploy before 0545. The owned-subscription read also returns the plan's interval, including inactive plans.

0549 retires exactly Ultra monthly and yearly, keeps the first retirement timestamp on replay, and asserts that only the six Lite/Starter/Plus rows remain active at ADR-0343 figures. No plans, mappings, balances or ledger records are deleted or directly rewritten. "Deactivating mappings" means refusing new purchases through the mapped plan's active flag; mapping rows remain for audit and settlement.

Web APIs and stale client catalogs exclude Ultra. Mobile custom cards exclude it, native paywalls with retired packages fall back to Credits, and both purchase gates reject it before store calls. Legacy names, translations, paid entitlements, and 60 Music downloads per month remain supported. Readiness accepts legacy entitlement attachments and warns "retired product still in offering" for stale offerings; a warning is not proof that sales have stopped.

## Existing subscribers and delayed deliveries

Existing Ultra subscriptions retain their own snapshot price and credits on same-product renewals, uncancellations and billing-period events. No forced cancellation, migration, refund or proration occurs. Existing Stripe renewal, refund, dispute, cancellation, expiration and yearly-cycle paths continue using the subscription snapshot. Owner-initiated termination of store renewals must use store tools.

New rows and switches to a different inactive plan require that plan's `retired_at`, a validated non-null store purchase time strictly before the cutoff, and an effective `initial_purchase` or `renewal` event. Event occurrence time is only for ordering. Same-product legacy renewals do not need the cutoff exception. Unmapped products fail. Active target behavior remains unchanged; switching away from Ultra remains supported. Missing/invalid purchase time or a purchase at/after cutoff is refused with `PLAN_NOT_FOUND`. The webhook already logs and acknowledges this permanent refusal; the owner must refund a charged refused purchase in the store.

**Disclosed deviation from R9:** the current adapter maps every `PRODUCT_CHANGE` to activate and has no verified applied/scheduled discriminator. [RevenueCat documents it as informational](https://www.revenuecat.com/docs/subscription-guidance/managing-subscriptions), with effective changes followed by renewal (Apple) or initial purchase (Google). A standalone product-change event therefore cannot qualify for the retired-target exception. The effective purchase/renewal may qualify. Active-target product changes retain existing behavior. Do not infer purchase completion from `new_product_id` or event ordering timestamps.

## Required rollout (owner, separate from this source-only work)

1. Stop Ultra sales in App Store Connect, Play and RevenueCat and confirm closure. The parent session owns this. Old app builds can show cached offerings until closure; “no new purchases” is only true after this prerequisite.
2. Apply **0545 only** through `apply-migrations`.
3. Merge/deploy the web/mobile code and verify that the webhook forwards validated purchase time. Do not advance while old callers remain.
4. Retire: in a follow-up PR move `docs/operations/0549_retire_ultra_plans.sql` into `packages/db/schema/supabase/` (recheck the number against main) and apply it through `apply-migrations`.

**Rollout control:** `apply-migrations` applies every pending file, so 0549 is held at `docs/operations/0549_retire_ultra_plans.sql`, outside the migrations folder, and ships only in the follow-up in step 4. Until step 2, new webhook code calling the 9-argument function fails the RPC call and RevenueCat retries it, so merge and apply 0545 close together. This work makes no workflow or dashboard changes and applies no production SQL.

## Owner questions and exclusions

The number of Ultra subscribers on Stripe, Apple monthly, and Google monthly/yearly is unknown; production data was not read. Grandfathering at the snapshot terms is recommended. A sunset needs an explicit owner policy and store renewal closure, with customer/refund handling decided separately. Remove Ultra from offerings/listings during the store closure step.

Out of scope: store/Stripe/RevenueCat dashboards, production changes or subscriber queries; `packages/catalog/index.ts` margin model; historical `scripts/audit-pricing-parity.mjs` and `tests/pricingParity.test.mjs`; `docs/pricing/`, `docs/archive/`, and template prose.

The ADR README/baseline are frozen. The generated index discovers this standalone ADR without modifying them.
