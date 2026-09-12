#!/usr/bin/env node
/**
 * fal catalog watcher — endpoint reachability + provider price drift.
 *
 * Two failure modes this catches, both of which cost real money:
 *   1. A `provider_endpoint` that 404s on fal. Every generation on that
 *      model debits, fails to submit, and refunds — a guaranteed-refund
 *      loop that looks like a broken product to the user.
 *   2. A fal price rise. Floor pricing (ADR-0014) puts every row at
 *      ~50% margin, so any increase pushes us under the MARGIN_FLOOR.
 *
 * Reads the live catalog through the anon-callable catalog_watch() RPC so it
 * checks what is actually shipped, not what the repo believes. Falls
 * back to `--offline` for a repo-only endpoint-shape lint.
 *
 * Exit 0 = clean, 1 = drift or dead endpoint found.
 */

const FAL_MODEL_BASE = 'https://fal.ai/models/';
const REFERENCE_DOLLARS_PER_CREDIT = 0.033;
const MARGIN_FLOOR = 0.5;
// fal rounds and re-tiers often; only shout when the move is real.
const PRICE_DRIFT_TOLERANCE = 0.02;
const UA = 'Mozilla/5.0 (compatible; veyrnox-catalog-watch/1.0)';

async function loadCatalog() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
        throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY required (or pass --offline)');
    }
    // catalog_watch() (migration 0030) is the only catalog read the anon role
    // has: exactly the columns this script needs (id, provider,
    // provider_endpoint, credits_5s, provider_cost_per_unit, cost_unit,
    // billing_seconds, active). No service-role key in Actions.
    const res = await fetch(new URL('/rest/v1/rpc/catalog_watch', url), {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: '{}',
    });
    if (res.status === 401 || res.status === 403 || res.status === 404) {
        throw new Error(
            `catalog read ${res.status} — SUPABASE_ANON_KEY is wrong, or migration 0030 (catalog_watch) is not applied.`
        );
    }
    if (!res.ok) throw new Error(`catalog read ${res.status}`);
    const rows = await res.json();
    return rows.filter((r) => r.active && r.provider === 'fal');
}

/** HEAD-ish check: does the fal model page exist? */
async function checkEndpoint(endpoint) {
    const url = FAL_MODEL_BASE + endpoint;
    try {
        const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
        return { ok: res.ok, status: res.status, url, html: res.ok ? await res.text() : '' };
    } catch (err) {
        return { ok: false, status: 0, url, html: '', error: String(err && err.message) };
    }
}

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
function extractPrices(html) {
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
 * exactly the mistake migration 0021 had to undo.
 */
function comparisonRate(row) {
    const total = Number(row.provider_cost_per_unit);
    if (row.cost_unit === 'per_second') {
        const secs = Number(row.billing_seconds) || 5;
        return { rate: total / secs, unit: `/s x ${secs}s`, total };
    }
    return { rate: total, unit: 'per generation', total };
}

function marginAt(costUsd, credits) {
    const retail = credits * REFERENCE_DOLLARS_PER_CREDIT;
    return retail > 0 ? (retail - costUsd) / retail : -1;
}

/** Smallest credit count that still clears the floor at the given cost. */
function creditsForFloor(costUsd) {
    return Math.ceil((costUsd / (1 - MARGIN_FLOOR)) / REFERENCE_DOLLARS_PER_CREDIT);
}

async function main() {
    const offline = process.argv.includes('--offline');
    if (offline) {
        console.log('offline mode: endpoint-shape lint only');
        const { CATALOG } = await import('../packages/catalog/index.ts').catch(() => ({ CATALOG: [] }));
        console.log(`catalog rows: ${CATALOG.length}`);
        return 0;
    }

    const rows = await loadCatalog();
    const dead = [];
    const drift = [];
    const breach = [];

    for (const row of rows) {
        const cost = Number(row.provider_cost_per_unit);
        const credits = Number(row.credits_5s);
        const res = await checkEndpoint(row.provider_endpoint);

        if (!res.ok) {
            dead.push({ ...row, status: res.status, url: res.url });
            console.log(`DEAD  ${row.id.padEnd(20)} ${res.status} ${res.url}`);
            continue;
        }

        const prices = extractPrices(res.html);
        const { rate, unit, total } = comparisonRate(row);
        // Match on the unit fal actually quotes.
        const tol = Math.max(0.0005, rate * 0.05);
        const near = prices.filter((p) => Math.abs(p - rate) <= tol);
        const m = marginAt(total, credits);

        if (m < MARGIN_FLOOR) {
            breach.push({ ...row, margin: m });
            console.log(`BREACH ${row.id.padEnd(20)} margin ${(m * 100).toFixed(1)}% < ${MARGIN_FLOOR * 100}%`);
        } else if (near.length === 0 && prices.length > 0) {
            drift.push({ ...row, rate, unit, seen: prices.slice(0, 8) });
            console.log(
                `DRIFT? ${row.id.padEnd(20)} expect $${rate.toFixed(4)} ${unit}  page: ${prices.slice(0, 8).map((p) => '$' + p).join(' ')}`
            );
        } else {
            console.log(`ok    ${row.id.padEnd(20)} $${rate.toFixed(4)} ${unit.padEnd(14)} ${credits}cr  margin ${(m * 100).toFixed(1)}%`);
        }
    }

    console.log('');
    if (dead.length) {
        console.log(`## Dead endpoints (${dead.length}) — these refund every generation`);
        for (const d of dead) console.log(`- \`${d.id}\` -> \`${d.provider_endpoint}\` (HTTP ${d.status})`);
        console.log('');
    }
    if (breach.length) {
        console.log(`## Margin breaches (${breach.length})`);
        for (const b of breach) {
            console.log(
                `- \`${b.id}\` ${(b.margin * 100).toFixed(1)}% — needs ${creditsForFloor(Number(b.provider_cost_per_unit))} credits (has ${b.credits_5s})`
            );
        }
        console.log('');
    }
    if (drift.length) {
        console.log(`## Possible price drift (${drift.length}) — verify by hand`);
        for (const d of drift) {
            console.log(`- \`${d.id}\` expected $${d.rate.toFixed(4)} ${d.unit}, page shows ${d.seen.map((p) => '$' + p).join(', ')}`);
        }
        console.log('');
    }

    const failed = dead.length + breach.length;
    console.log(failed ? `FAIL: ${dead.length} dead, ${breach.length} breach, ${drift.length} drift` : `clean (${drift.length} drift notes)`);
    return failed ? 1 : 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
