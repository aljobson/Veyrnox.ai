#!/usr/bin/env node
/**
 * Compare OpenRouter's published video price with the recorded cost of the routes that use it
 * (ADR-0256 phase 4c). Read-only, no key: it reads one public list and the recorded costs.
 *
 *   node scripts/check-openrouter-route-prices.mjs                 # recorded costs from docs below
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/check-openrouter-route-prices.mjs --db
 *
 * Exit 0 when every routed row is within 1%, 1 on drift or a missing price, so a scheduled run can
 * open an issue. With --db the recorded cost comes from model_routes; otherwise from the value the
 * catalog carried when this was written (0.4536).
 */
import { select, envConfig } from '../packages/db/supabase-client.js';
import { OPENROUTER_ROWS, checkOpenRouterRow } from '../lib/openrouterPriceCheck.js';

const FALLBACK_RECORDED = { 'seedance-2.0-fast': 0.4536 };

async function main() {
    const res = await fetch('https://openrouter.ai/api/v1/videos/models', { signal: AbortSignal.timeout(20000) });
    if (!res.ok) { console.error(`OpenRouter answered ${res.status}`); process.exit(1); }
    const models = (await res.json()).data || [];
    let recorded = FALLBACK_RECORDED;
    if (process.argv.includes('--db')) {
        const cfg = envConfig();
        const rows = await select('model_routes', { columns: 'model_id,cost_per_unit', filter: 'supplier=eq.openrouter&state=eq.active' }, cfg);
        recorded = Object.fromEntries(rows.map((r) => [r.model_id, Number(r.cost_per_unit)]));
    }
    let bad = 0;
    for (const row of OPENROUTER_ROWS) {
        const r = checkOpenRouterRow(row, models, recorded[row.id] ?? NaN);
        if (r.status !== 'ok') bad += 1;
        console.log(`${row.id}: ${r.status}; recorded $${r.recorded}${r.observed !== undefined ? `, OpenRouter now $${r.observed} (${(r.drift * 100).toFixed(2)}%)` : ''}`);
    }
    process.exit(bad ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
