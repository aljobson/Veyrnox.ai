#!/usr/bin/env node
/**
 * Does what Crun charged us match what our attempt records say we spent?
 *
 * READ-ONLY. Sums job_attempts.cost_snapshot for Crun routes over a time window and compares it with the
 * fall in your Crun balance (crun.ai/billing) over the same window.
 *
 *   node scripts/check-crun-spend.mjs --since 2026-11-04T09:00:00Z --balance-before 9186.74 --balance-after 9100.10
 *
 * Options:
 *   --since ISO        window start (required)
 *   --until ISO        window end (default: now)
 *   --balance-before N Crun credits at the start (read crun.ai/billing then)
 *   --balance-after N  Crun credits at the end
 *   --allow-credits N  credits spent outside the app in the window, e.g. a probe (default 0)
 *   --paid-rate N      credits per $1 you paid at, e.g. 212 for the $500 pack (default 206)
 *   --list             print every attempt with its Crun task id, to check against crun.ai/logs
 *
 * Our costs are recorded at 206 credits per $1 (migration 0389), so credits = cost x 206 whatever you paid.
 * The paid rate only turns the credit drop into the dollars you really spent.
 *
 * Reading job_attempts needs the service-role key (the table is service-role only). Set SUPABASE_SERVICE_ROLE_KEY,
 * or run in a terminal and type it when asked (typing is hidden, nothing is stored). Never paste it into a chat.
 *
 * Exit 0 balance fits the records, 1 it does not, 2 could not read.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabaseConfig } from './check-migration-ledger.mjs';
import { promptHidden } from './probe-crun.mjs';

export const RECORDED_RATE = 206;
const PAGE = 1000;

const num = (v) => Number(v);

/** rows: [{ outcome, cost_snapshot, supplier_job_id, model_routes: { model_id } }] */
export function summarize(rows) {
    const byModel = new Map();
    let all = 0;
    let completed = 0;
    let failed = 0;
    for (const r of rows) {
        const cost = num(r.cost_snapshot);
        const model = (r.model_routes && r.model_routes.model_id) || 'unknown';
        const m = byModel.get(model) || { jobs: 0, cost: 0 };
        m.jobs += 1;
        m.cost += cost;
        byModel.set(model, m);
        all += cost;
        if (r.outcome === 'completed') completed += cost;
        else if (r.outcome === 'failed' || r.outcome === 'abandoned') failed += cost;
    }
    return { jobs: rows.length, all, completed, failed, byModel };
}

/** The balance should fall by at least the completed attempts and at most all attempts, plus known outside spend. */
export function compare({ all, completed }, { before, after, allowCredits = 0 }) {
    const drop = before - after;
    const low = completed * RECORDED_RATE;
    const high = all * RECORDED_RATE + allowCredits;
    const tol = Math.max(1, high * 0.02);
    const verdict = drop < low - tol ? 'under' : drop > high + tol ? 'over' : 'fits';
    return { drop, low, high, tol, verdict };
}

function arg(name) {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
}

async function fetchAttempts({ url, key, since, until }) {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
        const q = new URL('/rest/v1/job_attempts', url);
        q.searchParams.set('select', 'job_id,attempt_no,supplier_job_id,outcome,cost_snapshot,created_at,model_routes!inner(supplier,model_id)');
        q.searchParams.set('model_routes.supplier', 'eq.crun');
        q.searchParams.append('created_at', `gte.${since}`);
        q.searchParams.append('created_at', `lt.${until}`);
        q.searchParams.set('order', 'created_at.asc');
        const res = await fetch(q, {
            headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + PAGE - 1}` },
            signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) throw new Error(`job_attempts answered ${res.status}`);
        const page = await res.json();
        rows.push(...page);
        if (page.length < PAGE) return rows;
    }
}

const usd = (n) => `$${n.toFixed(3)}`;

async function main() {
    const since = arg('--since');
    if (!since || Number.isNaN(Date.parse(since))) { console.error('--since <ISO time> is required'); process.exit(2); }
    const until = arg('--until') || new Date().toISOString();
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key && process.stdin.isTTY) key = await promptHidden('Service-role key (typing is hidden): ');
    if (!key) { console.error('SUPABASE_SERVICE_ROLE_KEY is not set and this is not a terminal'); process.exit(2); }
    let rows;
    try { rows = await fetchAttempts({ url: supabaseConfig(root).url, key, since, until }); }
    catch (err) { console.error(`could not read job_attempts: ${err && err.message}`); process.exit(2); }

    const s = summarize(rows);
    console.log(`Crun attempts ${since} to ${until}: ${s.jobs}`);
    for (const [model, m] of [...s.byModel].sort((a, b) => b[1].cost - a[1].cost)) {
        console.log(`  ${model.padEnd(24)} ${String(m.jobs).padStart(4)} jobs  ${usd(m.cost)}`);
    }
    console.log(`recorded cost: ${usd(s.all)} all attempts, ${usd(s.completed)} completed, ${usd(s.failed)} failed or abandoned`);
    console.log(`expected credits: ${(s.completed * RECORDED_RATE).toFixed(1)} to ${(s.all * RECORDED_RATE).toFixed(1)}`);
    if (process.argv.includes('--list')) {
        for (const r of rows) console.log(`  ${r.created_at}  ${r.outcome || 'open'}  ${r.supplier_job_id || '-'}  ${r.model_routes.model_id}  ${usd(num(r.cost_snapshot))}`);
    }

    const before = arg('--balance-before');
    const after = arg('--balance-after');
    if (before === undefined || after === undefined) { console.log('add --balance-before and --balance-after to compare with the Crun balance'); return; }
    const c = compare(s, { before: num(before), after: num(after), allowCredits: num(arg('--allow-credits') || 0) });
    const paid = num(arg('--paid-rate') || RECORDED_RATE);
    console.log(`balance fell ${c.drop.toFixed(2)} credits (${usd(c.drop / paid)} at ${paid} per $1); records explain ${c.low.toFixed(1)} to ${c.high.toFixed(1)}`);
    if (c.verdict === 'fits') console.log('OK: the balance fits the records.');
    else if (c.verdict === 'over') { console.error('MISMATCH: Crun charged MORE than the records explain. Look for spend outside the app, or a rate or cost error.'); process.exit(1); }
    else { console.error('MISMATCH: Crun charged LESS than completed attempts. Costs may be overstated, or the window is wrong.'); process.exit(1); }
    if (s.failed > 0 && c.drop < s.all * RECORDED_RATE - c.tol) console.log('Note: the drop is below the all-attempts total, so Crun appears not to bill failed attempts.');
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
