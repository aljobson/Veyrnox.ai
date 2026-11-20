#!/usr/bin/env node
/**
 * Staging poll-path load test. NO CREDITS SPENT: it only reads.
 *
 * What it measures: the real Worker + Supabase path a waiting client hits, GET /api/v1/jobs/:id (or the cheaper
 * GET /api/v1/jobs list when no job id is given), at a ramp of simulated users, each polling every 2 s like the web UI.
 * It does not create jobs and never calls a provider, so it cannot measure provider rate limits or the check-on-read
 * provider fan-out (that needs fake providers behind staging; see docs in the PR).
 *
 * Safety:
 *   - refuses any host that is not localhost or a hostname with a staging label (staging, dev, test, qa, sandbox, preview)
 *   - tokens come from a file (one `<jwt>` or `<jwt> <job-uuid>` per line), never from argv
 *   - one user is limited to 600 job reads per 60 s (migration 0115), so one token = one simulated user
 *   - the ramp stops at the first stage whose 5xx rate or timeout rate passes the abort limit
 *
 *   node scripts/load-poll-staging.mjs --base https://STAGING_HOST --tokens ./tokens.txt \
 *       [--stages 10,50,100,250] [--stage-seconds 60] [--interval-ms 2000] [--abort-error-rate 0.05] [--dry-run]
 */
import { readFileSync } from 'node:fs';

const STAGING_LABEL = /(^|[.-])(staging|stage|dev|test|qa|sandbox|preview)([.-]|$)/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @returns {{ok: true, base: string} | {ok: false, reason: string}} */
export function checkBase(raw) {
    let url;
    try { url = new URL(raw); } catch { return { ok: false, reason: 'not_a_url' }; }
    const host = url.hostname;
    const local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
    if (!local && url.protocol !== 'https:') return { ok: false, reason: 'https_required' };
    if (!local && !STAGING_LABEL.test(host)) return { ok: false, reason: 'not_a_staging_host' };
    return { ok: true, base: url.origin };
}

/** @returns {{token: string, jobId: string|null}[]} */
export function parseTokens(text) {
    const users = [];
    for (const line of String(text).split('\n')) {
        const [token, jobId] = line.trim().split(/\s+/);
        if (!token || token.startsWith('#')) continue;
        users.push({ token, jobId: jobId && UUID.test(jobId) ? jobId : null });
    }
    return users;
}

export function percentile(sorted, p) {
    if (!sorted.length) return null;
    return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

/** One stage: `count` simulated users poll for `seconds`. Returns counts and latency percentiles (ms). */
export async function runStage({ base, users, count, seconds, intervalMs, timeoutMs = 10000, fetchImpl = fetch }) {
    const active = users.slice(0, count);
    const latencies = [];
    const status = {};
    let timeouts = 0;
    const stopAt = Date.now() + seconds * 1000;

    async function one(user, startDelay) {
        await new Promise((resolve) => setTimeout(resolve, startDelay));
        const path = user.jobId ? `/api/v1/jobs/${user.jobId}` : '/api/v1/jobs?limit=1';
        while (Date.now() < stopAt) {
            const began = Date.now();
            try {
                const response = await fetchImpl(`${base}${path}`, {
                    headers: { authorization: `Bearer ${user.token}`, accept: 'application/json' },
                    signal: AbortSignal.timeout(timeoutMs),
                });
                await response.arrayBuffer();
                latencies.push(Date.now() - began);
                status[response.status] = (status[response.status] || 0) + 1;
            } catch {
                timeouts += 1;
            }
            const wait = intervalMs - (Date.now() - began);
            if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        }
    }

    // Spread the first poll across one interval so the stage does not start with a single spike.
    await Promise.all(active.map((user, index) => one(user, Math.floor((index / Math.max(1, active.length)) * intervalMs))));
    latencies.sort((a, b) => a - b);
    const total = latencies.length + timeouts;
    const serverErrors = Object.entries(status).filter(([code]) => Number(code) >= 500).reduce((sum, [, n]) => sum + n, 0);
    return {
        users: active.length,
        requests: total,
        per_second: Number((total / seconds).toFixed(1)),
        status,
        timeouts,
        error_rate: total ? Number(((serverErrors + timeouts) / total).toFixed(4)) : 0,
        rate_limited: status[429] || 0,
        p50_ms: percentile(latencies, 50),
        p95_ms: percentile(latencies, 95),
        p99_ms: percentile(latencies, 99),
        max_ms: latencies.length ? latencies[latencies.length - 1] : null,
    };
}

function arg(name, fallback) {
    const index = process.argv.indexOf(`--${name}`);
    return index > -1 ? process.argv[index + 1] : fallback;
}

async function main() {
    const based = checkBase(arg('base', ''));
    if (!based.ok) { console.error(`refused: ${based.reason}. Only localhost or a staging-labelled host is allowed.`); process.exit(2); }
    const tokensPath = arg('tokens', '');
    if (!tokensPath) { console.error('--tokens <file> is required (one JWT per line, optionally followed by a job uuid)'); process.exit(2); }
    const users = parseTokens(readFileSync(tokensPath, 'utf8'));
    const stages = String(arg('stages', '10,50,100,250')).split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
    const seconds = Number(arg('stage-seconds', 60));
    const intervalMs = Number(arg('interval-ms', 2000));
    const abort = Number(arg('abort-error-rate', 0.05));
    const peak = Math.max(...stages);
    console.log(`PLAN: ${stages.join(' -> ')} users, ${seconds}s per stage, poll every ${intervalMs}ms, base ${based.base}, ${users.length} tokens loaded`);
    if (users.length < peak) { console.error(`need ${peak} tokens for the last stage, have ${users.length}`); process.exit(2); }
    if (process.argv.includes('--dry-run')) { console.log('dry run: nothing sent'); return; }

    for (const count of stages) {
        const result = await runStage({ base: based.base, users, count, seconds, intervalMs });
        console.log(JSON.stringify(result));
        if (result.error_rate > abort) { console.log(`ABORT: error rate ${result.error_rate} passed ${abort} at ${count} users`); process.exit(1); }
    }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) await main();
