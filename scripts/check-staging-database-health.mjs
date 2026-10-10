#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonc } from './check-migration-ledger.mjs';
import { assessRecovery } from './check-recovery-health.mjs';
import { fetchStatus } from './check-reconcile.mjs';

const RECOVERY_COUNTS = ['stale_jobs', 'reap_overdue', 'reap_exhausted',
    'stale_top_up_returns', 'unreviewed_flagged_orders', 'unreviewed_order_collisions',
    'cinema_poll_overdue', 'cinema_poll_failed', 'cinema_provisioning_stuck',
    'cinema_processing_stuck', 'cinema_cleanup_required',
    'fal_dispatch_unknown', 'fal_dispatch_overdue'];

export function stagingConfig(config) {
    // Never inherit the production defaults or ambient SUPABASE_* variables.
    const vars = config.env?.staging?.vars;
    const url = vars?.SUPABASE_URL;
    const key = vars?.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key || new URL(url).origin !== 'https://yrqzwqywxfesmbvhzjgj.supabase.co') {
        throw Error('staging database configuration missing or wrong project');
    }
    return { url, key };
}

export function recoveryCounts(value) {
    for (const name of RECOVERY_COUNTS) {
        if (!Number.isSafeInteger(value?.[name]) || value[name] < 0) throw Error('invalid staging recovery counts');
    }
    const issues = assessRecovery(value);
    return { counts: Object.fromEntries(RECOVERY_COUNTS.map(name => [name, value[name]])),
        unhealthy_tasks: value.unhealthy_tasks, issues };
}

export async function checkStagingDatabase(config) {
    const evidence = { checked_at: new Date().toISOString(), project: 'yrqzwqywxfesmbvhzjgj' };
    let exit = 0;
    const reports = [];
    // Read both snapshots even if one is unreadable. No server scans or writes.
    try {
        const response = await fetch(new URL('/rest/v1/rpc/recovery_status', config.url), {
            method: 'POST', headers: { apikey: config.key, Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' },
            body: '{}', signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) throw Error('unreadable');
        const recovery = recoveryCounts(await response.json());
        evidence.recovery = recovery;
        reports.push(recovery.issues.length ? `Staging recovery: ${recovery.issues.join('; ')}` : 'Staging recovery: all counts zero; no unhealthy tasks.');
        if (recovery.issues.length) exit = 1;
    } catch {
        evidence.recovery = { unreadable: true };
        reports.push('Staging recovery snapshot unreadable or invalid; this is not a pass.');
        exit = 2;
    }
    try {
        const reconciliation = await fetchStatus(config);
        evidence.reconciliation = reconciliation;
        const bad = Object.entries(reconciliation).filter(([, count]) => count > 0);
        const pending = Object.entries(reconciliation).filter(([, count]) => count === null).map(([name]) => name);
        reports.push(bad.length ? `Staging reconciliation: ${bad.map(([name, count]) => `${name}: ${count}`).join('; ')}`
            : pending.length ? `Staging reconciliation: measured counts zero; pending 0264: ${pending.join(', ')}.`
            : 'Staging reconciliation: all seven drift counts zero.');
        if (bad.length && exit === 0) exit = 1;
    } catch {
        evidence.reconciliation = { unreadable: true };
        reports.push('Staging reconciliation snapshot unreadable or invalid; this is not a pass.');
        exit = 2;
    }
    return { exit, reports, evidence };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        const root = join(dirname(fileURLToPath(import.meta.url)), '..');
        const config = stagingConfig(parseJsonc(readFileSync(join(root, 'wrangler.jsonc'), 'utf8')));
        const result = await checkStagingDatabase(config);
        // Artifact is counts-only. Keep changing timestamps out of incident text
        // so identical incidents still deduplicate.
        const output = process.argv[2];
        if (output) writeFileSync(output, JSON.stringify(result.evidence, null, 2) + '\n');
        console.log(result.reports.join('\n'));
        process.exitCode = result.exit;
    } catch {
        console.error('Staging database health could not be checked; this is not a pass.');
        process.exitCode = 2;
    }
}
