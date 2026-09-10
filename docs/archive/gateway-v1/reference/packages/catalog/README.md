# packages/catalog

Single source of truth for models, prices, credits, and provider costs.

## Data

Source: `docs/platform_model_v2.xlsx`

- `models.ts` — Model definitions (id, name, modality, input params schema)
- `prices.ts` — Credit costs and plan pricing
- `providers.ts` — Provider cost bases and margin floors

All code reads from this package; never hardcode prices elsewhere.
