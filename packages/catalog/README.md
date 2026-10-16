# @veyrnox/catalog

Normative pricing + model catalog for the Veyrnox gateway.

## Sources

- **Plans** — the Starter/Plus/Ultra tiers accepted in ADR-0064 ($19/270, $59/1,200, $129/3,000). Not sold yet.
- **Model Catalog** (same xlsx, "Model Catalog" sheet) — provider cost, retail price, and LAUNCH / GATE / SKIP recommendation per model

The xlsx is external (kept in `docs/pricing/` or the founder's local storage — not checked in). Values here are hand-transcribed; the `margin_floor` CI job catches drift.

## Files

- `index.ts` — typed `PLANS`, `CATALOG`, `MARGIN_FLOOR`, `REFERENCE_DOLLARS_PER_CREDIT`, `SKIPPED_MODELS`
- `margin-validator.ts` — `findMarginBreaches()`, `marginSummary()` — pure functions
- `margin-validator.test.ts` — CI gate: every catalog row must clear MARGIN_FLOOR at REFERENCE_DOLLARS_PER_CREDIT

## Pricing math

- Reference rate: **$0.033 / credit**, the net floor the credit-pack constraints keep (0041, 0121). It is below every plan's rate (Ultra is $0.043).
- Credit price per model: `ceil(retail_usd / 0.033)`
- Margin floor: `credits × 0.033 ≥ provider_cost × (1 + 0.5)` — 50% gross margin over provider cost

At the reference rate every current LAUNCH row clears 58–70% gross margin.

## Adding or repricing a model

1. Update the xlsx (out of tree, out of repo)
2. Edit `CATALOG` in `index.ts` — set `provider_cost_usd`, `retail_usd`; call `usdToCredits` for the credit price
3. Change the live `model_catalog` row with a numbered migration in `packages/db/schema/supabase/` (the DB, not this file, prices real jobs). `UPDATE`s from 0111 onward must assert their row count (`scripts/check-catalog-update-guards.mjs`). `0002_model_catalog_seed.sql` only seeds a local test database.
4. `npm install --no-save tsx && npx tsx --test packages/catalog/margin-validator.test.ts` — must pass
5. Commit the file and the migration in the same change; the `ledger-tests` workflow runs the margin test

## Deferred models

`SKIPPED_MODELS` documents models the pricing sheet marked SKIP with the reason. Do not re-add without a fresh sheet update. Sora 2 / Pro (post-OpenAI MSA change) and Soul 2.0 (Higgsfield in-house, unlicensable) are the current entries.
