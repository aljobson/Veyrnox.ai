#!/usr/bin/env node
/**
 * Auto Short, slice 0 (docs/auto-short/SPEC.md §8): prove the stitch.
 *
 * Runs the pipeline once outside the product, with no DB rows and no ledger:
 *   1. voice   fal ElevenLabs Turbo 2.5, fixed narration, word timestamps
 *   2. scenes  4 × kie Veo 3.1 Lite, 8s 9:16, in parallel
 *   3. stitch  fal ffmpeg-api/compose: one video track (4 clips) + one audio track
 * then downloads the MP4 so a human can check it: 32s, voice audible, and what
 * the Veo clips' own audio does under the voice (compose has no volume control).
 *
 *   node scripts/verify-auto-short-stitch.mjs            # free plan
 *   node scripts/verify-auto-short-stitch.mjs --submit   # SPENDS about $0.70
 *
 * Reads FAL_KEY and KIE_API_KEY from the environment. Never prints them.
 */

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { submitJob } from '../packages/adapters/fal.js';
import { submitTask, fetchTask } from '../packages/adapters/kie.js';

const TTS = 'fal-ai/elevenlabs/tts/turbo-v2.5';
const COMPOSE = 'fal-ai/ffmpeg-api/compose';
const SCENE = 'veo:veo3_lite';
const SCENE_MS = 8000;
// Callbacks point at a path that does not exist; this script polls instead.
const NO_CALLBACK = 'https://veyrnox.ai/_auto-short-verify-no-callback';
const POLL_MS = 10_000;
const TIMEOUT_MS = 12 * 60 * 1000;

const NARRATION =
    'Octopuses have three hearts. Two pump blood through the gills, and one ' +
    'keeps the rest of the body going. Their blood is blue, because it carries ' +
    'copper instead of iron. And each of their eight arms can taste what it ' +
    'touches, so an octopus explores the sea floor by flavour. Three hearts, ' +
    'blue blood, and arms that taste. Nature got creative.';
const SCENES = [
    'Close-up of an octopus gliding over a coral reef, soft blue light, vertical framing',
    'Macro shot of octopus skin changing colour and texture, underwater, vertical framing',
    'An octopus arm curling around a shell on the sand, sunbeams from above, vertical framing',
    'Octopus drifting into open blue water, camera slowly pulling back, vertical framing',
];

const submit = process.argv.includes('--submit');

console.error('PLAN (free)');
console.error(`  voice   ${TTS}  ${NARRATION.split(/\s+/).length} words, timestamps on`);
SCENES.forEach((p, i) => console.error(`  scene ${i} ${SCENE}  9:16  "${p.slice(0, 50)}…"`));
console.error(`  stitch  ${COMPOSE}  video track 4 × ${SCENE_MS}ms + audio track`);
if (!submit) {
    console.error('\nNothing spent. Re-run with --submit (about $0.70: 4 × $0.15 clips + TTS + compose).');
    process.exit(0);
}

const falKey = process.env.FAL_KEY;
const kieKey = process.env.KIE_API_KEY;
if (!falKey || !kieKey) {
    console.error(`\nMissing ${[!falKey && 'FAL_KEY', !kieKey && 'KIE_API_KEY'].filter(Boolean).join(' and ')}. Export and re-run.`);
    process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const started = Date.now();
const elapsed = () => `${Math.round((Date.now() - started) / 1000)}s`;

/** Submit to fal's queue and poll until it answers. */
async function runFal(endpoint, inputs) {
    const sent = await submitJob(
        { job_id: `verify-${Date.now()}`, provider_endpoint: endpoint, inputs },
        { falKey, webhookBaseUrl: NO_CALLBACK },
    );
    if (!sent.ok) throw new Error(`${endpoint} submit: ${sent.error}`);
    const statusUrl = sent.statusUrl;
    const auth = { headers: { Authorization: `Key ${falKey}` } };
    for (const deadline = Date.now() + TIMEOUT_MS; Date.now() < deadline;) {
        await sleep(POLL_MS);
        const s = await (await fetch(statusUrl, auth)).json();
        if (s.status === 'COMPLETED') {
            const res = await fetch(statusUrl.replace(/\/status$/, ''), auth);
            if (!res.ok) throw new Error(`${endpoint} result HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
            return { requestId: sent.providerJobId, output: await res.json() };
        }
    }
    throw new Error(`${endpoint} timed out`);
}

async function runScene(prompt, i) {
    const sent = await submitTask(
        { job_id: `verify-scene-${i}-${Date.now()}`, provider_endpoint: SCENE, inputs: { prompt, aspect_ratio: '9:16' } },
        { apiKey: kieKey, callbackUrl: NO_CALLBACK },
    );
    if (!sent.ok) throw new Error(`scene ${i} submit: ${sent.error}`);
    for (const deadline = Date.now() + TIMEOUT_MS; Date.now() < deadline;) {
        await sleep(POLL_MS);
        const rec = await fetchTask(SCENE, sent.providerJobId, { apiKey: kieKey });
        if (rec.ok && rec.state === 'success') return { taskId: sent.providerJobId, url: rec.outputUrl };
        if (!rec.ok || rec.state === 'fail') throw new Error(`scene ${i} failed: ${rec.error || rec.errorCode}`);
    }
    throw new Error(`scene ${i} timed out`);
}

console.error('\nSUBMIT (paid)');
const [voice, ...scenes] = await Promise.all([
    runFal(TTS, { text: NARRATION, timestamps: true }).then((v) => { console.error(`  voice   done ${elapsed()}`); return v; }),
    ...SCENES.map((p, i) => runScene(p, i).then((s) => { console.error(`  scene ${i} done ${elapsed()}`); return s; })),
]);

const words = voice.output.timestamps || [];
const last = words[words.length - 1];
const voiceMs = Math.round(((last && (last.end ?? last.end_time)) || 30) * 1000);
const tracks = [
    {
        id: 'scenes', type: 'video',
        keyframes: scenes.map((s, i) => ({ timestamp: i * SCENE_MS, duration: SCENE_MS, url: s.url })),
    },
    { id: 'voice', type: 'audio', keyframes: [{ timestamp: 0, duration: voiceMs, url: voice.output.audio.url }] },
];
const stitch = await runFal(COMPOSE, { tracks });
console.error(`  stitch  done ${elapsed()}`);

const mp4 = await fetch(stitch.output.video_url);
const bytes = Buffer.from(await mp4.arrayBuffer());
const out = join(tmpdir(), `auto-short-verify-${Date.now()}.mp4`);
writeFileSync(out, bytes);

const report = {
    at: new Date().toISOString(),
    wallSeconds: Math.round((Date.now() - started) / 1000),
    voice: { requestId: voice.requestId, words: words.length, voiceMs, sampleWord: words[0] ?? null },
    scenes: scenes.map((s) => s.taskId),
    stitch: { requestId: stitch.requestId, contentType: mp4.headers.get('content-type'), bytes: bytes.length, host: new URL(stitch.output.video_url).hostname },
    file: out,
};
writeFileSync('scripts/.auto-short-verify.json', JSON.stringify(report, null, 2));
console.error(`\nMP4: ${out} (${bytes.length} bytes)`);
console.error('Watch it and check: ~32s long, voice clear, what the clips\' own audio does under the voice.');
console.error('Then read the cost of each request id off the fal and kie dashboards.');
console.log(JSON.stringify(report, null, 2));
