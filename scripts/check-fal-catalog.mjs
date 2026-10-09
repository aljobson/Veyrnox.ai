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
 * The first line says whether SUPABASE_URL is the production project
 * (the top-level vars in wrangler.jsonc). With `--require-production`, as
 * the workflow runs it, any other catalog is refused before anything is read.
 *
 * A page is read twice over: the "$" figures in its text, and fal's own
 * billing figure for the endpoint (its base price), which is held exactly
 * against the copy in scripts/lib/fal-unit-rates.mjs.
 *
 * Exit 0 = clean, 1 = dead endpoint or margin breach found, or the wrong
 * catalog where production is required. A price that moved on fal's page is
 * a note in a clean run unless FAL_DRIFT_FAILS is "listed" (what
 * fal-catalog-watch.yml sets) or "all".
 */

import { readFileSync } from 'node:fs';

import { catalogLine, productionUrl, readsProduction } from './lib/catalog-target.mjs';
import {
    DRIFT_MODES, MARGIN_FLOOR, baseTally, checkPage, costSentence, creditsForFloor, driftSummary, drifts, driftsExactly, failingCount, rowLines,
} from './lib/fal-price-check.mjs';
import { BASE_PRICES, UNIT_RATES } from './lib/fal-unit-rates.mjs';

const FAL_MODEL_BASE = 'https://fal.ai/models/';
const DRIFT_FAILS = process.env.FAL_DRIFT_FAILS || 'false';
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

async function main() {
    if (!DRIFT_MODES.includes(DRIFT_FAILS)) {
        throw new Error(`FAL_DRIFT_FAILS is "${DRIFT_FAILS}"; it takes ${DRIFT_MODES.join(', ')}`);
    }

    const offline = process.argv.includes('--offline');
    if (offline) {
        console.log('offline mode: endpoint-shape lint only');
        const { CATALOG } = await import('../packages/catalog/index.ts').catch(() => ({ CATALOG: [] }));
        console.log(`catalog rows: ${CATALOG.length}`);
        return 0;
    }

    const production = productionUrl(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
    console.log(catalogLine(process.env.SUPABASE_URL, production));
    if (process.argv.includes('--require-production') && !readsProduction(process.env.SUPABASE_URL, production)) {
        console.log('FAIL: not the production catalog, so nothing was checked. Set the repository secrets SUPABASE_URL and SUPABASE_ANON_KEY to the top-level vars in wrangler.jsonc.');
        return 1;
    }

    const rows = await loadCatalog();
    const dead = [];
    const drift = [];
    const breach = [];
    const cost = [];
    const read = [];

    for (const row of rows) {
        const res = await checkEndpoint(row.provider_endpoint);

        if (!res.ok) {
            dead.push({ ...row, status: res.status, url: res.url });
            console.log(`DEAD  ${row.id.padEnd(20)} ${res.status} ${res.url}`);
            continue;
        }

        // Match on the unit fal actually quotes, and on its own billing figure.
        const checked = checkPage(row, res.html, UNIT_RATES, BASE_PRICES);
        read.push(checked);
        if (checked.verdict === 'breach') breach.push({ ...row, margin: checked.margin });
        if (drifts(checked)) drift.push(checked);
        if (checked.cost) cost.push(checked);
        for (const line of rowLines(checked)) console.log(line);
    }

    console.log('');
    console.log(baseTally(read));
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
            for (const moved of driftSummary(d)) console.log(`- \`${d.id}\` ${moved}`);
        }
        console.log('');
    }
    if (cost.length) {
        console.log(`## Recorded cost is not what fal's rate comes to (${cost.length}) — correct the catalog row`);
        for (const c of cost) {
            const floor = c.cost.margin < MARGIN_FLOOR ? `, needs ${creditsForFloor(c.cost.built)} credits (has ${c.credits})` : '';
            console.log(`- \`${c.id}\` ${costSentence(c)}: margin ${(c.cost.margin * 100).toFixed(1)}% at that cost${floor}`);
        }
        console.log('');
    }

    const failed = failingCount({
        dead: dead.length,
        breach: breach.length,
        drift: drift.length,
        listedDrift: drift.filter(driftsExactly).length,
        underFloor: cost.filter((c) => c.cost.margin < MARGIN_FLOOR).length,
    }, DRIFT_FAILS);
    const notes = (n, what) => `${n} ${what} note${n === 1 ? '' : 's'}`;
    console.log(failed
        ? `FAIL: ${dead.length} dead, ${breach.length} breach, ${drift.length} drift, ${cost.length} cost`
        : `clean (${notes(drift.length, 'drift')}, ${notes(cost.length, 'cost')})`);
    return failed ? 1 : 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
