#!/usr/bin/env node
/**
 * Probe: Kling v3 Standard vs Pro image-to-video render time (and output size).
 * Writes nothing to the repo or database. Reads FAL_KEY from the environment; never prints it.
 *
 *   node scripts/probe-kling-v3-tiers.mjs --image-url=https://...        PLAN (free)
 *   (--image-file=/path/pic.jpg uploads the file to fal storage on --submit instead of a link)
 *   FAL_KEY=... node scripts/probe-kling-v3-tiers.mjs --submit --image-url=https://... [--duration=10] [--with-pro]
 *
 * PAID with --submit: one Standard run (about $0.14/s) and, with --with-pro, one Pro run ($0.112/s audio off).
 * Capped at 2 runs. Audio is pinned off, like the registry. Prints queue wait, render time, output
 * size and fal's request id (read the bill on fal's usage page; prices here are not trusted).
 */
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://queue.fal.run';
const POLL_MS = 4000;
const TIMEOUT_MS = 20 * 60 * 1000;
const args = process.argv.slice(2);
const flag = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const submit = args.includes('--submit');
const withPro = args.includes('--with-pro');
let imageUrl = flag('image-url');
const imageFile = flag('image-file') ?? (flag('image-url') ? undefined : join(homedir(), 'probe-image.jpg'));
const duration = flag('duration') ?? '10';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (m) => { console.error(m); process.exit(2); };

const RUNS = [
    { tier: 'standard', endpoint: 'fal-ai/kling-video/v3/standard/image-to-video' },
    ...(withPro ? [{ tier: 'pro', endpoint: 'fal-ai/kling-video/v3/pro/image-to-video' }] : []),
];

async function call(url, init, tries = 3) {
    for (let i = 0; i < tries; i++) {
        const r = await fetch(url, { ...init, headers: { Authorization: `Key ${process.env.FAL_KEY}`, 'Content-Type': 'application/json' } });
        if (r.ok) return r.json();
        if ((r.status === 429 || r.status >= 500) && i < tries - 1) { await sleep(2000 * (i + 1)); continue; }
        const body = await r.text();
        throw new Error(`${r.status} ${body.slice(0, 200)}`);
    }
}

async function run({ tier, endpoint }) {
    const t0 = Date.now();
    const q = await call(`${BASE}/${endpoint}`, { method: 'POST', body: JSON.stringify({ start_image_url: imageUrl, prompt: 'slow natural camera move, subtle motion', duration, generate_audio: false }) });
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
    console.log(JSON.stringify({ tier, request_id: q.request_id, queue_s: started ? (started - t0) / 1000 : null, render_s: ((end - (started ?? t0)) / 1000), total_s: (end - t0) / 1000, bytes: f.file_size, url: f.url }));
}

async function upload(path) {
    const ct = /\.png$/i.test(path) ? 'image/png' : 'image/jpeg';
    const init = await call('https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3', { method: 'POST', body: JSON.stringify({ content_type: ct, file_name: basename(path) }) });
    const put = await fetch(init.upload_url, { method: 'PUT', headers: { 'Content-Type': ct }, body: readFileSync(path) });
    if (!put.ok) throw new Error(`upload ${put.status}`);
    return init.file_url;
}

async function main() {
    if (imageFile && submit) {
        if (!process.env.FAL_KEY) die('FAL_KEY is not set.');
        imageUrl = await upload(imageFile);
    } else if (imageFile) imageUrl = 'https://example.invalid/uploaded-on-submit';
    if (!imageUrl || !/^https:\/\//.test(imageUrl)) die('Pass --image-url=https://... or --image-file=/path/to/picture.jpg.');
    console.log(`PLAN: ${RUNS.map((r) => `${r.tier} ${duration}s audio off`).join(' + ')}${submit ? '' : ' (dry run, add --submit to spend)'}`);
    if (!submit) return;
    if (!process.env.FAL_KEY) die('FAL_KEY is not set.');
    for (const r of RUNS) await run(r).catch((e) => console.error(`${r.tier} failed: ${e.message}`));
}

if (realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();
