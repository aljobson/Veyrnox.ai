#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const recovery = ['stale_jobs', 'reap_overdue', 'reap_exhausted', 'stale_top_up_returns',
    'unreviewed_flagged_orders', 'unreviewed_order_collisions', 'cinema_poll_overdue',
    'cinema_poll_failed', 'cinema_provisioning_stuck', 'cinema_processing_stuck',
    'cinema_cleanup_required', 'fal_dispatch_unknown', 'fal_dispatch_overdue'];
const drift = ['balance_drift', 'free_credit_drift', 'top_up_drift', 'failed_refund_drift', 'subscription_credit_drift', 'free_allowance_drift', 'referral_drift'];
const stamp = value => typeof value === 'string' ? Date.parse(value) : NaN;

// Inventory is supplied from gh run list for the staging workflow. Never infer
// success from the artifacts that happen to exist while omitting failed runs.
export function reviewWindow({ since, until, baseline_run_id, runs }, readArtifact) {
    const start = stamp(since), end = stamp(until);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Array.isArray(runs)
        || !Number.isSafeInteger(baseline_run_id)) throw Error('invalid window inventory');
    const observations = [], problems = [], seen = new Set();
    for (const run of runs) {
        const created = stamp(run.createdAt);
        if (!Number.isSafeInteger(run.databaseId) || run.databaseId <= 0 || !Number.isFinite(created)) throw Error('invalid run inventory');
        if (run.databaseId !== baseline_run_id && (created < start || created > end)) continue;
        if (seen.has(run.databaseId)) throw Error('duplicate run inventory');
        seen.add(run.databaseId);
        if (run.status !== 'completed' || run.conclusion !== 'success') problems.push({ run: run.databaseId, kind: 'workflow_not_successful' });
        let artifact;
        try { artifact = readArtifact(run.databaseId); } catch { problems.push({ run: run.databaseId, kind: 'missing_or_unreadable_artifact' }); continue; }
        const checked = stamp(artifact?.checked_at);
        const validCounts = (counts, names) => names.every(name => Number.isSafeInteger(counts?.[name]) && counts[name] >= 0);
        if (artifact?.project !== 'yrqzwqywxfesmbvhzjgj' || !Number.isFinite(checked)
            || checked < created || checked < start || checked > end
            || artifact.recovery?.unreadable || artifact.reconciliation?.unreadable
            || !validCounts(artifact.recovery?.counts, recovery) || !validCounts(artifact.reconciliation, drift)
            || !Array.isArray(artifact.recovery?.unhealthy_tasks) || !Array.isArray(artifact.recovery?.issues)) {
            problems.push({ run: run.databaseId, kind: 'invalid_artifact' }); continue;
        }
        const nonzero = [...recovery.filter(name => artifact.recovery.counts[name] > 0),
            ...drift.filter(name => artifact.reconciliation[name] > 0)];
        if (nonzero.length || artifact.recovery.unhealthy_tasks.length || artifact.recovery.issues.length) {
            problems.push({ run: run.databaseId, kind: 'unhealthy_observation', nonzero,
                unhealthy_task_count: artifact.recovery.unhealthy_tasks.length, issue_count: artifact.recovery.issues.length });
        }
        observations.push({ run: run.databaseId, checked_at: new Date(checked).toISOString() });
    }
    if (!seen.has(baseline_run_id)) problems.push({ run: baseline_run_id, kind: 'baseline_missing_from_inventory' });
    observations.sort((a, b) => stamp(a.checked_at) - stamp(b.checked_at));
    const points = [since, ...observations.map(o => o.checked_at), until];
    const gaps = points.slice(1).map((to, i) => ({ from: points[i], to, seconds: (stamp(to) - stamp(points[i])) / 1000 }));
    const observedSpan = observations.length ? (stamp(observations.at(-1).checked_at) - stamp(observations[0].checked_at)) / 1000 : 0;
    return { since, until, project: 'yrqzwqywxfesmbvhzjgj', reviewed_runs: seen.size,
        observations, problems, observed_span_seconds: observedSpan,
        elapsed_24_hours: end - start >= 86400000, observed_span_24_hours: observedSpan >= 86400,
        largest_sampling_gap: gaps.reduce((a, b) => b.seconds > a.seconds ? b : a),
        operator_review_required: true, production_activation_authorized: false,
        // Queue backlog and scan freshness must still be reviewed from source
        // evidence; checked_at is a client read time, not a server scan time.
        queue_metrics_included: false, server_scan_freshness_independently_verified: false };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        const directory = process.argv[2];
        if (!directory) throw Error('evidence directory required');
        const manifest = JSON.parse(readFileSync(join(directory, 'inventory.json'), 'utf8'));
        if (stamp(manifest.until) > Date.now()) throw Error('window cannot end in the future');
        const result = reviewWindow(manifest, id => JSON.parse(readFileSync(join(directory, String(id), 'staging-database-health.json'), 'utf8')));
        console.log(JSON.stringify(result, null, 2));
        process.exitCode = result.problems.length ? 2 : result.observed_span_24_hours ? 0 : 1;
    } catch {
        console.error('Health-window evidence is incomplete or invalid; this is not a pass.');
        process.exitCode = 2;
    }
}
