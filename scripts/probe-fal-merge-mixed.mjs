#!/usr/bin/env node
/**
 * Probe for the Smart Cut / Clip Editor join failure (PR "refuse sound + silent clip joins").
 * Question: does `fal-ai/ffmpeg-api/merge-videos` fail when one clip has an audio stream and
 * another has none (a lip-sync clip beside a Wan reel)? Local ffmpeg's concat does.
 *
 * Two 2 s 720x1280 clips are made locally: SOUND (video + 440 Hz tone) and SILENT (video only).
 *
 *   PLAN   (default, free)  Make the clips, print their streams, send nothing.
 *   SUBMIT (--submit, PAID) Upload both (free), then ONE merge-videos job on [SOUND, SILENT]
 *                           (about $0.002; a failed job may not be billed). Prints fal's own
 *                           error text on failure, or the output's streams on success.
 *          --control        Also run [SILENT, SILENT] (expected to join, as Slice 0 T6 did).
 *          --reverse        Also run [SILENT, SOUND] (does the order matter?).
 *
 * Usage (a silent key prompt; the key is never printed):
 *   node scripts/probe-fal-merge-mixed.mjs
 *   read -s FAL_KEY && export FAL_KEY && node scripts/probe-fal-merge-mixed.mjs --submit [--control] [--reverse]
 *
 * Needs ffmpeg and ffprobe on the PATH. FAL key: PROD FAL (the account that bills merge-videos).
 * After a run, read each request_id's billed cost on fal's usage page.
 */
import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const ENDPOINT = 'fal-ai/ffmpeg-api/merge-videos';
const FAL_QUEUE_BASE = 'https://queue.fal.run';
const POLL_MS = 3000;
const TIMEOUT_MS = 10 * 60 * 1000;
const RETRIES = 2;

const args = process.argv.slice(2);
const submit = args.includes('--submit');
const key = process.env.FAL_KEY;
const authHeader = () => ({ Authorization: `Key ${key}`, 'Content-Type': 'application/json' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function die(msg) { console.error(msg); process.exit(2); }
if (submit && !key) die('FAL_KEY is not set.');

async function fetchRetry(url, init) {
    for (let i = 0; ; i++) {
        const res = await fetch(url, init);
        if ((res.status === 429 || res.status >= 500) && i < RETRIES) { await sleep(2000 * (i + 1)); continue; }
        return res;
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

function streams(src) {
    const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', src], { encoding: 'utf8', timeout: 60000 }));
    const v = j.streams.find((s) => s.codec_type === 'video');
    const a = j.streams.find((s) => s.codec_type === 'audio');
    return { container: Number(j.format?.duration ?? 0).toFixed(2), video: v ? `${v.codec_name} ${v.width}x${v.height} ${Number(v.duration ?? 0).toFixed(2)}s` : 'none',
        audio: a ? `${a.codec_name} ${Number(a.duration ?? 0).toFixed(2)}s` : 'none' };
}

/** One merge job. Resolves to { ok, requestId, detail, outUrl }. */
async function merge(label, urls) {
    const post = await fetchRetry(`${FAL_QUEUE_BASE}/${ENDPOINT}`, { method: 'POST', headers: authHeader(), body: JSON.stringify({ video_urls: urls }) });
    if (!post.ok) return { ok: false, detail: `submit ${post.status} ${(await post.text().catch(() => '')).slice(0, 400)}` };
    const q = await post.json();
    console.log(`  [${label}] request_id ${q.request_id}`);
    const t0 = Date.now();
    while (Date.now() - t0 < TIMEOUT_MS) {
        await sleep(POLL_MS);
        const st = await (await fetchRetry(q.status_url, { headers: authHeader() })).json();
        if (st.status === 'COMPLETED') break;
        if (st.status && st.status !== 'IN_QUEUE' && st.status !== 'IN_PROGRESS') return { ok: false, requestId: q.request_id, detail: `job ended as ${st.status}` };
    }
    const res = await fetchRetry(q.response_url, { headers: authHeader() });
    const body = await res.text().catch(() => '');
    if (!res.ok) return { ok: false, requestId: q.request_id, detail: `result ${res.status} ${body.slice(0, 600)}`, seconds: ((Date.now() - t0) / 1000).toFixed(0) };
    let outUrl;
    try { outUrl = JSON.parse(body)?.video?.url; } catch { /* handled below */ }
    return typeof outUrl === 'string'
        ? { ok: true, requestId: q.request_id, outUrl, seconds: ((Date.now() - t0) / 1000).toFixed(0) }
        : { ok: false, requestId: q.request_id, detail: `no video.url in the result: ${body.slice(0, 300)}` };
}

const dir = await mkdtemp(join(tmpdir(), 'merge-mixed-'));
try {
    const ff = (a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a], { timeout: 120000 });
    const video = ['-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=24:d=2'];
    const enc = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'];
    const sound = join(dir, 'sound.mp4');
    const silent = join(dir, 'silent.mp4');
    const silent2 = join(dir, 'silent2.mp4');
    ff([...video, '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', ...enc, '-c:a', 'aac', '-shortest', sound]);
    ff([...video, ...enc, silent]);
    ff([...video, ...enc, silent2]);

    console.log(submit ? 'SUBMIT: this spends fal credit (about $0.002 a job).\n' : 'PLAN: nothing is sent or spent.\n');
    console.log(`${ENDPOINT}\n  SOUND  ${JSON.stringify(streams(sound))}\n  SILENT ${JSON.stringify(streams(silent))}`);
    if (!submit) process.exit(0);

    const [uSound, uSilent, uSilent2] = [await uploadToFal(sound), await uploadToFal(silent), await uploadToFal(silent2)];
    const runs = [['SOUND+SILENT', [uSound, uSilent]]];
    if (args.includes('--reverse')) runs.push(['SILENT+SOUND', [uSilent, uSound]]);
    if (args.includes('--control')) runs.push(['SILENT+SILENT', [uSilent, uSilent2]]);

    for (const [label, urls] of runs) {
        const r = await merge(label, urls);
        if (!r.ok) { console.log(`  [${label}] FAILED${r.seconds ? ` after ${r.seconds} s` : ''}: ${r.detail}`); continue; }
        // ffprobe reads fal's output URL directly: nothing from the network is written to disk.
        console.log(`  [${label}] JOINED in ${r.seconds} s: ${JSON.stringify(streams(r.outUrl))}`);
    }
    console.log('\nRead the lines above. Only a failure that names a missing audio stream confirms the cause.');
    console.log('A 403 / "permission" / auth error means THIS KEY cannot use the endpoint: the probe proved nothing.');
    console.log('A join of SOUND+SILENT means the cause is something else. Read each request_id\'s billed cost on fal\'s usage page.');
} finally {
    await rm(dir, { recursive: true, force: true });
}
