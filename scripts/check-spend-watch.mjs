#!/usr/bin/env node
/**
 * Is supplier spend close to its caps? (ADR-0328)
 *
 * The database reserves worst-case cost before every job and refuses past the
 * hour/day caps. This reads spend_watch_status() (0444), a verdict-only wrapper
 * over provider_spend_utilization(), so spend-watch.yml can open an issue
 * before a cap starts refusing customers. Anon-callable, no figures: the repo
 * and its Actions logs are public.
 *
 * Usage:  node scripts/check-spend-watch.mjs
 * Exit 0 ok, 1 warn or critical, 2 could not read. An outage is not a pass.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabaseConfig } from './check-migration-ledger.mjs';

const LEVELS = new Set(['ok', 'warn', 'critical']);
const SCOPES = new Set(['none', 'global', 'provider', 'user']);

export async function fetchSpendWatch({ url, key }) {
    const res = await fetch(new URL('/rest/v1/rpc/spend_watch_status', url), {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`spend_watch_status answered ${res.status} — check migrations 0434 and 0444`);
    const body = await res.json();
    if (!body || body.ok !== true) throw new Error(`spend_watch_status reported ${body?.code || 'no verdict'}`);
    if (!LEVELS.has(body.level) || !SCOPES.has(body.scope) || typeof body.admission_open !== 'boolean') {
        throw new Error('spend_watch_status returned an unexpected shape');
    }
    return { level: body.level, scope: body.scope, admissionOpen: body.admission_open };
}

export function exitCodeFor(v) { return v.level === 'ok' && v.admissionOpen ? 0 : 1; }

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    let verdict;
    try {
        verdict = await fetchSpendWatch(supabaseConfig(root));
    } catch (err) {
        console.error(`could not read spend_watch_status: ${err.message}`);
        process.exit(2);
    }
    console.log(`level=${verdict.level} scope=${verdict.scope} admission_open=${verdict.admissionOpen}`);
    const code = exitCodeFor(verdict);
    if (code === 0) console.log('\nSupplier spend is well inside its caps.');
    else console.error(`\nSPEND NEAR A CAP (${verdict.scope}): customers may start seeing refusals. docs/operations/provider-spend-guards.md`);
    process.exit(code);
}
