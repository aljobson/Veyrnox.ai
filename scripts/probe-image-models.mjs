#!/usr/bin/env node
/**
 * One paid image probe for the four image models that probe-crun.mjs does not cover.
 * REAL MONEY on the provider key you type: each run spends about the price shown.
 *
 *   node scripts/probe-image-models.mjs sana             # fal   FAL_KEY        about $0.01
 *   node scripts/probe-image-models.mjs flux-2-pro       # fal   FAL_KEY        about $0.03
 *   node scripts/probe-image-models.mjs flux-2-pro-1k    # kie   KIE_API_KEY    about $0.025
 *   node scripts/probe-image-models.mjs nano-banana-pro  # grsai GRSAI_API_KEY  about $0.027
 *
 * Run it in a real terminal and type the key when asked (typing is hidden; it is held in memory only, never
 * printed, never an argument). Add --keep <empty folder> to save the image so you can look at it.
 * It does not touch Veyrnox: no database, no jobs, no ledger. kie wants a callback address; it gets a neutral
 * https://example.com one that nothing reads, and the result is polled instead.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as kie from '../packages/adapters/kie.js';
import * as grsai from '../packages/adapters/grsai.js';
import { promptHidden } from './probe-crun.mjs';

const PROMPT = 'a red paper boat drifting on calm water at dawn, soft light';
const FAL_QUEUE = 'https://queue.fal.run';
const POLL_MS = 4000;
const TIMEOUT_MS = 5 * 60 * 1000;

export const PROBES = {
    sana: { via: 'fal', endpoint: 'fal-ai/sana/v1.5/4.8b', env: 'FAL_KEY', usd: 0.01, inputs: { prompt: PROMPT } },
    'flux-2-pro': { via: 'fal', endpoint: 'fal-ai/flux-2-pro', env: 'FAL_KEY', usd: 0.03, inputs: { prompt: PROMPT } },
    'flux-2-pro-1k': { via: 'kie', endpoint: 'market:flux-2/pro-text-to-image', env: 'KIE_API_KEY', usd: 0.025, inputs: { prompt: PROMPT } },
    'nano-banana-pro-kie': { via: 'kie', endpoint: 'market:nano-banana-pro', env: 'KIE_API_KEY', usd: 0.09, inputs: { prompt: PROMPT } },
    'nano-banana-pro-fal': { via: 'fal', endpoint: 'fal-ai/nano-banana-pro', env: 'FAL_KEY', usd: 0.15, inputs: { prompt: PROMPT } },
    'nano-banana-pro': { via: 'grsai', endpoint: 'grsai:nano-banana-pro', env: 'GRSAI_API_KEY', usd: 0.0271, inputs: { prompt: PROMPT } },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const kindOf = (b) => (b.subarray(0, 4).equals(PNG) ? 'png' : b[0] === 0xff && b[1] === 0xd8 ? 'jpg' : b.subarray(8, 12).toString('latin1') === 'WEBP' ? 'webp' : null);

/** Runs one probe; each runner returns { id, outputUrl } or throws a short message. Keys never appear in a message. */
async function runFal(probe, apiKey, started, say) {
    const headers = { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' };
    const sub = await fetch(`${FAL_QUEUE}/${probe.endpoint}`, { method: 'POST', redirect: 'manual', headers, body: JSON.stringify(probe.inputs) });
    if (!sub.ok) throw new Error(`fal submit ${sub.status}`);
    const queued = await sub.json();
    if (!queued.request_id || !queued.status_url || !queued.response_url) throw new Error('fal gave no request_id or urls');
    for (const u of [queued.status_url, queued.response_url]) if (new URL(u).host !== 'queue.fal.run') throw new Error('fal returned an unexpected host');
    say('task id', queued.request_id);
    const seen = new Set();
    while (Date.now() - started < TIMEOUT_MS) {
        await sleep(POLL_MS);
        const st = await fetch(queued.status_url, { headers });
        if (!st.ok) { say('poll error', st.status); continue; }
        const body = await st.json();
        if (!seen.has(body.status)) { seen.add(body.status); say('state', `${body.status} after ${Math.round((Date.now() - started) / 1000)} s`); }
        if (body.status === 'COMPLETED') {
            const res = await fetch(queued.response_url, { headers });
            if (!res.ok) throw new Error(`fal result ${res.status}`);
            const out = await res.json();
            const url = out?.images?.[0]?.url;
            if (typeof url !== 'string') throw new Error('fal result has no image url');
            return { id: queued.request_id, outputUrl: url };
        }
    }
    throw new Error('timed out');
}

async function runPolled(probe, apiKey, started, say, adapter) {
    const job = { job_id: `probe-${Date.now()}`, provider_endpoint: probe.endpoint, inputs: probe.inputs };
    const cfg = { apiKey, callbackUrl: 'https://example.com/probe-ignore' };
    const sub = await adapter.submitTask(job, cfg);
    if (!sub.ok) {
        // --why: only when GrsAI answered with a refusal (outcome 'rejected': nothing was accepted, so nothing is billed).
        // An ambiguous answer (timeout, unreadable reply) may already hold a billed task, so it is never sent again.
        // The second request is raw; only GrsAI's own status, code and message (cut short) are printed, never the key.
        if (process.argv.includes('--why') && adapter === grsai && sub.outcome === 'rejected') {
            const built = grsai.buildRequest(probe.endpoint, probe.inputs);
            const res = await fetch('https://grsaiapi.com/v1/draw/nano-banana', {
                method: 'POST', redirect: 'manual',
                headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(built.body),
            }).catch(() => null);
            const body = res ? await res.json().catch(() => null) : null;
            console.log('grsai http status:', res && res.status);
            console.log('grsai code:', body && body.code, '| msg:', String((body && body.msg) || '').slice(0, 200));
            // If the account was topped up in between, this second request was accepted and billed: say so, with its id.
            if (body && body.code === 0 && body.data && typeof body.data.id === 'string') {
                console.log('WARNING: GrsAI accepted this second request and will bill it. Task id:', body.data.id);
            }
        }
        throw new Error(`submit failed: ${sub.outcome} ${sub.error}`);
    }
    say('task id', sub.providerJobId);
    const seen = new Set();
    while (Date.now() - started < TIMEOUT_MS) {
        await sleep(POLL_MS);
        const t = adapter === kie ? await kie.fetchTask(probe.endpoint, sub.providerJobId, cfg) : await grsai.fetchTask(sub.providerJobId, cfg);
        if (!t.ok) { say('poll error', t.error); continue; }
        if (!seen.has(t.state)) { seen.add(t.state); say('state', `${t.state} after ${Math.round((Date.now() - started) / 1000)} s`); }
        if (t.state === 'fail') throw new Error(`failed: ${t.errorCode}`);
        if (t.state === 'success') return { id: sub.providerJobId, outputUrl: t.outputUrl };
    }
    throw new Error('timed out');
}

async function keepImage(url, dir) {
    if (!/^https:\/\//.test(url)) throw new Error('output is not https');
    const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
    if (bytes.length > 20 * 1024 * 1024) throw new Error('image is over 20 MB');
    const kind = kindOf(bytes);
    if (!kind) throw new Error('the download is not a PNG, JPEG or WebP; nothing was written');
    await mkdir(dir, { recursive: true });
    const file = join(dir, `probe.${kind}`);
    await writeFile(file, bytes);
    console.log('saved:', file, `(${bytes.length} bytes)`);
}

async function main() {
    const argv = process.argv.slice(2);
    const keepAt = argv.indexOf('--keep');
    const name = argv.find((a, i) => !a.startsWith('--') && i !== (keepAt >= 0 ? keepAt + 1 : -1));
    const probe = PROBES[name];
    if (!probe) { console.error(`choose one of: ${Object.keys(PROBES).join(', ')}`); process.exit(2); }
    let apiKey = process.env[probe.env];
    if (!apiKey && process.stdin.isTTY) apiKey = await promptHidden(`${probe.env} (typing is hidden): `);
    if (!apiKey || /^<.*>$/.test(apiKey)) { console.error(`${probe.env} is not set. Run this in a real terminal and type the key when asked.`); process.exit(2); }

    console.log(`probe ${name}: about $${probe.usd.toFixed(3)} on the ${probe.via} key you typed (REAL MONEY)`);
    const started = Date.now();
    const say = (k, v) => console.log(`${k}:`, v);
    try {
        const r = probe.via === 'fal' ? await runFal(probe, apiKey, started, say) : await runPolled(probe, apiKey, started, say, probe.via === 'kie' ? kie : grsai);
        const u = new URL(r.outputUrl);
        const head = await fetch(r.outputUrl, { method: 'HEAD' }).catch(() => null);
        console.log('output host:', u.host);
        console.log('output type:', head && head.headers.get('content-type'), 'bytes:', head && head.headers.get('content-length'));
        if (keepAt >= 0 && argv[keepAt + 1]) await keepImage(r.outputUrl, argv[keepAt + 1]).catch((e) => console.error('could not keep the image:', e.message));
        console.log(`total ${Math.round((Date.now() - started) / 1000)} s. Now read the charge in the ${probe.via} dashboard and compare it with the price above.`);
    } catch (err) {
        console.error('probe failed:', err && err.message);
        process.exit(1);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
