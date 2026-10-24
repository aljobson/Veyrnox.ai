/**
 * OpenRouter price readings for the routed video rows (ADR-0256 phase 4c).
 *
 * OpenRouter publishes video prices as a machine-readable list (GET /api/v1/videos/models,
 * `pricing_skus`, dollars per video token), so a recorded cost can be checked without a key.
 * Pure: the script fetches, this compares. One row is routed through OpenRouter today:
 * Seedance 2.0 Fast, 5 s at 720p 16:9 = 108,000 video tokens (packages/adapters/openrouter.js).
 */

export const OPENROUTER_ROWS = [
    { id: 'seedance-2.0-fast', slug: 'bytedance/seedance-2.0-fast', tokens: 108000, sku: 'video_tokens_without_audio' },
];

/**
 * @param {{id:string, slug:string, tokens:number, sku:string}} row
 * @param {object[]} models the `data` array of /api/v1/videos/models
 * @param {number} recordedCost the route's recorded cost per generation
 * @param {number} [tolerance] relative drift tolerated, 1% by default
 * @returns {{id:string, status:'ok'|'drift'|'missing', observed?:number, recorded:number, drift?:number}}
 */
export function checkOpenRouterRow(row, models, recordedCost, tolerance = 0.01) {
    const model = models.find((m) => m.id === row.slug);
    const price = model && model.pricing_skus && Number(model.pricing_skus[row.sku]);
    if (!price || !Number.isFinite(price)) return { id: row.id, status: 'missing', recorded: recordedCost };
    const observed = Math.round(price * row.tokens * 1e6) / 1e6;
    const drift = recordedCost > 0 ? (observed - recordedCost) / recordedCost : Infinity;
    return { id: row.id, status: Math.abs(drift) > tolerance ? 'drift' : 'ok', observed, recorded: recordedCost, drift: Math.round(drift * 1e4) / 1e4 };
}
