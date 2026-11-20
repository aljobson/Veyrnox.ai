#!/usr/bin/env node
/**
 * Probe: Kling 2.6 Pro text-to-video render time on fal, for comparison with Crun (5.4 to 11.3 min on 2026-11-19).
 * Writes nothing to the repo or database. Reads FAL_KEY from the environment; never prints it.
 *
 *   node scripts/probe-kling-26-fal.mjs                      PLAN (free)
 *   FAL_KEY=... node scripts/probe-kling-26-fal.mjs --submit [--runs=3]
 *
 * PAID with --submit: one fal run per --runs (default 1, at most 3), run one after another. fal Kling 2.6 Pro
 * text-to-video, 5 s, audio off, 16:9: $0.07/s = $0.35 a run (lib/modelCapabilities.js, migration 0083; the bill is
 * the source, so read each request id on fal's usage page). Use the STAGING key (veyrnox.ai-staging), not production.
 * Prints queue wait, render time, total time, output size and fal's request id.
 */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = 'https://queue.fal.run';
const ENDPOINT = 'fal-ai/kling-video/v2.6/pro/text-to-video';
const PROMPT = 'slow natural camera move, subtle motion, three friends smiling';
const POLL_MS = 4000;
const TIMEOUT_MS = 20 * 60 * 1000;
const MAX_RUNS = 3;
const args = process.argv.slice(2);
const flag = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const submit = args.includes('--submit');
const runs = Math.min(MAX_RUNS, Math.max(1, Number(flag('runs') ?? 1) || 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (m) => { console.error(m); process.exit(2); };

async function call(url, init, tries = 3) {
    for (let i = 0; i < tries; i++) {
        const r = await fetch(url, { ...init, headers: { Authorization: `Key ${process.env.FAL_KEY}`, 'Content-Type': 'application/json' } });
        if (r.ok) return r.json();
        if ((r.status === 429 || r.status >= 500) && i < tries - 1) { await sleep(2000 * (i + 1)); continue; }
        throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
    }
}

async function run(n) {
    const t0 = Date.now();
    const q = await call(`${BASE}/${ENDPOINT}`, { method: 'POST', body: JSON.stringify({ prompt: PROMPT, duration: '5', aspect_ratio: '16:9', generate_audio: false }) });
    let started = null;
    for (;;) {
        if (Date.now() - t0 > TIMEOUT_MS) throw new Error('timeout');
        const s = await call(q.status_url, { method: 'GET' });
        if (s.status === 'IN_PROGRESS' && !started) started = Date.now();
        if (s.status === 'COMPLETED') break;
        await sleep(POLL_MS);
    }
    const end = Date.now();
    const out = await call(q.response_url, { method: 'GET' });
    const f = out.video ?? {};
    console.log(JSON.stringify({ run: n, request_id: q.request_id, queue_s: started ? (started - t0) / 1000 : null, render_s: (end - (started ?? t0)) / 1000, total_s: (end - t0) / 1000, bytes: f.file_size }));
}

async function main() {
    console.log(`PLAN: ${runs} x ${ENDPOINT}, 5 s, audio off (about $${(runs * 0.35).toFixed(2)})${submit ? '' : ' (dry run, add --submit to spend)'}`);
    if (!submit) return;
    if (!process.env.FAL_KEY) die('FAL_KEY is not set.');
    for (let n = 1; n <= runs; n++) await run(n).catch((e) => console.error(`run ${n} failed: ${e.message}`));
}

if (realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();
