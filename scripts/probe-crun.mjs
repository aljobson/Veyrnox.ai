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
    'nano-banana': { endpoint: 'crun:google/nano-banana', usd: 0.015, image: true, inputs: {} },
    seedream: { endpoint: 'crun:bytedance/seedream-4', usd: 0.015, image: true, inputs: {} },
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

/** True when the bytes start like an MP4: an 'ftyp' box at offset 4. */
export function isMp4(bytes) {
    return bytes.length > 12 && bytes.subarray(4, 8).toString('latin1') === 'ftyp';
}

/** 'png', 'jpg' or 'webp' when the bytes start like one of those, else null. */
export function imageKind(bytes) {
    if (bytes.length > 12 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
    if (bytes.length > 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
    if (bytes.length > 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
    return null;
}

async function keepImage(outputUrl, dir) {
    if (!/^https:\/\//.test(outputUrl)) throw new Error('output is not https');
    const res = await fetch(outputUrl);
    if (!res.ok) throw new Error(`download ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > 20 * 1024 * 1024) throw new Error('image is over 20 MB');
    const kind = imageKind(bytes);
    if (!kind) throw new Error('the download is not a PNG, JPEG or WebP; nothing was written');
    await mkdir(dir, { recursive: true });
    const file = join(dir, `probe.${kind}`);
    await writeFile(file, bytes);
    const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', file]);
    const v = (JSON.parse(stdout).streams || [])[0] || {};
    console.log('image:', JSON.stringify({ kind, bytes: bytes.length, width: v.width, height: v.height }));
    console.log('saved:', file);
}

async function keepClip(outputUrl, dir) {
    if (!/^https:\/\//.test(outputUrl)) throw new Error('output is not https');
    const res = await fetch(outputUrl);
    if (!res.ok) throw new Error(`download ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > KEEP_MAX_BYTES) throw new Error('clip is over 60 MB');
    // Only an MP4 is written: the ISO base media 'ftyp' box sits at bytes 4 to 8. Anything else is refused, not saved.
    if (!isMp4(bytes)) throw new Error('the download is not an MP4; nothing was written');
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
                try { await (probe.image ? keepImage : keepClip)(t.outputUrl, process.argv[keepAt + 1]); }
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
