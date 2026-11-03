#!/usr/bin/env node
/**
 * One Higgsfield parity probe (ADR-0256). PROD KEY, REAL MONEY.
 * The builder never runs this. Key comes from the environment only, never an argument.
 * HIGGSFIELD_ENABLED is absent in the Worker: absent means off. Set the Worker var
 * to "true" only when the owner turns it on, keeping within the 66-var budget.
 * In zsh, silently enter the account key id and secret joined by a colon:
 *   read -s "HIGGSFIELD_API_KEY?Higgsfield key: "; export HIGGSFIELD_API_KEY
 *   node scripts/probe-higgsfield.mjs kling-2-6       # about $0.18
 *   node scripts/probe-higgsfield.mjs kling-3 --image <https url>  # about $0.28
 *   unset HIGGSFIELD_API_KEY
 * Promo ends 2026-11-10; list costs are $0.35 and $0.56 for five seconds.
 * --keep <empty folder> saves an MP4, ffprobe facts and three JPEG frames, as Crun's probe does.
 * No database, jobs or ledger calls. No key or signed output URL is printed.
 * The output host is UNKNOWN: do not add a Higgsfield host to r2Copy.js until this
 * paid probe records the exact observed host, for a separate migration-free PR.
 */
import { submitTask, interpretTask, HIGGSFIELD_API_BASE } from '../packages/adapters/higgsfield.js';
import { readBoundedBody } from '../lib/boundedBody.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const run = promisify(execFile);
const PROBES = {
    'kling-2-6': { endpoint: 'higgsfield:kling-video/v2.6/pro/text-to-video', usd: 0.175, inputs: { duration_seconds: 5 } },
    'kling-3': { endpoint: 'higgsfield:kling-video/v3.0/pro/image-to-video', usd: 0.28, inputs: { duration_seconds: 5 }, needsImage: true },
};

function httpsUrl(value) {
    try { const u = new URL(value); return /^https:\/\/\S+$/.test(value) && u.protocol === 'https:' && !u.username && !u.password; }
    catch { return false; }
}

export function chooseProbe(argv) {
    let name, image, keep;
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--image' || arg === '--keep') {
            const value = argv[++i];
            if (!value || value.startsWith('--')) return { ok: false, error: `${arg} needs a value` };
            if (arg === '--image') image = value; else keep = value;
        } else if (arg.startsWith('--') || name) return { ok: false, error: 'unexpected argument' };
        else name = arg;
    }
    const probe = Object.hasOwn(PROBES, name || '') ? PROBES[name] : null;
    if (!probe) return { ok: false, error: 'choose kling-2-6 or kling-3' };
    if (probe.needsImage && !httpsUrl(image)) return { ok: false, error: 'kling-3 needs --image <https url>' };
    if (!probe.needsImage && image !== undefined) return { ok: false, error: 'kling-2-6 takes no image' };
    return { ok: true, name, keep, probe: { ...probe, inputs: { ...probe.inputs, ...(image ? { image_url: image } : {}) } } };
}

export async function requireEmptyFolder(dir) {
    try { if ((await readdir(dir)).length) throw new Error('--keep folder must be empty'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
}

export function summariseStreams(probe) {
    const streams = Array.isArray(probe?.streams) ? probe.streams : [];
    const video = streams.find((s) => s.codec_type === 'video');
    return { durationSeconds: Number(probe?.format?.duration || 0), width: video?.width ?? null,
        height: video?.height ?? null, videoCodec: video?.codec_name ?? null,
        hasAudio: streams.some((s) => s.codec_type === 'audio') };
}

export function isMp4(bytes) {
    return bytes.length > 12 && bytes.subarray(4, 8).toString('latin1') === 'ftyp';
}

// Only numeric billing fields, never arbitrary vendor payloads (which may contain inputs or URLs).
export function probeFacts(data) {
    const status = typeof data?.status === 'string' && /^[a-z_]{1,40}$/.test(data.status) ? data.status : 'unknown';
    const billed = {};
    for (const field of ['billed_amount', 'cost', 'credits', 'amount']) {
        if (typeof data?.[field] === 'number' && Number.isFinite(data[field])) billed[field] = data[field];
    }
    return { status, billed };
}

export async function readProbeTask(requestId, apiKey) {
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9._-]{1,128}(?![\s\S])/.test(requestId) || /^\.{1,2}$/.test(requestId)) throw new Error('invalid request_id');
    const signal = AbortSignal.timeout(15000);
    const res = await fetch(`${HIGGSFIELD_API_BASE}/requests/${encodeURIComponent(requestId)}/status`, {
        redirect: 'manual', signal, headers: { Authorization: `Key ${apiKey}` },
    });
    if (!res.ok) { void res.body?.cancel().catch(() => {}); throw new Error(`poll HTTP ${res.status}`); }
    const data = JSON.parse(new TextDecoder().decode(await readBoundedBody(res.body, 128 * 1024, signal)));
    return { ...probeFacts(data), outcome: interpretTask(data) };
}

async function keepClip(outputUrl, dir) {
    await requireEmptyFolder(dir);
    if (!httpsUrl(outputUrl)) throw new Error('output is not https');
    const signal = AbortSignal.timeout(60000);
    const res = await fetch(outputUrl, { redirect: 'manual', signal });
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    const bytes = Buffer.from(await readBoundedBody(res.body, 60 * 1024 * 1024, signal));
    if (!isMp4(bytes)) throw new Error('download is not an MP4');
    await mkdir(dir, { recursive: true });
    const file = join(dir, 'probe.mp4');
    await writeFile(file, bytes, { flag: 'wx' });
    const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
    const info = summariseStreams(JSON.parse(stdout));
    await writeFile(join(dir, 'probe.json'), JSON.stringify(info, null, 2), { flag: 'wx' });
    console.log('clip:', JSON.stringify(info));
    for (const [i, fraction] of [0.15, 0.5, 0.85].entries()) {
        await run('ffmpeg', ['-v', 'error', '-n', '-ss', String(Math.max(0, Math.floor(info.durationSeconds * fraction))), '-i', file, '-frames:v', '1', join(dir, `frame-${i + 1}.jpg`)]);
    }
}

export async function main(argv = process.argv.slice(2)) {
    const chosen = chooseProbe(argv);
    if (!chosen.ok) throw new Error(chosen.error);
    const apiKey = process.env.HIGGSFIELD_API_KEY;
    if (!apiKey || /^<.*>$/.test(apiKey)) throw new Error('HIGGSFIELD_API_KEY is not set; use the silent prompt in the header');
    if (chosen.keep) await requireEmptyFolder(chosen.keep); // refuse before any paid submit
    const { probe, name } = chosen;
    console.log(`PROD KEY, REAL MONEY: ${name}, promo about $${probe.usd.toFixed(2)} (ends 2026-11-10)`);
    const started = Date.now();
    const submitted = await submitTask({ job_id: `probe-${crypto.randomUUID()}`, provider_endpoint: probe.endpoint,
        inputs: { prompt: 'a red paper boat drifting on calm water at dawn, soft light', ...probe.inputs } }, { apiKey });
    if (!submitted.ok) throw new Error(`submit ${submitted.outcome}: ${submitted.error}`);
    console.log('request id:', submitted.providerJobId);
    while (Date.now() - started < 10 * 60 * 1000) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        let task;
        try { task = await readProbeTask(submitted.providerJobId, apiKey); }
        catch { console.log('poll unavailable; retrying'); continue; }
        console.log('status:', task.status, 'seconds:', Math.round((Date.now() - started) / 1000), 'billed:', JSON.stringify(task.billed));
        const outcome = task.outcome;
        if (!outcome.ok || outcome.state === 'pending') continue;
        if (outcome.state === 'fail') throw new Error(outcome.errorCode);
        const head = await fetch(outcome.outputUrl, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(15000) }).catch(() => null);
        console.log('output host:', new URL(outcome.outputUrl).host);
        console.log('output type:', head?.headers.get('content-type'), 'bytes:', head?.headers.get('content-length'));
        if (chosen.keep) await keepClip(outcome.outputUrl, chosen.keep);
        console.log('total seconds:', Math.round((Date.now() - started) / 1000), 'Confirm the charge in the Higgsfield Console.');
        return;
    }
    throw new Error('polling timed out; inspect the existing request in Console before another paid run');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try { await main(); }
    catch { console.error('Probe failed. Check arguments, HIGGSFIELD_API_KEY, empty --keep folder and Console request state; never retry a paid submit blindly.'); process.exitCode = 1; }
}
