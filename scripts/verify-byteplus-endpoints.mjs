#!/usr/bin/env node
/**
 * ADR-0058 "Before activating any row", item 6: verify the BytePlus ModelArk
 * rows against the live provider. Writes nothing to the catalog.
 *
 * It drives `packages/adapters/byteplus.js`, so what passes here is the exact
 * path the Worker takes: same pinned model, resolution and duration, same task
 * id parsing, same task interpretation.
 *
 *   PLAN    (default, free)  Print the request body each row would send.
 *   SUBMIT  (--submit, PAID) Queue one real task per row, poll until it
 *                            resolves, then report: the output host (to put
 *                            in packages/adapters/r2Copy.js), whether the URL
 *                            serves bytes with no redirect, and the billed
 *                            tokens times the row's pack rate against the
 *                            cost the row carries.
 *
 * The output check is the one that matters most. `copyUrlToR2` refuses a
 * redirect and refuses any host not on the byteplus allowlist, which is
 * deliberately empty until this script has recorded a live host.
 *
 * Usage:
 *   node scripts/verify-byteplus-endpoints.mjs                     # free plan
 *   node scripts/verify-byteplus-endpoints.mjs --submit            # SPENDS BytePlus balance
 *   node scripts/verify-byteplus-endpoints.mjs --submit --only=seedance-2.0-fast-byteplus
 *
 * Reads BYTEPLUS_API_KEY from the environment. Never prints it.
 */

import { writeFileSync } from 'node:fs';
import { submitTask, fetchTask, buildRequest } from '../packages/adapters/byteplus.js';

// Rows as migration 0145 stages them. `usdPerMToken` is the rate the cost
// was derived from (resource pack for 2.x, PAYG for 1.0 Pro Fast); the run
// multiplies it by the tokens ModelArk reports as billed.
const ROWS = [
    { id: 'seedance-2.0-fast-byteplus', endpoint: 'byteplus:seedance-2.0-fast', credits: 20, cost: 0.35, usdPerMToken: 3.30,
        inputs: { prompt: 'A paper boat drifting down a rain gutter, macro, soft light', aspect_ratio: '16:9', duration_seconds: 5 } },
    { id: 'seedance-2.0-mini-byteplus', endpoint: 'byteplus:seedance-2.0-mini', credits: 13, cost: 0.23, usdPerMToken: 2.10,
        inputs: { prompt: 'A red kite catching wind over a grass hill, wide shot', aspect_ratio: '16:9', duration_seconds: 5 } },
    { id: 'seedance-2.0-byteplus', endpoint: 'byteplus:seedance-2.0', credits: 27, cost: 0.47, usdPerMToken: 4.30,
        inputs: { prompt: 'Waves rolling onto a pebble beach at dusk, gentle wind', aspect_ratio: '16:9', duration_seconds: 5 } },
    { id: 'seedance-2.5-byteplus', endpoint: 'byteplus:seedance-2.5', credits: 39, cost: 0.69, usdPerMToken: 6.40,
        inputs: { prompt: 'A lantern floating up a misty river at night, slow drift', aspect_ratio: '16:9', duration_seconds: 5 } },
    { id: 'seedance-1.0-pro-fast-byteplus', endpoint: 'byteplus:seedance-1.0-pro-fast', credits: 6, cost: 0.10, usdPerMToken: 1.00,
        inputs: { prompt: 'Rain on a tin roof, water running off the edge, close up', aspect_ratio: '16:9', duration_seconds: 5 } },
];

const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 15 * 60 * 1000;
const COST_TOLERANCE = 0.05;

const args = process.argv.slice(2);
const doSubmit = args.includes('--submit');
const only = (args.find((a) => a.startsWith('--only=')) || '').slice('--only='.length);
const targets = only ? ROWS.filter((r) => r.id === only) : ROWS;
if (!targets.length) {
    console.error(`--only=${only} matched nothing. Ids: ${ROWS.map((r) => r.id).join(', ')}`);
    process.exit(2);
}

// ---------------------------------------------------------------- plan

console.error(`PLAN (free): ${targets.length} row(s)\n`);
const planned = [];
for (const row of targets) {
    const req = buildRequest(row.endpoint, row.inputs);
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
    console.error('Re-run with --submit to queue one real task per row (THIS SPENDS BytePlus BALANCE OR PACK TOKENS).');
    process.exit(planned.every((p) => p.ok) ? 0 : 1);
}

const apiKey = process.env.BYTEPLUS_API_KEY;
if (!apiKey) {
    console.error('\nBYTEPLUS_API_KEY is not set. Export it in your shell and re-run; this script never prints it.');
    process.exit(2);
}

// ---------------------------------------------------------------- submit

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForTask(taskId) {
    const started = Date.now();
    while (Date.now() - started < POLL_TIMEOUT_MS) {
        await sleep(POLL_INTERVAL_MS);
        const rec = await fetchTask(taskId, { apiKey });
        const seconds = Math.round((Date.now() - started) / 1000);
        if (!rec.ok) return { state: 'error', note: rec.error, seconds };
        if (rec.state === 'success') return { state: 'success', outputUrl: rec.outputUrl, completionTokens: rec.completionTokens, seconds };
        if (rec.state === 'fail') return { state: 'fail', note: rec.errorCode, seconds };
    }
    return { state: 'timeout', seconds: Math.round((Date.now() - started) / 1000) };
}

/** The copyUrlToR2 precondition: one request, redirects NOT followed. */
async function checkOutputUrl(rawUrl) {
    let url;
    try { url = new URL(rawUrl); } catch { return { ok: false, note: 'output is not a URL' }; }
    let res;
    try {
        res = await fetch(url, { redirect: 'manual' });
    } catch (err) {
        return { ok: false, host: url.hostname, note: `transport: ${err && err.message}` };
    }
    const redirected = res.status >= 300 && res.status < 400;
    const bytes = res.headers.get('content-length');
    return {
        ok: res.status === 200 && !redirected && url.protocol === 'https:',
        host: url.hostname,
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
console.error(`\nSUBMIT (paid): ${submittable.length} task(s), about $${spend.toFixed(2)} at the recorded rates.\n`);

const results = [];
for (const row of submittable) {
    const sent = await submitTask({ job_id: `verify-${row.id}-${Date.now()}`, provider_endpoint: row.endpoint, inputs: row.inputs }, { apiKey });
    if (!sent.ok) {
        console.error(`  SUBMIT FAILED  ${row.id} — ${sent.errorCode}`);
        results.push({ id: row.id, submitted: false, note: sent.errorCode });
        continue;
    }
    console.error(`  queued    ${row.id}  task ${sent.providerJobId}`);
    const done = await waitForTask(sent.providerJobId);
    const result = { id: row.id, endpoint: row.endpoint, taskId: sent.providerJobId, credits: row.credits, recordedCost: row.cost, ...done };
    if (done.state === 'success') {
        result.output = await checkOutputUrl(done.outputUrl);
        if (Number.isFinite(done.completionTokens)) {
            result.billedCost = Number(((done.completionTokens / 1_000_000) * row.usdPerMToken).toFixed(4));
            result.costWithinTolerance = Math.abs(result.billedCost - row.cost) <= row.cost * COST_TOLERANCE;
        }
        console.error(`  ${result.output.ok ? 'OK       ' : 'PROBLEM  '} ${row.id}  ${done.seconds}s  host=${result.output.host}`
            + `  status=${result.output.status}${result.output.redirected ? ' REDIRECT' : ''}`
            + `  tokens=${done.completionTokens ?? '?'}  billed=$${result.billedCost ?? '?'} vs $${row.cost}`
            + `${result.costWithinTolerance === false ? '  COST DRIFT' : ''}`);
    } else {
        console.error(`  ${done.state.toUpperCase()}  ${row.id}  ${done.seconds}s  ${done.note || ''}`);
    }
    results.push(result);
}

const outPath = `byteplus-verify-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(outPath, JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
console.error(`\nEvidence written to ${outPath}. Record the output host in the activating migration and in r2Copy.js.`);
const allGood = results.length && results.every((r) => r.state === 'success' && r.output?.ok && r.costWithinTolerance !== false);
process.exit(allGood ? 0 : 1);
