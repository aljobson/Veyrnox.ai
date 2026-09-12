# ADR-0014 — Floor pricing: every model at the 50% margin minimum

Status: **accepted** — 2026-09-12 (Al: "go with recommendation, most cost-effective")

## Context

A price check against kie.ai (wholesale API reseller, 1 credit = $0.005)
showed Veyrnox.ai at 4–10× on image models and 2–4× on video. Our
catalog carried 60–85% margins on top of fal cost; CLAUDE.md's floor is 50%
at the $0.033/credit reference rate.

## Decision

Reprice every active row to the **minimum whole credits that clear the
50% floor** at $0.033/credit, and add `veo-3.1-fast` (`fal-ai/veo3.1/fast`,
$0.75 per 5s 1080p+audio) as a cheaper Veo option.

| id | fal cost | credits (was → now) | price | margin |
|---|---|---|---|---|
| wan-2.5 | $0.25 | 19 → 16 | $0.528 | 52.7% |
| seedance-2.0-fast | $0.45 | 37 → 28 | $0.924 | 51.3% |
| kling-2.6-pro | $0.35 | 28 → 22 | $0.726 | 51.8% |
| kling-3.0-i2v | $0.50 | 40 → 31 | $1.023 | 51.1% |
| minimax-h3 | $0.30 | 25 → 19 | $0.627 | 52.2% |
| veo-3.1 (Standard, gated) | $2.00 | 152 → 122 | $4.026 | 50.3% |
| veo-3.1-fast (new) | $0.75 | — → 46 | $1.518 | 50.6% |
| flux-2-pro | $0.03 | 4 → 2 | $0.066 | 54.5% |
| seedream-4 | $0.04 | 4 → 3 | $0.099 | 59.6% |
| nano-banana | $0.06 | 6 → 4 | $0.132 | 54.5% |
| ace-step | $0.01 | 2 → 1 | $0.033 | 69.7% |

Plan tiers (Starter $0.075/cr, Plus $0.039/cr, Ultra $0.033/cr) unchanged;
Ultra is the only tier that sells at exactly the reference rate.

## Consequences

- Margin validator (`packages/catalog/margin-validator.ts`) still passes;
  no row below 50%.
- Any fal price rise on a floor-priced row breaches immediately — the
  daily dep-audit should include a fal price re-check (follow-up).
- Landing/pricing tiles read `/api/catalog` live; `app/veyrnox/_lib/tokens.js`
  fallback credits need a sync (design peer).
- Migration `0018_floor_pricing_and_veo_fast.sql`.
