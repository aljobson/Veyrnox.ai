#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { supabaseConfig } from './check-migration-ledger.mjs';
const COUNTS = ['reap_exhausted', 'reap_overdue', 'stale_jobs', 'stale_top_up_returns', 'unreviewed_flagged_orders', 'unreviewed_order_collisions'];
const TASKS = new Set(['top_up_backfill', 'upload_sweep', 'asset_reap', 'auto_short', 'grsai']);
export function assessRecovery(value) {
    if (!value || !Array.isArray(value.unhealthy_tasks) || value.unhealthy_tasks.some(task => !TASKS.has(task))) throw Error('invalid task health');
    const issues = value.unhealthy_tasks.map(task => `unhealthy task: ${task}`);
    for (const key of COUNTS) {
        if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw Error(`invalid ${key}`);
        if (value[key] > 0) issues.push(`${key}: ${value[key]}`);
    }
    return issues;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        const { url, key } = supabaseConfig(join(dirname(fileURLToPath(import.meta.url)), '..'));
        const response = await fetch(new URL('/rest/v1/rpc/recovery_status', url), {
            method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: '{}', signal: AbortSignal.timeout(20000),
        });
        if (!response.ok) throw Error(`recovery snapshot unreadable (${response.status})`);
        const issues = assessRecovery(await response.json());
        console.log(issues.length ? issues.join('\n') : 'Recovery tasks and queues are healthy.');
        process.exitCode = issues.length ? 1 : 0;
    } catch (error) { console.error(error.message); process.exitCode = 2; }
}
