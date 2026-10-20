#!/usr/bin/env node
// Is the database answering? Reads the public GET /api/status (lib/upstreamStatus.js, ADR-0160) twice, a
// pause apart, so one blip is not an alert. Used by .github/workflows/supabase-status-alert.yml.
//   ok          at least one reading was ok
//   degraded    both readings were degraded
//   unreachable the site itself did not answer: site-health.yml owns that, so this never alerts
// Exit 0 ok, 1 degraded, 2 unreachable. With GITHUB_OUTPUT set, also writes `state=<word>`.
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DEFAULT_BASE_URL = 'https://veyrnox.ai';
const TIMEOUT_MS = 10_000;
const GAP_MS = 30_000;

export async function readOnce(baseUrl, fetchImpl = fetch) {
    try {
        const res = await fetchImpl(new URL('/api/status', baseUrl), { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
        if (!res.ok) return 'unreachable';
        const body = await res.json();
        return body && body.status === 'degraded' ? 'degraded' : 'ok';
    } catch {
        return 'unreachable';
    }
}

/** Two readings, `gapMs` apart. Degraded only when both agree; any ok wins; otherwise the site is unreachable. */
export async function checkStatus(baseUrl = DEFAULT_BASE_URL, { read = readOnce, gapMs = GAP_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    const first = await read(baseUrl);
    if (first === 'ok') return 'ok';
    await sleep(gapMs);
    const second = await read(baseUrl);
    if (second === 'ok') return 'ok';
    return first === 'degraded' && second === 'degraded' ? 'degraded' : 'unreachable';
}

export const EXIT_CODES = Object.freeze({ ok: 0, degraded: 1, unreachable: 2 });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const state = await checkStatus(process.env.BASE_URL || DEFAULT_BASE_URL);
    console.log(`supabase status: ${state}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `state=${state}\n`);
    process.exit(EXIT_CODES[state]);
}
