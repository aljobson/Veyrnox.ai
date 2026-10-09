// The sums behind scripts/check-fal-catalog.mjs: the prices on a fal model
// page against one catalog row. No network here, so `npm test` covers it
// (tests/falPriceCheck.test.mjs, tests/falBasePrice.test.mjs).

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

/**
 * fal's own billing figure for an endpoint, from its model page. The page
 * payload carries it as an object keyed endpointBilling (twice) and
 * publicEndpointBilling, inside a script string, so its quotes arrive as \":
 *
 *   \"endpointBilling\":{\"endpoint\":\"fal-ai/ace-step\",\"billing_unit\":\"seconds\",\"price\":0.0002,...}
 *
 * Returns each distinct { unit, price } the page gives for `endpoint`: one
 * when the copies agree, none when the object is gone or has no unit and
 * numeric price. Copies that disagree are all returned; choosing between
 * them is not this function's to do.
 */
export function extractBilling(html, endpoint) {
    const found = new Map();
    for (const m of html.replaceAll('\\"', '"').matchAll(/"(?:endpointBilling|publicEndpointBilling)":(\{[^{}]*\})/g)) {
        let billing;
        try { billing = JSON.parse(m[1]); } catch { continue; }
        const { billing_unit: unit, price } = billing;
        if (billing.endpoint !== endpoint || typeof unit !== 'string' || typeof price !== 'number') continue;
        found.set(`${price}/${unit}`, { unit, price });
    }
    return [...found.values()];
}

/**
 * The billing figures on an endpoint's page against the base price recorded
 * for it in `basePrices`. A base price is the price of one unit, not of one
 * generation, so it is only ever held against the copy taken from the same
 * field, and exactly.
 *
 * status  'ok'        the page gives one figure and it is the recorded one
 *         'moved'     a different price or unit, more than one figure, or none
 *         'unlisted'  nothing is recorded for the endpoint, so nothing is compared
 */
export function checkBase(endpoint, readings, basePrices = {}) {
    if (!Object.hasOwn(basePrices, endpoint)) return { status: 'unlisted', recorded: null, readings };
    const recorded = basePrices[endpoint];
    const same = readings.length === 1 && readings[0].price === recorded.price && readings[0].unit === recorded.unit;
    return { status: same ? 'ok' : 'moved', recorded, readings };
}

/** One catalog row against its fal page: the "$" figures, and the billing figure as `base`. */
export function checkPage(row, html, unitRates = {}, basePrices = {}) {
    const base = checkBase(row.provider_endpoint, extractBilling(html, row.provider_endpoint), basePrices);
    return { ...checkRow(row, extractPrices(html), unitRates), base };
}

/** A row whose page no longer shows what is expected of it. */
export const drifts = (r) => r.verdict === 'drift' || r.base?.status === 'moved';

/** The same, where the figure it is held to is exact: a base price, or a listed rate. */
export const driftsExactly = (r) => r.base?.status === 'moved' || (r.listed && r.verdict === 'drift');

const percent = (fraction) => (fraction * 100).toFixed(1);
const figure = (b) => `$${b.price}/${b.unit}`;
// None: the object is gone, renamed, or no longer a flat one with a unit and a price.
const billingShown = (readings) => readings.map(figure).join(' and ') || 'none read from the page';

/** What a COST? finding says, shared by the row line and the summary. */
export function costSentence(r) {
    return `records $${r.total.toFixed(4)}, $${r.rate.toFixed(4)} ${r.unit} = $${r.cost.built.toFixed(4)}`;
}

/** What the summary says about a drifting row: a sentence for each figure that moved. */
export function driftSummary(r) {
    const out = [];
    if (r.verdict === 'drift') out.push(`expected $${r.rate.toFixed(4)} ${r.unit}, page shows ${r.seen.map((p) => '$' + p).join(', ') || 'no price'}`);
    if (r.base?.status === 'moved') out.push(`expected base price ${figure(r.base.recorded)}, fal's billing: ${billingShown(r.base.readings)}`);
    return out;
}

/** One line on how many rows had their base price compared, so a plain `ok` is known to mean it was. */
export function baseTally(checked) {
    const count = (status) => checked.filter((r) => r.base.status === status).length;
    const [moved, unlisted] = [count('moved'), count('unlisted')];
    return `base prices: ${count('ok')} of ${checked.length} match fal's billing`
        + (moved ? `, ${moved} moved` : '') + (unlisted ? `, ${unlisted} not recorded` : '');
}

/** The report lines for one checked row. */
export function rowLines(r) {
    const id = r.id.padEnd(20);
    const moved = r.base?.status === 'moved';
    const lines = [];
    if (r.verdict === 'breach') lines.push(`BREACH ${id} margin ${percent(r.margin)}% < ${MARGIN_FLOOR * 100}%`);
    if (r.verdict === 'drift') {
        const page = r.seen.length ? r.seen.map((p) => '$' + p).join(' ') : 'no price';
        lines.push(`DRIFT? ${id} expect $${r.rate.toFixed(4)} ${r.unit}  page: ${page}`);
    }
    if (moved) lines.push(`DRIFT? ${id} expect base price ${figure(r.base.recorded)}  fal's billing: ${billingShown(r.base.readings)}`);
    if (r.cost) {
        const under = r.cost.margin < MARGIN_FLOOR ? ` < ${MARGIN_FLOOR * 100}%` : '';
        lines.push(`COST?  ${id} ${costSentence(r)}  ${r.credits}cr  margin ${percent(r.cost.margin)}% at that cost${under}`);
    } else if (r.verdict === 'ok' && !moved) {
        lines.push(`ok    ${id} $${r.rate.toFixed(4)} ${r.unit.padEnd(14)} ${r.credits}cr  margin ${percent(r.margin)}%`);
    }
    // Nothing was compared with fal's billing, so the line must not read as if it was.
    if (r.base?.status === 'unlisted') lines[lines.length - 1] += `  no base price recorded (fal's billing: ${billingShown(r.base.readings)})`;
    return lines;
}

export const DRIFT_MODES = ['false', 'listed', 'all'];

/**
 * How many findings fail the run. A dead endpoint and a recorded cost under
 * the floor always do. What fal's own page says does only when asked for:
 *
 *   'listed'  a figure recorded in fal-unit-rates.mjs that moved, where the
 *             figure to look for is exact (`listedDrift`: fal's base price on
 *             any row, or the quoted rate of a row in `unitRates`), and a
 *             listed row that is under the floor at fal's rate while its
 *             recorded cost says otherwise
 *   'all'     those, and the "$" figures on every other row. A stray figure
 *             on fal's pages reads as drift on a row whose own page shows no
 *             price, so this one files on noise.
 */
export function failingCount({ dead, breach, drift, listedDrift, underFloor }, mode) {
    if (mode === 'all') return dead + breach + drift + underFloor;
    if (mode === 'listed') return dead + breach + listedDrift + underFloor;
    return dead + breach;
}
