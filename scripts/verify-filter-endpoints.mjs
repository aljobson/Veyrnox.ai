#!/usr/bin/env node
/**
 * Slice 0 — verify the face-filter candidate endpoints against live fal.
 *
 * CLAUDE.md: a model is only `active = true` once its provider_endpoint has
 * been verified against the live provider. The Seedance cycle (migrations
 * 0045-0057) is what happens when that rule is skipped, so nothing here
 * writes to the catalog — it produces the evidence a migration would cite.
 *
 * Two phases, because they cost differently:
 *
 *   PROBE   (default, free)  Fetch each endpoint's OpenAPI schema. Answers
 *                            "does this endpoint exist, and what inputs does
 *                            it actually take" without submitting anything.
 *   SUBMIT  (--submit, PAID) Queue one real job per endpoint with a test
 *                            image and wait for the result. This is what
 *                            establishes latency, output shape, and real
 *                            cost. Every call spends fal credits.
 *
 * Usage:
 *   node scripts/verify-filter-endpoints.mjs                # free probe
 *   node scripts/verify-filter-endpoints.mjs --submit       # SPENDS MONEY
 *   node scripts/verify-filter-endpoints.mjs --submit --only=retouch
 *
 * Reads FAL_KEY from the environment. Never prints it.
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';

// PRD A1-A6, the launch set. A7/A8 (identity lock, face swap) are gated
// behind PRD section 6 and deliberately absent.
const CANDIDATES = [
    { id: 'retouch', feature: 'A1 skin retouch', endpoint: 'fal-ai/image-editing/retouch' },
    { id: 'retoucher', feature: 'A1 alternate', endpoint: 'fal-ai/retoucher' },
    { id: 'face-enhance', feature: 'A2 face enhancement', endpoint: 'fal-ai/image-editing/face-enhancement' },
    { id: 'iclight', feature: 'A3 relight (image)', endpoint: 'fal-ai/iclight-v2' },
    { id: 'lightx-relight', feature: 'A3 alternate', endpoint: 'fal-ai/lightx/relight' },
    { id: 'makeup', feature: 'A4 digital makeup', endpoint: 'fal-ai/image-apps-v2/makeup-application' },
    { id: 'age-modify', feature: 'A5 age modify', endpoint: 'fal-ai/image-apps-v2/age-modify' },
    { id: 'relight-video', feature: 'A6 relight (video)', endpoint: 'fal-ai/id-v2v/relight' },
];

// A stable, public, obviously-synthetic portrait to send as the source.
// Override with TEST_IMAGE_URL to use one of our own R2 outputs instead.
const TEST_IMAGE = process.env.TEST_IMAGE_URL
    || 'https://storage.googleapis.com/falserverless/model_tests/retoucher/GGsAolHXsAA58vn.jpeg';

const QUEUE = 'https://queue.fal.run';
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 420000;

const args = process.argv.slice(2);
const doSubmit = args.includes('--submit');
const only = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1];
const onlyIds = only ? only.split(',').map((x) => x.trim()).filter(Boolean) : null;

function loadKey() {
    if (process.env.FAL_KEY) return process.env.FAL_KEY;
    // Convenience: read .env.local, which .gitignore already covers.
    for (const f of ['.env.local', '.env']) {
        if (!existsSync(f)) continue;
        const m = /^FAL_KEY=(.+)$/m.exec(readFileSync(f, 'utf8'));
        if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
    return null;
}

const FAL_KEY = loadKey();
if (!FAL_KEY) {
    console.error('FAL_KEY not set. Put it in .env.local (already gitignored) or export it.');
    console.error('Do not paste it into a chat — CLAUDE.md requires rotating any secret that does.');
    process.exit(2);
}
const auth = { Authorization: `Key ${FAL_KEY}` };

/** Free: does this endpoint exist, and what does it take? */
async function probe(c) {
    const url = `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(c.endpoint)}`;
    let res;
    try {
        res = await fetch(url, { headers: { 'user-agent': 'veyrnox-slice0/1.0' } });
    } catch (err) {
        return { ...c, exists: false, note: `transport: ${err.message}` };
    }
    if (!res.ok) return { ...c, exists: false, note: `schema HTTP ${res.status}` };

    let spec;
    try { spec = await res.json(); } catch { return { ...c, exists: false, note: 'schema not JSON' }; }

    // Pull the input schema's property names — that is what tells us whether
    // it takes image_url/video_url and what else it expects.
    const schemas = (spec.components && spec.components.schemas) || {};
    const inputKey = Object.keys(schemas).find((k) => /input/i.test(k));
    const props = inputKey && schemas[inputKey] && schemas[inputKey].properties
        ? Object.keys(schemas[inputKey].properties)
        : [];
    const required = (inputKey && schemas[inputKey] && schemas[inputKey].required) || [];

    return {
        ...c,
        exists: true,
        inputs: props,
        required,
        takesImage: props.includes('image_url'),
        takesVideo: props.includes('video_url'),
    };
}

/** PAID: queue one real job and wait for it. */
async function submit(c) {
    const payload = c.takesVideo && !c.takesImage
        ? { video_url: process.env.TEST_VIDEO_URL || TEST_IMAGE }
        : { image_url: TEST_IMAGE };
    // Some endpoints want an instruction alongside the source.
    if ((c.required || []).includes('prompt')) payload.prompt = 'subtle, natural result';

    const started = Date.now();
    let res;
    try {
        res = await fetch(`${QUEUE}/${c.endpoint}`, {
            method: 'POST',
            headers: { ...auth, 'content-type': 'application/json' },
            body: JSON.stringify(payload),
        });
    } catch (err) {
        return { ...c, submitted: false, note: `submit transport: ${err.message}` };
    }
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ...c, submitted: false, note: `submit HTTP ${res.status}: ${text.slice(0, 180)}` };
    }
    const { request_id: requestId, status_url: statusUrl, response_url: responseUrl } = await res.json();

    while (Date.now() - started < POLL_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const s = await fetch(statusUrl || `${QUEUE}/${c.endpoint}/requests/${requestId}/status`, { headers: auth });
        if (!s.ok) continue;
        const statusBody = await s.json();
        const { status } = statusBody;
        if (status === 'COMPLETED') {
            const inferenceSeconds = statusBody?.metrics?.inference_time ?? null;
            const r = await fetch(responseUrl || `${QUEUE}/${c.endpoint}/requests/${requestId}`, { headers: auth });
            const out = await r.json().catch(() => ({}));
            const outUrl = out?.image?.url || out?.images?.[0]?.url || out?.video?.url || null;
            return {
                ...c, submitted: true, ok: true, requestId,
                // Wall clock includes queue wait; inference is the provider's
                // own number. A cold endpoint can queue for minutes while
                // computing for seconds, and the user waits for both.
                seconds: Math.round((Date.now() - started) / 1000),
                inferenceSeconds,
                outputUrl: outUrl,
                outputKeys: Object.keys(out || {}),
            };
        }
        if (status === 'FAILED') {
            return { ...c, submitted: true, ok: false, requestId, note: 'provider reported FAILED' };
        }
    }
    return { ...c, submitted: true, ok: false, requestId, note: 'timed out waiting for the result' };
}

const targets = onlyIds ? CANDIDATES.filter((c) => onlyIds.includes(c.id)) : CANDIDATES;
if (!targets.length) {
    console.error(`--only=${only} matched nothing. Ids: ${CANDIDATES.map((c) => c.id).join(', ')}`);
    process.exit(2);
}

console.error(`PROBE (free): ${targets.length} endpoint(s)\n`);
const probed = [];
for (const c of targets) {
    const r = await probe(c);
    probed.push(r);
    console.error(
        r.exists
            ? `  ok    ${r.endpoint}\n        inputs: ${r.inputs.join(', ') || '(none found)'}`
            : `  DEAD  ${r.endpoint} — ${r.note}`,
    );
}

const live = probed.filter((r) => r.exists);
if (!doSubmit) {
    console.error(`\n${live.length}/${targets.length} endpoints resolved.`);
    console.error('No jobs submitted and nothing spent. Re-run with --submit to queue one real job each (THIS COSTS MONEY).');
    writeFileSync('scripts/.slice0-probe.json', JSON.stringify(probed, null, 2));
    console.error('Probe written to scripts/.slice0-probe.json');
    process.exit(0);
}

console.error(`\nSUBMIT (paid): ${live.length} job(s). Each one spends fal credits.\n`);
const results = [];
for (const c of live) {
    const r = await submit(c);
    results.push(r);
    console.error(r.ok
        ? `  ok    ${r.endpoint} — ${r.seconds}s, output: ${r.outputUrl ? 'yes' : 'no url in ' + r.outputKeys.join('/')}`
        : `  FAIL  ${r.endpoint} — ${r.note}`);
}

writeFileSync('scripts/.slice0-results.json', JSON.stringify(results, null, 2));
console.error(`\n${results.filter((r) => r.ok).length}/${results.length} produced output.`);
console.error('Written to scripts/.slice0-results.json');
console.error('Cost per call is NOT in this output — read it from the fal dashboard and pair it with these ids before writing any catalog row.');
