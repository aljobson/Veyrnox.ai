#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { supabaseConfig } from './check-migration-ledger.mjs';
const COUNTS = ['reap_exhausted', 'reap_overdue', 'stale_jobs', 'stale_top_up_returns', 'unreviewed_flagged_orders', 'unreviewed_order_collisions'];
const TASKS = new Set(['top_up_backfill', 'upload_sweep', 'asset_reap', 'auto_short', 'grsai', 'byteplus', 'video_agent', 'fal_dispatch', 'content_scan']);
const CINEMA_COUNTS = ['cinema_poll_overdue', 'cinema_poll_failed', 'cinema_provisioning_stuck', 'cinema_processing_stuck', 'cinema_cleanup_required'];
const retryableStatus = status => status === 408 || status === 429 || status >= 500;

export async function fetchRecoveryStatus({ url, key, fetchImpl = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    const endpoint = new URL('/rest/v1/rpc/recovery_status', url);
    for (let attempt = 0; attempt < 2; attempt += 1) {
        let response;
        try {
            response = await fetchImpl(endpoint, {
                method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
                body: '{}', signal: AbortSignal.timeout(20000),
            });
        } catch (error) {
            if (attempt === 1) throw error;
            await wait(250);
            continue;
        }
        if (response.ok) return response.json();
        const error = Error(`recovery snapshot unreadable (${response.status})`);
        if (attempt === 1 || !retryableStatus(response.status)) throw error;
        await wait(250);
    }
    throw Error('recovery snapshot unreadable');
}

export function assessRecovery(value) {
    if (!value || !Array.isArray(value.unhealthy_tasks) || value.unhealthy_tasks.some(task => !TASKS.has(task))) throw Error('invalid task health');
    const issues = value.unhealthy_tasks.map(task => `unhealthy task: ${task}`);
    for (const key of COUNTS) {
        if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw Error(`invalid ${key}`);
        if (value[key] > 0) issues.push(`${key}: ${value[key]}`);
    }
    // Older production snapshots remain valid while migration 0138 awaits
    // approval. Once any Cinema field exists, require the entire group.
    if (CINEMA_COUNTS.some(key => Object.hasOwn(value, key))) {
        for (const key of CINEMA_COUNTS) {
            if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw Error(`invalid ${key}`);
            if (value[key] > 0) issues.push(`${key}: ${value[key]}`);
        }
    }
    // Optional until 0230 is applied. Unknown work needs investigation even
    // when an otherwise healthy cron continues reporting fresh heartbeats.
    const falCounts = ['fal_dispatch_unknown', 'fal_dispatch_overdue'];
    if (falCounts.some(key => Object.hasOwn(value, key))) {
        for (const key of falCounts) {
            if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw Error(`invalid ${key}`);
            if (value[key] > 0) issues.push(`${key}: ${value[key]}`);
        }
    }
    const scanCounts = ['content_scan_overdue', 'content_scan_backlogged', 'content_scan_exhausted'];
    if (scanCounts.some(key => Object.hasOwn(value, key))) {
        for (const key of scanCounts) {
            if (!Number.isSafeInteger(value[key]) || value[key] < 0) throw Error(`invalid ${key}`);
            if (value[key] > 0) issues.push(`${key}: ${value[key]}`);
        }
    }
    return issues;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        const { url, key } = supabaseConfig(join(dirname(fileURLToPath(import.meta.url)), '..'));
        const issues = assessRecovery(await fetchRecoveryStatus({ url, key }));
        console.log(issues.length ? issues.join('\n') : 'Recovery tasks and queues are healthy.');
        process.exitCode = issues.length ? 1 : 0;
    } catch (error) { console.error(error.message); process.exitCode = 2; }
}
