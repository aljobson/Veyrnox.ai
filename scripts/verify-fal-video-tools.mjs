#!/usr/bin/env node
/**
 * Verify the two staged fal video rows (migration 0202) against the live
 * provider. CLAUDE.md: a model is only `active = true` once its
 * provider_endpoint has been verified live. This produces the evidence the
 * activation migration cites. It writes nothing to the catalog.
 *
 * It builds each payload with lib/modelCapabilities.js, so what runs here is
 * the request the Worker would send: same pinned duration, upscale factor,
 * fps and codec.
 *
 *   PLAN   (default, free)  Print each request. No network, nothing spent.
 *   SUBMIT (--submit, PAID) Queue one real job per row on fal, poll until it
 *                           resolves, then check the output URL serves bytes
 *                           directly (copyUrlToR2 refuses a redirect).
 *
 * Usage:
 *   node scripts/verify-fal-video-tools.mjs
 *   FAL_KEY=... node scripts/verify-fal-video-tools.mjs --submit --video-url=https://... [--only=mmaudio-v2-video]
 *
 * --video-url must be a public https clip of at most 8 seconds (the smaller
 * cap of the two rows) and small in size: Topaz bills by output resolution,
 * so a 360p clip lands in the cheapest tier. Reads FAL_KEY from the
 * environment and never prints it. After a run, open fal's usage page and
 * confirm each request id was billed the cost printed below.
 */
import { REGISTRY, shapePayload } from '../lib/modelCapabilities.js';

const FAL_QUEUE_BASE = 'https://queue.fal.run';
const POLL_MS = 4000;
const TIMEOUT_MS = 10 * 60 * 1000;

const ROWS = [
    { id: 'mmaudio-v2-video', endpoint: 'fal-ai/mmaudio-v2', expect: '$0.008 (8s of audio at $0.001/s); catalog 1 Credit',
        inputs: { prompt: 'Soft ambient sound that fits the scene' } },
    { id: 'topaz-upscale-video', endpoint: 'fal-ai/topaz/upscale/video', expect: 'tiered: $0.01/s to 720p, $0.02/s to 1080p, $0.08/s above, per second of the clip; catalog 49 Credits is the worst case for 10s. MEASURED 2026-10-05: 5 s 960x540 billed $0.24 and 5.7 s 1920x1080 billed $0.48 (about $0.084 per source-second), both above this table',
        inputs: {} },
];

const args = process.argv.slice(2);
const submit = args.includes('--submit');
const only = args.find((a) => a.startsWith('--only='))?.slice(7);
const videoUrl = args.find((a) => a.startsWith('--video-url='))?.slice(12);
const rows = ROWS.filter((r) => !only || r.id === only);
if (rows.length === 0) { console.error(`no such row: ${only}`); process.exit(2); }

const key = process.env.FAL_KEY;
const authHeader = () => ({ Authorization: `Key ${key}`, 'Content-Type': 'application/json' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function payloadFor(row) {
    const record = REGISTRY[row.endpoint];
    return shapePayload(record, { ...row.inputs, ...(videoUrl ? { video_url: videoUrl } : {}) });
}

async function run(row) {
    const payload = payloadFor(row);
    const post = await fetch(`${FAL_QUEUE_BASE}/${row.endpoint}`, { method: 'POST', headers: authHeader(), body: JSON.stringify(payload) });
    if (!post.ok) return { ok: false, step: 'submit', status: post.status };
    const q = await post.json();
    console.log(`  request_id ${q.request_id}`);
    const t0 = Date.now();
    while (Date.now() - t0 < TIMEOUT_MS) {
        await sleep(POLL_MS);
        const st = await (await fetch(q.status_url, { headers: authHeader() })).json();
        if (st.status === 'COMPLETED') break;
        if (st.status && st.status !== 'IN_QUEUE' && st.status !== 'IN_PROGRESS') return { ok: false, step: 'poll', status: st.status };
    }
    const res = await fetch(q.response_url, { headers: authHeader() });
    if (!res.ok) {
        // fal's validation detail (a bad or unreachable source URL, an over-long clip) is not a secret.
        const detail = (await res.text().catch(() => '')).slice(0, 400);
        return { ok: false, step: 'result', status: res.status, detail };
    }
    const out = await res.json();
    const url = out?.video?.url;
    if (typeof url !== 'string') return { ok: false, step: 'shape', status: 'no video.url in the result' };
    const head = await fetch(url, { method: 'GET', redirect: 'manual' });
    return { ok: head.status === 200, step: 'output', status: head.status, host: new URL(url).host,
        contentType: head.headers.get('content-type'), bytes: head.headers.get('content-length'), seconds: ((Date.now() - t0) / 1000).toFixed(0) };
}

console.log(submit ? 'SUBMIT: this spends fal credit.\n' : 'PLAN: nothing is sent or spent.\n');
if (submit && !key) { console.error('FAL_KEY is not set.'); process.exit(2); }
if (submit && !videoUrl?.startsWith('https://')) { console.error('--video-url=https://... is required with --submit.'); process.exit(2); }
if (submit && /your-public-clip|example\.(com|test)/i.test(videoUrl)) { console.error('--video-url is still the placeholder: use a real, public https clip.'); process.exit(2); }

let failed = false;
for (const row of rows) {
    console.log(`${row.id}  (${row.endpoint})`);
    console.log(`  expected cost: ${row.expect}`);
    console.log(`  payload: ${JSON.stringify(payloadFor(row))}`);
    if (!submit) continue;
    const r = await run(row);
    console.log(`  result: ${JSON.stringify(r)}`);
    if (!r.ok) failed = true;
}
if (submit) console.log('\nNow confirm each request_id on fal\'s usage page was billed the expected cost.');
process.exit(failed ? 1 : 0);
