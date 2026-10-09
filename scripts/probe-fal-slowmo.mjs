#!/usr/bin/env node
/**
 * Slice 0 probe for Clip Editor slow motion (docs/editor/SPEED.md).
 * Checks fal's `topaz/interpolate/video` against the live provider before any
 * catalog row, migration or orchestrator code exists. It writes nothing to the
 * repo or the database.
 *
 *   SCHEMA (--schema, free)  Print the endpoint's live input and output schema.
 *   PLAN   (default, free)   Print the requests --submit would send.
 *   SUBMIT (--submit, PAID)  Upload any --video-file to fal storage (free), queue
 *                            one job per clip, poll to the end, check the output
 *                            serves bytes directly (copyUrlToR2 refuses a
 *                            redirect), and with ffprobe print size, frame rate,
 *                            duration and audio for input and output side by side.
 *
 * What it answers: does the output run slowdown_factor times longer, does the
 * audio come back (and stretched, silent, or dropped), what frame rate and
 * resolution come out, how long it takes, and what fal bills (read the usage
 * page for each request id, the price here is not trusted).
 *
 * Usage:
 *   node scripts/probe-fal-slowmo.mjs --schema
 *   node scripts/probe-fal-slowmo.mjs --video-file=./clip.mp4 --factor=2
 *   FAL_KEY=... node scripts/probe-fal-slowmo.mjs --submit --video-file=./clip.mp4 --factor=2 [--fps=30] [--model=Apollo]
 *
 * Keep clips short (5 s or less) and run one at a time: fal says the extra
 * generated frames are billed like interpolated frames, so cost grows with the
 * factor and the target frame rate. The run count is capped at 2. Reads FAL_KEY
 * from the environment and never prints it.
 */
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const ENDPOINT = 'topaz/interpolate/video';
const FAL_QUEUE_BASE = 'https://queue.fal.run';
const SCHEMA_URL = `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${ENDPOINT}`;
const POLL_MS = 4000;
const TIMEOUT_MS = 15 * 60 * 1000;
const MAX_RUNS = 2;
const RETRIES = 2;
const MODELS = ['Apollo', 'Chronos', 'Aion'];

const args = process.argv.slice(2);
const flag = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const all = (n) => args.filter((a) => a.startsWith(`--${n}=`)).map((a) => a.slice(n.length + 3));
const submit = args.includes('--submit');
const schemaOnly = args.includes('--schema');
const videoUrls = all('video-url');
const videoFiles = all('video-file');
const factor = Number(flag('factor') ?? 2);
const fps = flag('fps') === undefined ? undefined : Number(flag('fps'));
const model = flag('model') ?? 'Apollo';

const key = process.env.FAL_KEY;
const authHeader = () => ({ Authorization: `Key ${key}`, 'Content-Type': 'application/json' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function die(msg) { console.error(msg); process.exit(2); }

if (!Number.isInteger(factor) || factor < 1 || factor > 8) die('--factor must be a whole number from 1 to 8 (fal\'s own limits).');
if (fps !== undefined && !(Number.isInteger(fps) && fps >= 16 && fps <= 120)) die('--fps must be a whole number from 16 to 120.');
if (!MODELS.includes(model)) die(`--model must be one of ${MODELS.join(', ')}.`);

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
    for (const [name, s] of Object.entries(doc?.components?.schemas ?? {})) {
        if (!/input|output/i.test(name)) continue;
        console.log(`\n${name}  required: ${JSON.stringify(s.required ?? [])}`);
        for (const [prop, def] of Object.entries(s.properties ?? {})) {
            const lim = def.minimum !== undefined ? ` ${def.minimum}..${def.maximum}` : '';
            const en = def.enum ? ` enum ${JSON.stringify(def.enum)}` : '';
            console.log(`  ${prop}: ${def.type ?? def.$ref ?? 'object'}${lim}${en} default ${JSON.stringify(def.default)}\n      ${(def.description ?? '').replace(/\s+/g, ' ').slice(0, 220)}`);
        }
    }
}

async function uploadToFal(path) {
    const bytes = await readFile(path);
    const init = await fetchRetry('https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3', {
        method: 'POST', headers: authHeader(), body: JSON.stringify({ content_type: 'video/mp4', file_name: basename(path) }) });
    if (!init.ok) die(`upload initiate failed for ${path}: ${init.status} ${(await init.text().catch(() => '')).slice(0, 200)}`);
    const { upload_url: uploadUrl, file_url: fileUrl } = await init.json();
    const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: bytes });
    if (!put.ok) die(`upload failed for ${path}: ${put.status}`);
    return fileUrl;
}

function probe(url) {
    try {
        const out = execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', url],
            { encoding: 'utf8', timeout: 60000 });
        const j = JSON.parse(out);
        const v = j.streams.find((s) => s.codec_type === 'video');
        const a = j.streams.find((s) => s.codec_type === 'audio');
        return { size: v ? `${v.width}x${v.height}` : null, fps: v?.avg_frame_rate ?? null, vcodec: v?.codec_name ?? null,
            seconds: Number(j.format?.duration ?? 0).toFixed(2), audio: a ? `${a.codec_name} ${Number(a.duration ?? 0).toFixed(2)}s` : 'none' };
    } catch (e) {
        return e.code === 'ENOENT' ? 'ffprobe not installed' : 'ffprobe failed';
    }
}

// H264_output is always on: fal's default is H265, which most browsers will not play in the Library.
const payloadFor = (url) => ({ video_url: url, slowdown_factor: factor, model, H264_output: true, ...(fps !== undefined ? { target_fps: fps } : {}) });

async function run(url) {
    const post = await fetchRetry(`${FAL_QUEUE_BASE}/${ENDPOINT}`, { method: 'POST', headers: authHeader(), body: JSON.stringify(payloadFor(url)) });
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
    const outUrl = out?.video?.url;
    if (typeof outUrl !== 'string') return { ok: false, step: 'shape', status: 'no video.url in the result', body: JSON.stringify(out).slice(0, 400) };
    const head = await fetch(outUrl, { redirect: 'manual' });
    const input = probe(url);
    const output = probe(outUrl);
    const expected = typeof input === 'object' ? (Number(input.seconds) * factor).toFixed(2) : null;
    return { ok: head.status === 200, step: 'output', status: head.status, host: new URL(outUrl).host,
        contentType: head.headers.get('content-type'), bytes: head.headers.get('content-length'),
        seconds: ((Date.now() - t0) / 1000).toFixed(0), expectedOutputSeconds: expected, input, output };
}

if (schemaOnly) { await printSchema(); process.exit(0); }

console.log(submit ? 'SUBMIT: this spends fal credit.\n' : 'PLAN: nothing is sent or spent.\n');
if (videoUrls.length + videoFiles.length === 0) die('Pass --video-file=./clip.mp4 or --video-url=https://...');
if (videoUrls.length + videoFiles.length > MAX_RUNS) die(`At most ${MAX_RUNS} clips per run (cost cap).`);
for (const u of videoUrls) {
    let host = '';
    try { host = new URL(u).hostname; } catch { die(`Not a valid URL: ${u}`); }
    if (!u.startsWith('https://') || !/^[a-z0-9.-]+$/i.test(host) || !host.includes('.')) die(`Not a real https URL (placeholder?): ${u}`);
}
if (submit && !key) die('FAL_KEY is not set.');
if (videoFiles.length > 0 && !submit) console.log(`(plan: ${videoFiles.length} file(s) would be uploaded to fal storage first, which is free)\n`);
if (submit) for (const f of videoFiles) videoUrls.push(await uploadToFal(f));

let failed = false;
for (const url of (submit ? videoUrls : [...videoUrls, ...videoFiles.map((f) => `file:${f}`)])) {
    console.log(`${ENDPOINT}  ${url}`);
    console.log(`  payload: ${JSON.stringify(payloadFor(url))}`);
    if (!submit) continue;
    const r = await run(url);
    console.log(`  result: ${JSON.stringify(r, null, 2).replace(/\n/g, '\n  ')}`);
    if (!r.ok) failed = true;
}
if (submit) console.log("\nNow read each request_id's billed cost on fal's usage page.");
process.exit(failed ? 1 : 0);
