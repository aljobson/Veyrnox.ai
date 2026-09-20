#!/usr/bin/env node
/**
 * ADR-0020 step 2 and 3 — verify the kie.ai rows against the live provider.
 *
 * The three kie rows have never been called. CLAUDE.md: a model is only
 * `active = true` once its provider_endpoint has been verified against the
 * live provider, so this produces the evidence a migration would cite. It
 * writes nothing to the catalog.
 *
 * It drives `packages/adapters/kie.js` rather than hand-rolling requests, so
 * what passes here is the exact path the Worker takes — same pinned duration
 * and resolution, same taskId parsing, same record interpretation.
 *
 * Two phases:
 *
 *   PLAN    (default, free)  Print the request body each row would send.
 *                            No network, nothing spent.
 *   SUBMIT  (--submit, PAID) Queue one real job per row, poll record-info
 *                            until it resolves, then check the output URL:
 *                            host, and whether it serves bytes directly.
 *
 * The output check is the one that matters most. `copyUrlToR2` refuses a
 * redirect, so a kie output URL that 302s would fail every job after the
 * debit and refund it — the failure mode ADR-0020 says to rule out before
 * flipping `active`.
 *
 * Usage:
 *   node scripts/verify-kie-endpoints.mjs                   # free plan
 *   node scripts/verify-kie-endpoints.mjs --submit          # SPENDS kie CREDIT
 *   node scripts/verify-kie-endpoints.mjs --submit --only=nano-banana-kie
 *
 * Reads KIE_API_KEY from the environment. Never prints it.
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { submitTask, fetchTask, buildRequest, parseEndpoint } from '../packages/adapters/kie.js';

// The catalog rows as migration 0074 leaves them. Costs are what kie.ai/pricing
// listed on 2026-09-18 and what the row carries; the run confirms or refutes.
const ROWS = [
    {
        id: 'nano-banana-kie',
        endpoint: 'market:google/nano-banana',
        credits: 3,
        cost: 0.02,
        unit: 'one image',
        inputs: { prompt: 'A lighthouse on a cliff at dawn, long exposure sea', aspect_ratio: '1:1' },
    },
    {
        id: 'veo-3.1-fast-kie',
        endpoint: 'veo:veo3_fast',
        credits: 46,
        cost: 0.3,
        unit: '8s 720p clip with audio',
        inputs: { prompt: 'Rain on a tin roof, water running off the edge, close up', aspect_ratio: '16:9' },
    },
    {
        id: 'veo-3.1-kie',
        endpoint: 'veo:veo3',
        credits: 122,
        cost: 1.25,
        unit: '8s 720p clip with audio',
        inputs: { prompt: 'A kestrel hovering over a summer meadow, slow motion', aspect_ratio: '16:9' },
    },
];

const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;
const KIE_OUTPUT_SUFFIX = '.aiquickdraw.com';

const args = process.argv.slice(2);
const doSubmit = args.includes('--submit');
const only = (args.find((a) => a.startsWith('--only=')) || '').slice('--only='.length);
// The adapter requires an https callback. We poll record-info instead of
// waiting for one, so this points at a path that does not exist: a stray
// callback 404s rather than reaching the real webhook without a job row.
const callbackUrl = (args.find((a) => a.startsWith('--callback=')) || '').slice('--callback='.length)
    || 'https://veyrnox.ai/_kie-verify-no-callback';

const targets = only ? ROWS.filter((r) => r.id === only) : ROWS;
if (!targets.length) {
    console.error(`--only=${only} matched nothing. Ids: ${ROWS.map((r) => r.id).join(', ')}`);
    process.exit(2);
}

// ---------------------------------------------------------------- plan

console.error(`PLAN (free): ${targets.length} row(s)\n`);
const planned = [];
for (const row of targets) {
    const target = parseEndpoint(row.endpoint);
    if (!target) {
        console.error(`  REJECTED  ${row.id} — the adapter does not accept ${row.endpoint}`);
        planned.push({ id: row.id, ok: false, note: 'parseEndpoint refused the provider_endpoint' });
        continue;
    }
    const req = buildRequest(target, row.inputs);
    if (!req.ok) {
        console.error(`  REJECTED  ${row.id} — ${req.error}`);
        planned.push({ id: row.id, ok: false, note: req.error });
        continue;
    }
    console.error(`  ok        ${row.id}  ${row.endpoint}  ->  ${JSON.stringify(req.body)}`);
    planned.push({ id: row.id, ok: true, body: req.body });
}

if (!doSubmit) {
    console.error('\nNothing submitted, nothing spent.');
    console.error('Re-run with --submit to queue one real job per row (THIS SPENDS kie CREDIT).');
    process.exit(planned.every((p) => p.ok) ? 0 : 1);
}

const apiKey = process.env.KIE_API_KEY;
if (!apiKey) {
    console.error('\nKIE_API_KEY is not set. Export it in your shell and re-run; this script never prints it.');
    process.exit(2);
}

// ---------------------------------------------------------------- submit

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll record-info until the task resolves or the budget runs out. */
async function waitForTask(endpoint, taskId) {
    const started = Date.now();
    while (Date.now() - started < POLL_TIMEOUT_MS) {
        await sleep(POLL_INTERVAL_MS);
        const rec = await fetchTask(endpoint, taskId, { apiKey });
        if (!rec.ok) return { state: 'error', note: rec.error, seconds: Math.round((Date.now() - started) / 1000) };
        if (rec.state === 'success') return { state: 'success', outputUrl: rec.outputUrl, seconds: Math.round((Date.now() - started) / 1000) };
        if (rec.state === 'fail') return { state: 'fail', note: rec.errorCode, seconds: Math.round((Date.now() - started) / 1000) };
    }
    return { state: 'timeout', seconds: Math.round((Date.now() - started) / 1000) };
}

/**
 * The copyUrlToR2 precondition: one request, redirects NOT followed. A 3xx
 * here means every job on this row would fail after its debit.
 */
async function checkOutputUrl(rawUrl) {
    let url;
    try { url = new URL(rawUrl); } catch { return { ok: false, note: 'output is not a URL' }; }

    const host = url.hostname;
    const hostExpected = host === KIE_OUTPUT_SUFFIX.slice(1) || host.endsWith(KIE_OUTPUT_SUFFIX);

    let res;
    try {
        res = await fetch(url, { redirect: 'manual' });
    } catch (err) {
        return { ok: false, host, hostExpected, note: `transport: ${err && err.message}` };
    }
    const redirected = res.status >= 300 && res.status < 400;
    const bytes = res.headers.get('content-length');
    return {
        ok: res.status === 200 && !redirected,
        host,
        hostExpected,
        status: res.status,
        redirected,
        location: redirected ? res.headers.get('location') : undefined,
        contentType: res.headers.get('content-type'),
        contentLength: bytes ? Number(bytes) : null,
        note: redirected ? 'REDIRECT — copyUrlToR2 refuses this, every job would refund' : undefined,
    };
}

const submittable = targets.filter((row) => planned.find((p) => p.id === row.id && p.ok));
const spend = submittable.reduce((sum, r) => sum + r.cost, 0);
console.error(`\nSUBMIT (paid): ${submittable.length} job(s), about $${spend.toFixed(2)} of kie credit.\n`);

const results = [];
for (const row of submittable) {
    const startedAt = Date.now();
    const sent = await submitTask(
        { job_id: `verify-${row.id}-${Date.now()}`, provider_endpoint: row.endpoint, inputs: row.inputs },
        { apiKey, callbackUrl },
    );
    if (!sent.ok) {
        console.error(`  FAIL      ${row.id} — submit rejected: ${sent.error}`);
        results.push({ id: row.id, endpoint: row.endpoint, ok: false, stage: 'submit', note: sent.error });
        continue;
    }
    console.error(`  queued    ${row.id}  taskId=${sent.providerJobId}`);

    const done = await waitForTask(row.endpoint, sent.providerJobId);
    if (done.state !== 'success') {
        console.error(`  FAIL      ${row.id} — ${done.state}${done.note ? `: ${done.note}` : ''} after ${done.seconds}s`);
        results.push({ id: row.id, endpoint: row.endpoint, ok: false, stage: done.state, taskId: sent.providerJobId, seconds: done.seconds, note: done.note });
        continue;
    }

    const out = await checkOutputUrl(done.outputUrl);
    const ok = out.ok && out.hostExpected;
    console.error(
        `  ${ok ? 'ok      ' : 'CHECK   '}  ${row.id} — ${done.seconds}s, host ${out.host}${out.hostExpected ? '' : ' (NOT ' + KIE_OUTPUT_SUFFIX + ')'}` +
        `, HTTP ${out.status ?? '-'}${out.redirected ? ' REDIRECT' : ''}${out.contentLength ? `, ${out.contentLength} bytes` : ''}`,
    );
    if (out.note) console.error(`            ${out.note}`);

    results.push({
        id: row.id,
        endpoint: row.endpoint,
        ok,
        taskId: sent.providerJobId,
        seconds: done.seconds,
        wallSeconds: Math.round((Date.now() - startedAt) / 1000),
        catalogCredits: row.credits,
        catalogCost: row.cost,
        unit: row.unit,
        output: out,
    });
}

// Merge rather than overwrite: a --only run must not erase the evidence for
// the rows verified before it. A migration cites this file for all of them.
const RESULTS_PATH = 'scripts/.kie-verify-results.json';
let merged = results;
if (existsSync(RESULTS_PATH)) {
    try {
        const prior = JSON.parse(readFileSync(RESULTS_PATH, 'utf8'));
        if (Array.isArray(prior)) {
            const fresh = new Set(results.map((r) => r.id));
            merged = [...prior.filter((r) => !fresh.has(r.id)), ...results];
        }
    } catch { /* unreadable file: this run's results replace it */ }
}
writeFileSync(RESULTS_PATH, JSON.stringify(merged, null, 2));

const passed = results.filter((r) => r.ok);
console.error(`\n${passed.length}/${results.length} rows produced a usable output.`);
console.error('Written to scripts/.kie-verify-results.json');
console.error('kie does not report cost per call here — read it off the kie dashboard against these taskIds');
console.error('and check it against the ADR-0014 floor before flipping `active` in a migration.');
process.exit(passed.length === results.length ? 0 : 1);
