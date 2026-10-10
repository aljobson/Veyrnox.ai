#!/usr/bin/env node
/**
 * Is the ledger still reconciling?
 *
 * CLAUDE.md: "Reconciliation nightly (ledger.reconcile()) must return zero
 * rows in prod." The veyrnox-reconcile-balances pg_cron job enforces that by
 * raising — but a pg_cron failure only lands in cron.job_run_details, which
 * nothing watches. Drift could sit there for weeks.
 *
 * This reads the counts-only reconcile_status() snapshot (migration 0128) so
 * .github/workflows/reconcile-watch.yml can open an issue the hour it breaks,
 * the same shape as check-migration-ledger.mjs. Anon-callable and
 * counts-only, so no service-role key lives in Actions (PR #61).
 *
 * Usage:
 *   node scripts/check-reconcile.mjs
 *
 * Exit 0 clean, 1 drift, 2 could not read. An outage must not read as a pass
 * and must not read as drift.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { supabaseConfig, fetchLedger } from './check-migration-ledger.mjs';

export const LABELS = {
    balance_drift: 'credit_balances.balance != SUM(ledger_entries.delta)',
    free_credit_drift: 'free_balance outside 0 <= free_balance <= balance',
    top_up_drift: 'credited Top-ups that do not tie out to their ledger entry',
    failed_refund_drift: 'FAILED jobs still holding the credits they should have refunded',
    subscription_credit_drift: 'subscription_balance off its ledger sum, or past its cycle end and unswept',
    free_allowance_drift: 'free-allowance claims above account/model caps or the global cost ceiling',
    referral_drift: 'referral rewards, clawbacks or monthly caps do not tie out',
};

// During merge-before-approval rollout, missing new fields are explicitly
// unmeasured only while their real migration receipt is absent. After apply,
// absence fails closed automatically; no permanent nullable allowlist.
const EXPANSION = '0264_reconciliation_free_allowance_referrals';
const NEW_COUNTS = ['free_allowance_drift', 'referral_drift'];

export async function fetchStatus({ url, key }) {
    const res = await fetch(new URL('/rest/v1/rpc/reconcile_status', url), {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
        throw new Error(`reconcile_status answered ${res.status} — check snapshot freshness and migrations 0128, 0185 and 0264`);
    }
    const body = await res.json();
    // PostgREST returns a SETOF as an array; one row is expected.
    const row = Array.isArray(body) ? body[0] : body;
    if (!row || typeof row !== 'object') throw new Error('reconcile_status returned no row');
    const missingNew = NEW_COUNTS.some(k => !(k in row));
    let expansionApplied = true;
    if (missingNew) {
        const names = await fetchLedger({ url, key });
        expansionApplied = names.includes(EXPANSION) || names.includes(EXPANSION.slice(5));
    }
    const out = {};
    for (const k of Object.keys(LABELS)) {
        if (NEW_COUNTS.includes(k) && !expansionApplied && !(k in row)) { out[k] = null; continue; }
        // A missing or non-numeric count is not a zero. Number(null) is 0, so
        // the type is checked first.
        const n = typeof row[k] === 'number' ? row[k] : NaN;
        if (!Number.isInteger(n) || n < 0) throw new Error(`reconcile_status.${k} was not a count: ${row[k]}`);
        out[k] = n;
    }
    return out;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    let status;
    try {
        status = await fetchStatus(supabaseConfig(root));
    } catch (err) {
        console.error(`could not read reconcile_status: ${err.message}`);
        process.exit(2);
    }
    const bad = Object.entries(status).filter(([, n]) => n > 0);
    for (const [k, n] of Object.entries(status)) {
        if (n === null) { console.log(`n/a          ${k}: not reported until migration 0264 is applied`); continue; }
        console.log(`${n === 0 ? 'ok  ' : 'DRIFT'} ${String(n).padStart(6)}  ${k} — ${LABELS[k]}`);
    }
    if (bad.length === 0) {
        console.log(Object.values(status).some(n => n === null)
            ? '\nreported counts reconcile; 0264 allowance/referral measurements are pending.'
            : '\nall seven reconciliation counts are zero');
        process.exit(0);
    }
    console.error('\nthe ledger does not reconcile; every row here is money that does not add up');
    process.exit(1);
}
