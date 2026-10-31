#!/usr/bin/env node
/**
 * Is the security-detection engine still alive, and is anything on fire?
 *
 * run_security_detection() (0336/0342) upserts alerts on a 5-minute in-DB
 * pg_cron schedule and records a heartbeat row each time it completes (0418).
 * Nothing in the Worker watches that schedule, and a 3am freeze or admin-403
 * storm pages no one. This reads the service-role-only security_detection_status()
 * so .github/workflows/detection-watch.yml can open an issue the hour the
 * engine goes quiet or a high/critical alert sits unacknowledged — the same
 * shape as scripts/check-reconcile.mjs.
 *
 * Unlike check-reconcile, the status read is NOT anon-callable: the detection
 * tables never expose to anon/authenticated (CLAUDE.md, ADR-0104), so this
 * authenticates with the project's SERVICE-ROLE key. Point SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY at the production project to watch production.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/check-detection.mjs
 *
 * Exit 0 healthy, 1 needs attention (stale engine and/or open high/critical
 * alert), 2 could not read. An outage must not read as a pass and must not
 * read as a false "silent engine".
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { parseJsonc } from './check-migration-ledger.mjs';

// The engine runs every 5 minutes. Three missed runs (~15 min) is the point
// the assessment named: long enough to ride out one dropped pg_cron tick,
// short enough that real silence is caught the same quarter-hour.
export const STALE_LIMIT_SECONDS = 15 * 60;
const READ_TIMEOUT_MS = 20000;

/** URL from env or wrangler.jsonc (public); the key is the service-role secret from env only. */
export function detectionConfig(root) {
    let url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url) {
        const vars = parseJsonc(readFileSync(join(root, 'wrangler.jsonc'), 'utf8')).vars || {};
        url = vars.SUPABASE_URL;
    }
    if (!url) throw new Error('no Supabase URL in SUPABASE_URL or wrangler.jsonc');
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set — the status read is service-role only');
    return { url, key };
}

export async function fetchDetectionStatus({ url, key }) {
    const res = await fetch(new URL('/rest/v1/rpc/security_detection_status', url), {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    if (!res.ok) {
        throw new Error(`security_detection_status answered ${res.status} — check the service-role key and that migration 0418 is applied`);
    }
    const body = await res.json();
    const row = Array.isArray(body) ? body[0] : body;
    if (!row || typeof row !== 'object' || row.ok !== true) throw new Error('security_detection_status returned no row');
    const n = k => {
        const v = row[k];
        if (!Number.isInteger(v) || v < 0) throw new Error(`security_detection_status.${k} was not a count: ${v}`);
        return v;
    };
    const seconds = row.seconds_since_run;
    if (seconds !== null && (!Number.isInteger(seconds) || seconds < 0)) {
        throw new Error(`security_detection_status.seconds_since_run was not an age: ${seconds}`);
    }
    return {
        lastRunAt: row.last_run_at ?? null,
        secondsSinceRun: seconds ?? null,
        openCritical: n('open_critical'),
        openHigh: n('open_high'),
        openHighOrCritical: n('open_high_or_critical'),
        openAlerts: Array.isArray(row.open_alerts) ? row.open_alerts : [],
    };
}

/**
 * Decide health from a status snapshot. Returns { code, reasons, lines }.
 * code 0 healthy, 1 needs attention.
 */
export function evaluate(status, staleSeconds = STALE_LIMIT_SECONDS) {
    const reasons = [];
    const lines = [];
    const stale = status.secondsSinceRun === null || status.secondsSinceRun > staleSeconds;
    if (status.secondsSinceRun === null) {
        reasons.push('engine_silent');
        lines.push('SILENT  no detection run has ever recorded a heartbeat');
    } else if (stale) {
        reasons.push('engine_silent');
        lines.push(`SILENT  last detection run ${status.secondsSinceRun}s ago (over the ${staleSeconds}s limit) — pg_cron may be stopped`);
    } else {
        lines.push(`ok      last detection run ${status.secondsSinceRun}s ago`);
    }
    if (status.openHighOrCritical > 0) {
        reasons.push('open_high_alert');
        lines.push(`ALERT   ${status.openCritical} critical + ${status.openHigh} high alert(s) open and unacknowledged`);
        for (const a of status.openAlerts) {
            lines.push(`  - ${a.severity} ${a.rule_id} ${a.entity} x${a.event_count} (last ${a.last_seen})`);
        }
    } else {
        lines.push('ok      no open high or critical alerts');
    }
    return { code: reasons.length ? 1 : 0, reasons, lines };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    let status;
    try {
        status = await fetchDetectionStatus(detectionConfig(root));
    } catch (err) {
        console.error(`could not read security_detection_status: ${err.message}`);
        process.exit(2);
    }
    const { code, lines } = evaluate(status);
    for (const line of lines) console.log(line);
    if (code === 0) {
        console.log('\nthe detection engine is alive and no high-severity alert is open');
        process.exit(0);
    }
    console.error('\nthe detection engine needs attention — see the lines above');
    process.exit(1);
}
