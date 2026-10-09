// The sums behind scripts/check-fal-catalog.mjs: the prices on a fal model
// page against one catalog row. No network here, so `npm test` covers it
// (tests/falPriceCheck.test.mjs).

export const REFERENCE_DOLLARS_PER_CREDIT = 0.033;
export const MARGIN_FLOOR = 0.5;
// fal rounds and re-tiers often; only shout when the move is real.
const RELATIVE_TOLERANCE = 0.05;
const ROUNDING_ALLOWANCE = 0.0005;

/**
 * Pull candidate USD prices out of a fal model page. fal has no pricing
 * API and the markup changes, so we collect every price token and let
 * the caller decide which unit applies.
 *
 * Credit-pack and plan prices ($1 / $2 / $15 / $24 ...) pollute the set,
 * so drop round dollar amounts >= $1 — no per-unit fal rate is a whole
 * dollar, and the expensive video rows are matched on their per-second
 * rate rather than the clip total.
 */
export function extractPrices(html) {
    const out = new Set();
    for (const m of html.matchAll(/\$([0-9]+(?:\.[0-9]+)?)/g)) {
        const v = Number(m[1]);
        if (v <= 0 || v > 50) continue;
        if (v >= 1 && Number.isInteger(v)) continue; // credit packs / plans
        out.add(v);
    }
    return [...out].sort((a, b) => a - b);
}

/**
 * The comparison unit. For per-second rows the page quotes a rate, so we
 * divide our recorded total by billing_seconds before matching — this is
 * exactly the mistake migration 0021 had to undo. A row listed in
 * `unitRates` is recorded per generation while fal quotes a rate: it is
 * matched on that rate, and `built` is what the rate comes to for one
 * generation.
 */
export function comparisonRate(row, unitRates = {}) {
    const total = Number(row.provider_cost_per_unit);
    const listed = unitRates[row.id];
    if (listed) {
        const { rate, per, quantity, multiplier = 1 } = listed;
        const unit = `/${per} x ${quantity}${multiplier === 1 ? '' : ` x ${multiplier}`}`;
        return { rate, unit, total, built: rate * quantity * multiplier };
    }
    if (row.cost_unit === 'per_second') {
        const secs = Number(row.billing_seconds) || 5;
        return { rate: total / secs, unit: `/s x ${secs}s`, total };
    }
    return { rate: total, unit: 'per generation', total };
}

export function marginAt(costUsd, credits) {
    const retail = credits * REFERENCE_DOLLARS_PER_CREDIT;
    return retail > 0 ? (retail - costUsd) / retail : -1;
}

/** Smallest credit count that still clears the floor at the given cost. */
export function creditsForFloor(costUsd) {
    return Math.ceil((costUsd / (1 - MARGIN_FLOOR)) / REFERENCE_DOLLARS_PER_CREDIT);
}

const near = (value, target, allowance) => Math.abs(value - target) <= Math.max(allowance, target * RELATIVE_TOLERANCE);

// Two prices read as the same figure.
const SAME = 1e-9;

/**
 * One catalog row against the prices on its fal page.
 *
 * verdict  'breach' (recorded cost under the floor), else 'drift' (the page
 *          does not show the rate we expect), else 'ok'
 * cost     for a row in `unitRates` whose recorded cost is not what the rate
 *          comes to, or hides that the row is under the floor at the rate:
 *          that figure and the margin at it. Null otherwise.
 */
export function checkRow(row, prices, unitRates = {}) {
    const credits = Number(row.credits_5s);
    const { rate, unit, total, built } = comparisonRate(row, unitRates);
    const listed = built !== undefined;
    const margin = marginAt(total, credits);
    // A listed rate is copied from the page, so only that figure will do. The
    // allowance a recorded cost gets would cover $0.0002 rising to $0.0007,
    // and a twentieth is more than the thinnest row clears the floor by.
    const shown = prices.some((p) => (listed ? Math.abs(p - rate) < SAME : near(p, rate, ROUNDING_ALLOWANCE)));
    let verdict = 'ok';
    if (margin < MARGIN_FLOOR) verdict = 'breach';
    // An unlisted row whose page carries no price cannot be compared. A
    // listed one is known to show its rate, so its absence is a change.
    else if (!shown && (listed || prices.length > 0)) verdict = 'drift';
    let cost = null;
    if (listed) {
        const builtMargin = marginAt(built, credits);
        const hidesBreach = builtMargin < MARGIN_FLOOR && margin >= MARGIN_FLOOR;
        if (hidesBreach || !near(total, built, ROUNDING_ALLOWANCE)) cost = { built, margin: builtMargin };
    }
    return { id: row.id, listed, rate, unit, total, credits, margin, verdict, seen: prices.slice(0, 8), cost };
}

const percent = (fraction) => (fraction * 100).toFixed(1);

/** What a COST? finding says, shared by the row line and the summary. */
export function costSentence(r) {
    return `records $${r.total.toFixed(4)}, $${r.rate.toFixed(4)} ${r.unit} = $${r.cost.built.toFixed(4)}`;
}

/** The report lines for one checked row. */
export function rowLines(r) {
    const id = r.id.padEnd(20);
    const lines = [];
    if (r.verdict === 'breach') lines.push(`BREACH ${id} margin ${percent(r.margin)}% < ${MARGIN_FLOOR * 100}%`);
    if (r.verdict === 'drift') {
        const page = r.seen.length ? r.seen.map((p) => '$' + p).join(' ') : 'no price';
        lines.push(`DRIFT? ${id} expect $${r.rate.toFixed(4)} ${r.unit}  page: ${page}`);
    }
    if (r.cost) {
        const under = r.cost.margin < MARGIN_FLOOR ? ` < ${MARGIN_FLOOR * 100}%` : '';
        lines.push(`COST?  ${id} ${costSentence(r)}  ${r.credits}cr  margin ${percent(r.cost.margin)}% at that cost${under}`);
    } else if (r.verdict === 'ok') {
        lines.push(`ok    ${id} $${r.rate.toFixed(4)} ${r.unit.padEnd(14)} ${r.credits}cr  margin ${percent(r.margin)}%`);
    }
    return lines;
}

export const DRIFT_MODES = ['false', 'listed', 'all'];

/**
 * How many findings fail the run. A dead endpoint and a recorded cost under
 * the floor always do. What fal's own rate says does only when asked for:
 *
 *   'listed'  a moved rate on a row in `unitRates`, where the figure to look
 *             for is exact, and a listed row that is under the floor at fal's
 *             rate while its recorded cost says otherwise
 *   'all'     those, and drift on every other row. A stray figure on fal's
 *             pages reads as drift on a row whose own page shows no price,
 *             so this one files on noise.
 */
export function failingCount({ dead, breach, drift, listedDrift, underFloor }, mode) {
    if (mode === 'all') return dead + breach + drift + underFloor;
    if (mode === 'listed') return dead + breach + listedDrift + underFloor;
    return dead + breach;
}
