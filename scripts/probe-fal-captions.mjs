#!/usr/bin/env node
/**
 * Slice 0 probe for Clip Editor captions (docs/editor/CAPTIONS.md).
 * Checks fal's `veed/subtitles` against the live provider before any catalog
 * row, migration or orchestrator code exists. It writes nothing to the repo.
 *
 *   SCHEMA (--schema, free)  Fetch the endpoint's public OpenAPI input/output
 *                            schema and print it. No key needed.
 *   PLAN   (default, free)   Print the requests that --submit would send.
 *   SUBMIT (--submit, PAID)  Queue one real job per --video-url, poll until it
 *                            resolves, check the output serves bytes directly
 *                            (copyUrlToR2 refuses a redirect), and if ffprobe is
 *                            installed print the output's size, duration,
 *                            frame rate and audio, next to the input's.
 *
 * Usage:
 *   node scripts/probe-fal-captions.mjs --schema
 *   node scripts/probe-fal-captions.mjs --video-url=https://a.mp4 --video-url=https://b.mp4
 *   FAL_KEY=... node scripts/probe-fal-captions.mjs --submit --video-url=https://a.mp4 [--preset=simple] [--extra='{"language":"en"}']
 *
 * Pick clips that answer the Slice 0 questions: a 5 s landscape, a 5 s
 * portrait, a 15 s clip, and one with no speech. Each is billed separately
 * (fal reports a 1-minute minimum), so the run count is capped at 4.
 * `preset` is required by the endpoint (default `simple`; --schema lists all 30).
 * --extra is merged into the payload, for fields --schema shows. Reads FAL_KEY
 * from the environment and never prints it. After a run, open fal's usage page
 * and compare each request id's billed cost with the number printed here.
 */
import { execFileSync } from 'node:child_process';

const ENDPOINT = 'veed/subtitles';
const FAL_QUEUE_BASE = 'https://queue.fal.run';
const SCHEMA_URL = `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${ENDPOINT}`;
const POLL_MS = 4000;
const TIMEOUT_MS = 10 * 60 * 1000;
const MAX_RUNS = 4;
const RETRIES = 2;

const args = process.argv.slice(2);
const submit = args.includes('--submit');
const schemaOnly = args.includes('--schema');
const videoUrls = args.filter((a) => a.startsWith('--video-url=')).map((a) => a.slice(12));
const preset = args.find((a) => a.startsWith('--preset='))?.slice(9) ?? 'simple';
const extraRaw = args.find((a) => a.startsWith('--extra='))?.slice(8);

const key = process.env.FAL_KEY;
const authHeader = () => ({ Authorization: `Key ${key}`, 'Content-Type': 'application/json' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function die(msg) { console.error(msg); process.exit(2); }

let extra = {};
if (extraRaw) {
    try { extra = JSON.parse(extraRaw); } catch { die('--extra must be valid JSON.'); }
}

async function fetchRetry(url, init) {
    for (let i = 0; ; i++) {
        const res = await fetch(url, init);
        if ((res.status === 429 || res.status >= 500) && i < RETRIES) { await sleep(2000 * (i + 1)); continue; }
        return res;
    }
}

async function printSchema() {
    const res = await fetchRetry(SCHEMA_URL);
    if (!res.ok) die(`schema fetch failed: ${res.status}`);
    const doc = await res.json();
    const schemas = doc?.components?.schemas ?? {};
    for (const [name, s] of Object.entries(schemas)) {
        if (!/input|output/i.test(name)) continue;
        console.log(`\n${name}`);
        console.log(`  required: ${JSON.stringify(s.required ?? [])}`);
        for (const [prop, def] of Object.entries(s.properties ?? {})) {
            const detail = def.enum ? ` enum ${JSON.stringify(def.enum)}` : '';
            const dflt = def.default !== undefined ? ` default ${JSON.stringify(def.default)}` : '';
            console.log(`  ${prop}: ${def.type ?? def.$ref ?? 'object'}${detail}${dflt}`);
        }
    }
}

function probe(url) {
    try {
        const out = execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', url],
            { encoding: 'utf8', timeout: 60000 });
        const j = JSON.parse(out);
        const v = j.streams.find((s) => s.codec_type === 'video');
        const a = j.streams.find((s) => s.codec_type === 'audio');
        return { size: v ? `${v.width}x${v.height}` : null, fps: v?.avg_frame_rate ?? null,
            seconds: Number(j.format?.duration ?? 0).toFixed(2), audio: a ? a.codec_name : 'none' };
    } catch (e) {
        return e.code === 'ENOENT' ? 'ffprobe not installed' : 'ffprobe failed';
    }
}

async function run(url) {
    const payload = { video_url: url, preset, ...extra };
    const post = await fetchRetry(`${FAL_QUEUE_BASE}/${ENDPOINT}`, { method: 'POST', headers: authHeader(), body: JSON.stringify(payload) });
    if (!post.ok) return { ok: false, step: 'submit', status: post.status, detail: (await post.text().catch(() => '')).slice(0, 400) };
    const q = await post.json();
    console.log(`  request_id ${q.request_id}`);
    const t0 = Date.now();
    while (Date.now() - t0 < TIMEOUT_MS) {
        await sleep(POLL_MS);
        const st = await (await fetchRetry(q.status_url, { headers: authHeader() })).json();
        if (st.status === 'COMPLETED') break;
        if (st.status && st.status !== 'IN_QUEUE' && st.status !== 'IN_PROGRESS') return { ok: false, step: 'poll', status: st.status };
    }
    const res = await fetchRetry(q.response_url, { headers: authHeader() });
    if (!res.ok) return { ok: false, step: 'result', status: res.status, detail: (await res.text().catch(() => '')).slice(0, 400) };
    const out = await res.json();
    console.log(`  output keys: ${Object.keys(out).join(', ')}`);
    const outUrl = out?.video?.url ?? out?.video_url ?? out?.url;
    if (typeof outUrl !== 'string') return { ok: false, step: 'shape', status: 'no video url in the result', body: JSON.stringify(out).slice(0, 400) };
    const head = await fetch(outUrl, { redirect: 'manual' });
    return { ok: head.status === 200, step: 'output', status: head.status, host: new URL(outUrl).host,
        contentType: head.headers.get('content-type'), bytes: head.headers.get('content-length'),
        seconds: ((Date.now() - t0) / 1000).toFixed(0), input: probe(url), output: probe(outUrl) };
}

if (schemaOnly) { await printSchema(); process.exit(0); }

console.log(submit ? 'SUBMIT: this spends fal credit.\n' : 'PLAN: nothing is sent or spent.\n');
if (videoUrls.length === 0) die('Pass at least one --video-url=https://... (a public clip).');
if (videoUrls.length > MAX_RUNS) die(`At most ${MAX_RUNS} clips per run (cost cap).`);
for (const u of videoUrls) {
    if (!u.startsWith('https://')) die(`Not an https URL: ${u}`);
    let host = '';
    try { host = new URL(u).hostname; } catch { die(`Not a valid URL: ${u}`); }
    if (!/^[a-z0-9.-]+$/i.test(host) || !host.includes('.')) die(`Not a real host (placeholder?): ${u}`);
    if (/your-public-clip|real-link|example\.(com|test)/i.test(u)) die(`That is still a placeholder: ${u}`);
}
if (submit && !key) die('FAL_KEY is not set.');

let failed = false;
for (const url of videoUrls) {
    console.log(`${ENDPOINT}  ${url}`);
    console.log(`  payload: ${JSON.stringify({ video_url: url, preset, ...extra })}`);
    if (!submit) continue;
    const r = await run(url);
    console.log(`  result: ${JSON.stringify(r, null, 2).replace(/\n/g, '\n  ')}`);
    if (!r.ok) failed = true;
}
if (submit) console.log("\nNow confirm each request_id on fal's usage page was billed the expected cost.");
process.exit(failed ? 1 : 0);
