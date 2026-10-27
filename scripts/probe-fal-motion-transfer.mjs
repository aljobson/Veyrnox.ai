#!/usr/bin/env node
/**
 * Staging probe for motion transfer (ADR-0269). Writes nothing to the repo or
 * the database. Use the STAGING fal key.
 *
 *   PLAN   (default, free)   Check the inputs and print every request.
 *   SUBMIT (--submit, PAID)  Upload the files to fal storage (free), then run:
 *                              1. Kling 3.0 Motion Control Std, person photo + clip
 *                              2. Kling 3.0 Motion Control Std, pet photo + clip
 *                              3. Wan 2.2 Animate Replace 720p, person photo + clip
 *                            and print each output's host, length, size and audio.
 *   --generate --out=<dir>   Instead of your files, first make a fictional person,
 *                            a fictional dog (Nano Banana, 9:16) and a 5 s walking
 *                            clip (Kling 3.0 Std text-to-video, silent) from our own
 *                            prompts, save them in <dir>, trim the clip to 5.0 s
 *                            and use them. No real person's likeness is involved.
 *
 * Cost at fal's 2026-10-27 prices: probe 2 x $0.63 + $0.40 = $1.66; --generate
 * adds 2 x $0.0398 + 5 x $0.14 = $0.78. The clip must be ours and at most
 * 5.05 s; a longer clip is refused before anything is sent. Never use a clip
 * taken from another service, including the files in public/showcase.
 *
 * Answers: does fal bill the clip's length (read each request id on fal's usage
 * page), does Kling keep a pet, which host serves the output (r2Copy allowlist),
 * does the output come back silent.
 *
 * Usage (paste the key at the hidden prompt; it is never printed):
 *   node scripts/probe-fal-motion-transfer.mjs --generate --out=./motion-probe
 *   printf 'STAGING fal key: '; read -s FAL_KEY; echo; export FAL_KEY
 *   node scripts/probe-fal-motion-transfer.mjs --submit --generate --out=./motion-probe
 *   node scripts/probe-fal-motion-transfer.mjs [--submit] --photo=./me.jpg --pet-photo=./dog.jpg --clip=./walk.mp4
 */
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';

const FAL_QUEUE_BASE = 'https://queue.fal.run';
const KLING = 'fal-ai/kling-video/v3/standard/motion-control';
const WAN = 'fal-ai/wan/v2.2-14b/animate/replace';
const IMAGE = 'fal-ai/nano-banana';
const CLIP = 'fal-ai/kling-video/v3/standard/text-to-video';
const MAX_CLIP_SECONDS = 5.05;
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const POLL_MS = 5000;
const TIMEOUT_MS = 20 * 60 * 1000;
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.mov': 'video/quicktime' };

// Our own wording; fictional subjects only.
const STUDIO = 'plain light grey studio background, soft even light, photorealistic, vertical 9:16, no text, no logos';
const GENERATE = {
    photo: { endpoint: IMAGE, file: 'person.jpg', body: { aspect_ratio: '9:16', num_images: 1, output_format: 'jpeg',
        prompt: `Full-body photo of a fictional adult woman in her thirties, plain white t-shirt, blue jeans and white sneakers, standing facing the camera with arms relaxed, whole body visible head to toe, ${STUDIO}` } },
    petPhoto: { endpoint: IMAGE, file: 'dog.jpg', body: { aspect_ratio: '9:16', num_images: 1, output_format: 'jpeg',
        prompt: `Full-body photo of a golden retriever standing on all four legs facing the camera, whole dog visible, ${STUDIO}` } },
    clip: { endpoint: CLIP, file: 'walk-raw.mp4', body: { duration: '5', aspect_ratio: '9:16', generate_audio: false,
        prompt: 'A fictional adult man in a plain navy t-shirt, grey trousers and white sneakers walks steadily toward the camera along an empty, plain city pavement. His whole body is visible head to toe for the entire shot. The camera slowly dollies backward, keeping him centred. Daylight, no other people, no text, no logos.' } },
};

const args = process.argv.slice(2);
const flag = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const submit = args.includes('--submit');
const generate = args.includes('--generate');
const outDir = flag('out');
const files = { photo: flag('photo'), petPhoto: flag('pet-photo'), clip: flag('clip') };
const key = process.env.FAL_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const authHeader = () => ({ Authorization: `Key ${key}`, 'Content-Type': 'application/json' });
function die(msg) { console.error(msg); process.exit(2); }

function ffprobe(path) {
    try {
        const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], { encoding: 'utf8', timeout: 60000 }));
        const v = j.streams.find((s) => s.codec_type === 'video');
        const a = j.streams.find((s) => s.codec_type === 'audio');
        return { seconds: Number(j.format?.duration ?? NaN), size: v ? `${v.width}x${v.height}` : null, audio: a ? a.codec_name : 'none' };
    } catch (e) {
        die(e.code === 'ENOENT' ? 'ffprobe is not installed (brew install ffmpeg).' : `ffprobe could not read ${path}`);
    }
}

async function checkFile(label, path, kinds) {
    if (!path) die(`Pass --${label}=<file>, or use --generate --out=<dir>.`);
    if (/PHOTO|EXAMPLE|your-|path\/to/i.test(path)) die(`--${label} looks like a placeholder: ${path}`);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) die(`--${label}: ${path} was not found. Drag the real file into Terminal to paste its path.`);
    const type = TYPES[extname(path).toLowerCase()];
    if (!type || !kinds.some((k) => type.startsWith(k))) die(`--${label}: unsupported file type ${extname(path)}`);
    return type;
}

async function uploadToFal(path, contentType) {
    const init = await fetch('https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3', {
        method: 'POST', headers: authHeader(), body: JSON.stringify({ content_type: contentType, file_name: basename(path) }) });
    if (!init.ok) die(`upload initiate failed for ${path}: ${init.status}`);
    const { upload_url: uploadUrl, file_url: fileUrl } = await init.json();
    const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: await readFile(path) });
    if (!put.ok) die(`upload failed for ${path}: ${put.status}`);
    return fileUrl;
}

/** Queue one fal job and wait for its result. */
async function queue(endpoint, body) {
    const post = await fetch(`${FAL_QUEUE_BASE}/${endpoint}`, { method: 'POST', headers: authHeader(), body: JSON.stringify(body) });
    if (!post.ok) return { ok: false, step: 'submit', status: post.status, detail: (await post.text().catch(() => '')).slice(0, 400) };
    const q = await post.json();
    console.log(`  request_id ${q.request_id}`);
    const t0 = Date.now();
    for (;;) {
        if (Date.now() - t0 > TIMEOUT_MS) return { ok: false, step: 'poll', status: 'timeout', requestId: q.request_id };
        await sleep(POLL_MS);
        const st = await (await fetch(q.status_url, { headers: authHeader() })).json();
        if (st.status === 'COMPLETED') break;
        if (st.status !== 'IN_QUEUE' && st.status !== 'IN_PROGRESS') return { ok: false, step: 'poll', status: st.status, requestId: q.request_id };
    }
    const res = await fetch(q.response_url, { headers: authHeader() });
    if (!res.ok) return { ok: false, step: 'result', status: res.status, detail: (await res.text().catch(() => '')).slice(0, 400), requestId: q.request_id };
    return { ok: true, out: await res.json(), requestId: q.request_id, took: `${((Date.now() - t0) / 1000).toFixed(0)} s` };
}

async function makeInputs() {
    await mkdir(outDir, { recursive: true });
    const made = {};
    for (const [name, g] of Object.entries(GENERATE)) {
        console.log(`\ngenerate ${name}  ${g.endpoint}`);
        const r = await queue(g.endpoint, g.body);
        const url = r.ok ? (r.out?.images?.[0]?.url ?? r.out?.video?.url) : null;
        if (typeof url !== 'string') die(`  generation failed: ${JSON.stringify({ ...r, out: undefined })}`);
        // Save only fal's own media, over https, within a size cap; the file name is ours, never the URL's.
        let host = '';
        try { host = new URL(url).hostname; } catch { die('  generation returned an invalid URL'); }
        if (!url.startsWith('https://') || !(host === 'fal.media' || host.endsWith('.fal.media'))) die(`  refusing to download from ${host}`);
        const got = await fetch(url, { redirect: 'error' });
        if (!got.ok) die(`  download failed: ${got.status}`);
        const bytes = Buffer.from(await got.arrayBuffer());
        if (bytes.length > MAX_DOWNLOAD_BYTES) die(`  download too large: ${bytes.length} bytes`);
        made[name] = join(outDir, g.file);
        await writeFile(made[name], bytes);
        console.log(`  saved ${made[name]}`);
    }
    const trimmed = join(outDir, 'walk.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', made.clip, '-t', '5', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', trimmed]);
    console.log(`  trimmed to ${trimmed}`);
    return { ...made, clip: trimmed };
}

// The same pinned fields lib/motionCapabilities.js sends.
const runs = (u) => [
    { label: 'kling person', endpoint: KLING, body: { image_url: u.photo, video_url: u.clip, character_orientation: 'image', keep_original_sound: false, enable_safety_checker: true } },
    { label: 'kling pet', endpoint: KLING, body: { image_url: u.petPhoto, video_url: u.clip, character_orientation: 'image', keep_original_sound: false, enable_safety_checker: true } },
    { label: 'wan replace', endpoint: WAN, body: { image_url: u.photo, video_url: u.clip, resolution: '720p', enable_safety_checker: true, enable_output_safety_checker: true } },
];

async function probe(r) {
    const q = await queue(r.endpoint, r.body);
    if (!q.ok) return q;
    const url = q.out?.video?.url;
    if (typeof url !== 'string') return { ok: false, step: 'shape', keys: Object.keys(q.out ?? {}), requestId: q.requestId };
    const head = await fetch(url, { redirect: 'manual' });
    return { ok: head.status === 200, requestId: q.requestId, outputKeys: Object.keys(q.out), host: new URL(url).host,
        status: head.status, contentType: head.headers.get('content-type'), took: q.took, output: ffprobe(url), url };
}

const cost = generate ? '$2.44 ($0.78 to generate the inputs, $1.66 for the probe)' : '$1.66';
console.log(submit ? `SUBMIT: this spends about ${cost} of fal credit. Use the STAGING key.\n` : 'PLAN: nothing is sent or spent.\n');
if (generate) {
    if (!outDir) die('--generate needs --out=<dir> for the generated files.');
    if (Object.values(files).some(Boolean)) die('Use either --generate or your own --photo/--pet-photo/--clip, not both.');
    if (!submit) {
        for (const [name, g] of Object.entries(GENERATE)) console.log(`generate ${name}  ${g.endpoint}\n  ${JSON.stringify(g.body)}`);
        for (const r of runs({ photo: 'generated person.jpg', petPhoto: 'generated dog.jpg', clip: 'generated walk.mp4' })) console.log(`${r.label}  ${r.endpoint}\n  ${JSON.stringify(r.body)}`);
        console.log(`\nAdd --submit to run them. Files will be saved in ${resolve(outDir)}.`);
        process.exit(0);
    }
    if (!key) die('FAL_KEY is not set. Use the STAGING key.');
    Object.assign(files, await makeInputs());
}
const types = {
    photo: await checkFile('photo', files.photo, ['image/']),
    petPhoto: await checkFile('pet-photo', files.petPhoto, ['image/']),
    clip: await checkFile('clip', files.clip, ['video/']),
};
const clipInfo = ffprobe(files.clip);
console.log(`\nclip: ${clipInfo.seconds.toFixed(2)} s, ${clipInfo.size}, audio ${clipInfo.audio}`);
if (!(clipInfo.seconds > 0 && clipInfo.seconds <= MAX_CLIP_SECONDS)) die(`The clip must be at most ${MAX_CLIP_SECONDS} s (cost cap). Trim it: ffmpeg -i in.mp4 -t 5 -an walk.mp4`);
if (!submit) {
    for (const r of runs({ photo: `file:${files.photo}`, petPhoto: `file:${files.petPhoto}`, clip: `file:${files.clip}` })) console.log(`${r.label}  ${r.endpoint}\n  ${JSON.stringify(r.body)}`);
    console.log('\nAdd --submit to run them.');
    process.exit(0);
}
if (!key) die('FAL_KEY is not set. Use the STAGING key.');
const urls = {};
for (const [name, path] of Object.entries(files)) urls[name] = await uploadToFal(path, types[name]);
let failed = false;
for (const r of runs(urls)) {
    console.log(`\n${r.label}  ${r.endpoint}`);
    const result = await probe(r);
    console.log(`  ${JSON.stringify(result, null, 2).replace(/\n/g, '\n  ')}`);
    if (!result.ok) failed = true;
}
console.log("\nNow read each request_id's billed seconds and cost on fal's usage page.");
process.exit(failed ? 1 : 0);
