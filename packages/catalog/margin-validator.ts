/**
 * Margin floor validator — §5.10 gate.
 *
 * Every catalog row must satisfy:
 *   credits × REFERENCE_DOLLARS_PER_CREDIT ≥ provider_cost_usd × (1 + MARGIN_FLOOR)
 *
 * i.e. our retail credit price (converted to USD at the Ultra plan's rate)
 * covers the provider's cost plus a minimum gross margin. Anything below
 * the floor means we lose money on that model at Ultra-tier subscription
 * usage, and it must be repriced or gated.
 *
 * Called from CI (via a test) and can be called at runtime when the catalog
 * is edited.
 */

import {
    CATALOG,
    MARGIN_FLOOR,
    REFERENCE_DOLLARS_PER_CREDIT,
    type CatalogRow,
} from "./index.ts";

export interface MarginBreach {
    id: string;
    name: string;
    provider_cost_usd: number;
    credits: number;
    retail_at_ref_rate_usd: number;
    required_min_usd: number;
    shortfall_usd: number;
    /** Actual margin as a fraction of retail — negative means loss. */
    actual_margin_frac: number;
}

/**
 * Return the list of catalog rows that breach the margin floor. Empty = healthy.
 * Rows with provider_cost_usd == 0 are skipped (free or self-hosted models).
 */
export function findMarginBreaches(
    rows: readonly CatalogRow[] = CATALOG,
    floor: number = MARGIN_FLOOR,
    dollarsPerCredit: number = REFERENCE_DOLLARS_PER_CREDIT
): MarginBreach[] {
    const breaches: MarginBreach[] = [];
    for (const row of rows) {
        if (row.provider_cost_usd <= 0) continue;
        const retailUsd = row.credits * dollarsPerCredit;
        const requiredMin = row.provider_cost_usd * (1 + floor);
        if (retailUsd < requiredMin) {
            const margin = (retailUsd - row.provider_cost_usd) / retailUsd;
            breaches.push({
                id: row.id,
                name: row.name,
                provider_cost_usd: row.provider_cost_usd,
                credits: row.credits,
                retail_at_ref_rate_usd: Number(retailUsd.toFixed(4)),
                required_min_usd: Number(requiredMin.toFixed(4)),
                shortfall_usd: Number((requiredMin - retailUsd).toFixed(4)),
                actual_margin_frac: Number(margin.toFixed(4)),
            });
        }
    }
    return breaches;
}

/**
 * CI-friendly summary — every row's margin at the reference rate, sorted
 * ascending by margin. Useful for the CI output even when nothing breaches.
 */
export interface MarginSummaryRow {
    id: string;
    provider_cost_usd: number;
    credits: number;
    retail_at_ref_rate_usd: number;
    actual_margin_frac: number;
    healthy: boolean;
}

export function marginSummary(
    rows: readonly CatalogRow[] = CATALOG,
    floor: number = MARGIN_FLOOR,
    dollarsPerCredit: number = REFERENCE_DOLLARS_PER_CREDIT
): MarginSummaryRow[] {
    return rows
        .filter((r) => r.provider_cost_usd > 0)
        .map((r) => {
            const retailUsd = r.credits * dollarsPerCredit;
            const margin = (retailUsd - r.provider_cost_usd) / retailUsd;
            return {
                id: r.id,
                provider_cost_usd: r.provider_cost_usd,
                credits: r.credits,
                retail_at_ref_rate_usd: Number(retailUsd.toFixed(4)),
                actual_margin_frac: Number(margin.toFixed(4)),
                healthy: retailUsd >= r.provider_cost_usd * (1 + floor),
            };
        })
        .sort((a, b) => a.actual_margin_frac - b.actual_margin_frac);
}
