#!/usr/bin/env node
/**
 * One paid probe of Crun (ADR-0256 phase 5), through the same adapter the
 * Worker would use. PROD KEY, REAL MONEY: each run spends the price shown.
 *
 *   read -s "CRUN_API_KEY?Crun key: "; export CRUN_API_KEY
 *   node scripts/probe-crun.mjs veo-lite          # about $0.067
 *   node scripts/probe-crun.mjs veo-fast          # about $0.134
 *   node scripts/probe-crun.mjs seedance-fast     # about $0.29
 *   node scripts/probe-crun.mjs veo --yes         # about $1.00, needs --yes
 *   unset CRUN_API_KEY
 *
 * The key is read from the environment only, never from an argument, and is
 * never printed. The script prints what the parity record needs: the task id,
 * the status words Crun used, the credits it charged, the time taken, and the
 * output's host, type and size. It does not download or keep the video.
 *
 * With --keep <empty folder> it also downloads the clip (https only, 60 MB cap) into that folder, measures it
 * with ffprobe (duration, size, codec, audio) and writes three frames as JPEGs, so a parity record can say what
 * the clip actually is. The folder must not exist or be empty; the script never runs anything from it.
 *
 * It does not touch Veyrnox: no database, no jobs, no ledger.
 */
import { submitTask, fetchTask, parseEndpoint } from '../packages/adapters/crun.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const run = promisify(execFile);
const KEEP_MAX_BYTES = 60 * 1024 * 1024;

const PROBES = {
    'veo-lite': { endpoint: 'crun:google/veo3-1-lite-t2v', usd: 0.067, inputs: { duration_seconds: 8 } },
    'veo-fast': { endpoint: 'crun:google/veo3-1-fast-t2v', usd: 0.134, inputs: { duration_seconds: 8 } },
    'seedance-fast': { endpoint: 'crun:bytedance/seedance2-0-fast-t2v', usd: 0.29, inputs: { duration_seconds: 5 } },
    veo: { endpoint: 'crun:google/veo3-1-t2v', usd: 1.0, inputs: { duration_seconds: 8 }, needsYes: true },
};
const POLL_MS = 5000;
const TIMEOUT_MS = 10 * 60 * 1000;

export function chooseProbe(argv) {
    const keepAt = argv.indexOf('--keep');
    const name = argv.find((a, i) => !a.startsWith('--') && !(keepAt >= 0 && i === keepAt + 1));
    const probe = PROBES[name];
    if (!probe) return { ok: false, error: `choose one of: ${Object.keys(PROBES).join(', ')}` };
    if (probe.needsYes && !argv.includes('--yes')) return { ok: false, error: `${name} costs about $${probe.usd.toFixed(2)}; add --yes to run it` };
    return { ok: true, name, probe };
}

/** What a parity record needs from ffprobe's JSON: duration, video size and codec, whether there is an audio stream. */
export function summariseStreams(probe) {
    const streams = Array.isArray(probe && probe.streams) ? probe.streams : [];
    const v = streams.find((x) => x.codec_type === 'video');
    return {
        durationSeconds: Number((probe && probe.format && probe.format.duration) || 0),
        width: v ? v.width : null, height: v ? v.height : null, videoCodec: v ? v.codec_name : null,
        hasAudio: streams.some((x) => x.codec_type === 'audio'),
    };
}

async function keepClip(outputUrl, dir) {
    if (!/^https:\/\//.test(outputUrl)) throw new Error('output is not https');
    const res = await fetch(outputUrl);
    if (!res.ok) throw new Error(`download ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > KEEP_MAX_BYTES) throw new Error('clip is over 60 MB');
    await mkdir(dir, { recursive: true });
    const file = join(dir, 'probe.mp4');
    await writeFile(file, bytes);
    const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
    const info = summariseStreams(JSON.parse(stdout));
    console.log('clip:', JSON.stringify(info));
    const frames = [0.15, 0.5, 0.85].map((f) => Math.max(0, Math.floor(info.durationSeconds * f)));
    for (let i = 0; i < frames.length; i += 1) {
        await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(frames[i]), '-i', file, '-frames:v', '1', join(dir, `frame-${i + 1}.jpg`)]);
    }
    console.log('saved:', file, 'and frame-1.jpg to frame-3.jpg in', dir);
}

async function main() {
    const chosen = chooseProbe(process.argv.slice(2));
    if (!chosen.ok) { console.error(chosen.error); process.exit(2); }
    const apiKey = process.env.CRUN_API_KEY;
    if (!apiKey || /^<.*>$/.test(apiKey)) { console.error('CRUN_API_KEY is not set (use the silent prompt in the header, not a placeholder)'); process.exit(2); }
    const { name, probe } = chosen;
    if (!parseEndpoint(probe.endpoint)) { console.error('endpoint no longer parses'); process.exit(2); }

    console.log(`probe ${name}: about $${probe.usd.toFixed(3)} on the PROD Crun key`);
    const started = Date.now();
    const sub = await submitTask({ job_id: `probe-${Date.now()}`, provider_endpoint: probe.endpoint, inputs: { prompt: 'a red paper boat drifting on calm water at dawn, soft light', ...probe.inputs } }, { apiKey });
    if (!sub.ok) { console.error('submit failed:', sub.outcome, sub.error); process.exit(1); }
    console.log('task id:', sub.providerJobId);

    const seen = new Set();
    while (Date.now() - started < TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const t = await fetchTask(sub.providerJobId, { apiKey });
        if (!t.ok) { console.log('poll error:', t.error); continue; }
        if (!seen.has(t.state)) { seen.add(t.state); console.log(`state ${t.state} after ${Math.round((Date.now() - started) / 1000)} s`); }
        if (t.state === 'fail') { console.log('failed:', t.errorCode); process.exit(1); }
        if (t.state === 'success') {
            const u = new URL(t.outputUrl);
            const head = await fetch(t.outputUrl, { method: 'HEAD' }).catch(() => null);
            console.log('output host:', u.host);
            console.log('output type:', head && head.headers.get('content-type'), 'bytes:', head && head.headers.get('content-length'));
            const keepAt = process.argv.indexOf('--keep');
            if (keepAt > 0) {
                try { await keepClip(t.outputUrl, process.argv[keepAt + 1]); }
                catch (err) { console.error('could not keep or measure the clip:', err && err.message); }
            }
            console.log(`total ${Math.round((Date.now() - started) / 1000)} s. Now read the charge in crun.ai/logs and compare it with the table.`);
            return;
        }
    }
    console.error('timed out waiting for the task; read crun.ai/logs for its state');
    process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
