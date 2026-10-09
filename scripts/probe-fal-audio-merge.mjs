#!/usr/bin/env node
/**
 * Slice 0 probe for the Clip Editor's audio step on a slowed clip
 * (docs/editor/SPEED.md). Question: when `fal-ai/ffmpeg-api/merge-audio-video`
 * is given a video that already carries its own sound, does the new soundtrack
 * REPLACE it, MIX with it, or does the old sound win?
 *
 * Slow motion from Topaz comes back with its audio unstretched (5.04 s of voice
 * inside a 10.04 s file). This probe uses a local stand-in with the same shape
 * (--video-file, made with ffmpeg setpts=2*PTS and the audio left alone) and a
 * steady 440 Hz tone as the soundtrack (--audio-file), so no Topaz run is
 * spent. A pure tone has a flat loudness; a voice does not, so the loudness of
 * the output, second by second, shows what is in it.
 *
 *   PLAN   (default, free)  Print what would run.
 *   SUBMIT (--submit, PAID) One merge-audio-video job (about $0.002), upload of
 *                           both files first (free), then download the result and
 *                           measure it with ffmpeg.
 *
 * Usage:
 *   node scripts/probe-fal-audio-merge.mjs --video-file=./mimic-slowed.mp4 --audio-file=./tone-440-10s.m4a
 *   FAL_KEY=... node scripts/probe-fal-audio-merge.mjs --submit --video-file=... --audio-file=...
 *
 * Needs ffmpeg and ffprobe on the PATH. Reads FAL_KEY from the environment and
 * never prints it. After a run, read the request id's billed cost on fal's usage page.
 */
import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const ENDPOINT = 'fal-ai/ffmpeg-api/merge-audio-video';
const FAL_QUEUE_BASE = 'https://queue.fal.run';
const POLL_MS = 3000;
const TIMEOUT_MS = 10 * 60 * 1000;
const RETRIES = 2;

const args = process.argv.slice(2);
const flag = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const submit = args.includes('--submit');
const videoFile = flag('video-file');
const audioFile = flag('audio-file');
const key = process.env.FAL_KEY;
const authHeader = () => ({ Authorization: `Key ${key}`, 'Content-Type': 'application/json' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function die(msg) { console.error(msg); process.exit(2); }

if (!videoFile || !audioFile) die('Pass --video-file=./video.mp4 and --audio-file=./sound.m4a');
if (submit && !key) die('FAL_KEY is not set.');

async function fetchRetry(url, init) {
    for (let i = 0; ; i++) {
        const res = await fetch(url, init);
        if ((res.status === 429 || res.status >= 500) && i < RETRIES) { await sleep(2000 * (i + 1)); continue; }
        return res;
    }
}

async function uploadToFal(path, contentType) {
    const bytes = await readFile(path);
    const init = await fetchRetry('https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3', {
        method: 'POST', headers: authHeader(), body: JSON.stringify({ content_type: contentType, file_name: basename(path) }) });
    if (!init.ok) die(`upload initiate failed for ${path}: ${init.status} ${(await init.text().catch(() => '')).slice(0, 200)}`);
    const { upload_url: uploadUrl, file_url: fileUrl } = await init.json();
    const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: bytes });
    if (!put.ok) die(`upload failed for ${path}: ${put.status}`);
    return fileUrl;
}

const contentTypeOf = (p) => (/\.(m4a|aac)$/i.test(p) ? 'audio/mp4' : /\.mp3$/i.test(p) ? 'audio/mpeg' : /\.wav$/i.test(p) ? 'audio/wav' : 'video/mp4');

/** Streams and lengths of one local or remote file. */
function streams(src) {
    const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', src], { encoding: 'utf8', timeout: 60000 }));
    const v = j.streams.find((s) => s.codec_type === 'video');
    const a = j.streams.find((s) => s.codec_type === 'audio');
    return { container: Number(j.format?.duration ?? 0).toFixed(2), video: v ? `${v.width}x${v.height} ${Number(v.duration ?? 0).toFixed(2)}s` : 'none',
        audio: a ? `${a.codec_name} ${Number(a.duration ?? 0).toFixed(2)}s` : 'none' };
}

/** Loudness (dB RMS) of the audio, one number per second. */
function loudnessPerSecond(src) {
    const out = execFileSync('ffmpeg', ['-v', 'error', '-i', src, '-vn', '-af',
        'aresample=44100,asetnsamples=n=44100:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-', '-f', 'null', '-'],
    { encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
    return [...out.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) => (m[1] === '-inf' ? -90 : Number(m[1])));
}

const spread = (xs) => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0);

console.log(submit ? 'SUBMIT: this spends fal credit (about $0.002).\n' : 'PLAN: nothing is sent or spent.\n');
console.log(`${ENDPOINT}\n  video: ${videoFile} ${JSON.stringify(streams(videoFile))}\n  audio: ${audioFile} ${JSON.stringify(streams(audioFile))}`);
const videoOwn = loudnessPerSecond(videoFile);
const toneOwn = loudnessPerSecond(audioFile);
console.log(`  video's own sound, dB per second: ${videoOwn.map((x) => x.toFixed(0)).join(' ')}  (spread ${spread(videoOwn).toFixed(1)} dB)`);
console.log(`  soundtrack, dB per second:        ${toneOwn.map((x) => x.toFixed(0)).join(' ')}  (spread ${spread(toneOwn).toFixed(1)} dB)`);
if (!submit) process.exit(0);

const videoUrl = await uploadToFal(videoFile, 'video/mp4');
const audioUrl = await uploadToFal(audioFile, contentTypeOf(audioFile));
const post = await fetchRetry(`${FAL_QUEUE_BASE}/${ENDPOINT}`, { method: 'POST', headers: authHeader(), body: JSON.stringify({ video_url: videoUrl, audio_url: audioUrl, start_offset: 0 }) });
if (!post.ok) die(`submit failed: ${post.status} ${(await post.text().catch(() => '')).slice(0, 300)}`);
const q = await post.json();
console.log(`  request_id ${q.request_id}`);
const t0 = Date.now();
let state = '';
while (Date.now() - t0 < TIMEOUT_MS) {
    await sleep(POLL_MS);
    const st = await (await fetchRetry(q.status_url, { headers: authHeader() })).json();
    state = st.status;
    if (state === 'COMPLETED') break;
    if (state && state !== 'IN_QUEUE' && state !== 'IN_PROGRESS') die(`job ended as ${state}`);
}
const res = await fetchRetry(q.response_url, { headers: authHeader() });
if (!res.ok) die(`result failed: ${res.status} ${(await res.text().catch(() => '')).slice(0, 300)}`);
const outUrl = (await res.json())?.video?.url;
if (typeof outUrl !== 'string') die('no video.url in the result');
const head = await fetch(outUrl, { redirect: 'manual' });

const dir = await mkdtemp(join(tmpdir(), 'audio-merge-'));
try {
    const local = join(dir, 'out.mp4');
    await writeFile(local, Buffer.from(await (await fetch(outUrl)).arrayBuffer()));
    const outLoud = loudnessPerSecond(local);
    // The stand-in clip's own voice ends at 5 s, so a mix is louder in the first half
    // (voice + tone) than in the second (tone only); a replacement is as even as the tone.
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
    const first = mean(outLoud.slice(0, 5));
    const second = mean(outLoud.slice(6, 10));
    const toneLevel = mean(toneOwn);
    const diff = first - second;
    console.log(`  finished in ${((Date.now() - t0) / 1000).toFixed(0)} s; download ${head.status} from ${new URL(outUrl).host}`);
    console.log(`  output streams: ${JSON.stringify(streams(local))}`);
    console.log(`  output sound, dB per second:      ${outLoud.map((x) => x.toFixed(0)).join(' ')}`);
    console.log(`  first 5 s ${first.toFixed(1)} dB, last 4 s ${second.toFixed(1)} dB (difference ${diff.toFixed(1)}), tone alone ${toneLevel.toFixed(1)} dB`);
    let verdict;
    if (diff > 3) verdict = 'MIXED or the clip\'s own sound survives (the first half is louder than the tone-only second half)';
    else if (Math.abs(diff) < 2 && Math.abs(first - toneLevel) < 3) verdict = 'REPLACED (both halves are as steady and as loud as the tone alone; the clip\'s own voice is gone)';
    else verdict = 'INCONCLUSIVE (the numbers above do not match either pattern; look at them)';
    console.log(`  VERDICT: ${verdict}`);
} finally {
    await rm(dir, { recursive: true, force: true });
}
console.log("\nNow read this request_id's billed cost on fal's usage page.");
