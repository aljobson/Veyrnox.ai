import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, stat, open } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { signEditorRenderBody, verifyEditorRenderBody, CALLBACK_PATH, SIGNATURE_HEADER, TIMESTAMP_HEADER } from '../../lib/editorServerRenderSigning.js';
import { connectConcat, executeCalls } from './rpc.mjs';

export const MAX_BYTES = 25 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function uploadRenderedFile(output, grant, { signal, callback, fetchImpl = fetch, wait = pause }) {
    for (let attempt = 0; attempt < 3; attempt++) {
        const body = createReadStream(output);
        let response;
        try {
            response = await fetchImpl(grant.upload_url, { method: 'PUT', headers: grant.headers, body, duplex: 'half', redirect: 'error', signal });
        } catch (error) {
            if (signal.aborted || attempt === 2) throw error;
        } finally { body.destroy(); }
        if (response) {
            // A lost successful PUT reply makes retry return 412. Only the
            // Worker can decide whether the immutable stored bytes are valid.
            if (!response.ok && response.status !== 412) throw new Error('upload_failed');
            await callback({ event: 'done' });
            return;
        }
        await wait(250 * (attempt + 1));
    }
}
async function download(source, path, hosts, signal) {
    const url = new URL(source.url);
    if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.port || url.username || url.password
        || !Number.isSafeInteger(source.size_bytes) || source.size_bytes < 1 || source.size_bytes > 100 * 1024 * 1024) throw new Error('invalid_source');
    const response = await fetch(url, { redirect: 'error', signal });
    if (!response.ok || !response.body) throw new Error('source_failed');
    const file = await open(path, 'wx');
    let size = 0;
    try {
        for await (const chunk of response.body) {
            size += chunk.length;
            if (size > source.size_bytes) throw new Error('source_too_large');
            await file.writeFile(chunk);
        }
    } finally { await file.close(); }
    if (size !== source.size_bytes) throw new Error('source_incomplete');
}

export async function renderJob(body, { env = process.env, signal, callback }) {
    const hosts = new Set((env.EDITOR_RENDER_SOURCE_HOSTS || '').split(',').filter(Boolean));
    if (!hosts.size) throw new Error('sources_not_configured');
    const dir = await mkdtemp(`${env.EDITOR_RENDER_WORK_ROOT || '/work'}/render-`);
    let child, rpc;
    try {
        if (!await callback({ event: 'started' })) throw new Error('job_closed');
        const files = {};
        for (const [i, source] of body.sources.entries()) {
            files[source.id] = `${dir}/source-${i}`;
            await download(source, files[source.id], hosts, signal);
        }
        const token = randomBytes(32).toString('hex');
        // Concat prints its token. Neither stdout nor stderr can reach logs.
        child = spawn('concat-cli', ['serve', '--json', '127.0.0.1:7420', '--root', dir], {
            env: { PATH: process.env.PATH, HOME: dir, VK_ICD_FILENAMES: process.env.VK_ICD_FILENAMES, CONCAT_API_TOKEN: token }, stdio: 'ignore',
        });
        let launchError;
        child.on('error', () => { launchError = true; });
        const stop = () => child.kill('SIGKILL');
        signal.addEventListener('abort', stop, { once: true });
        for (let i = 0; i < 50 && !rpc; i++) {
            if (signal.aborted || launchError || child.exitCode !== null) throw new Error('concat_start_failed');
            try { rpc = await connectConcat(token, { signal }); } catch { await pause(100); }
        }
        if (!rpc) throw new Error('concat_start_failed');
        const output = `${dir}/output.mp4`;
        await executeCalls(body.calls, rpc, { location: dir, output, files });
        const size = (await stat(output)).size;
        if (size < 1 || size > MAX_BYTES) throw new Error('render_too_large');
        const grant = await callback({ event: 'upload_grant', size_bytes: size });
        if (!grant?.upload_url || !grant.headers || grant.headers['If-None-Match'] !== '*' && grant.headers['if-none-match'] !== '*') throw new Error('upload_closed');
        await uploadRenderedFile(output, grant, { signal, callback });
        signal.removeEventListener('abort', stop);
    } finally {
        rpc?.close();
        if (child && child.exitCode === null) {
            child.kill('SIGKILL');
            await Promise.race([new Promise(resolve => child.once('close', resolve)), pause(5000)]);
        }
        await rm(dir, { recursive: true, force: true });
    }
}

/** One authenticated job at a time. Dependencies make the HTTP boundary testable without listening. */
export function runnerHandler({ env = process.env, execute = renderJob, fetchImpl = fetch, now = Date.now } = {}) {
    let active;
    const ended = new Map();
    const callback = async (jobId, payload) => {
        const raw = JSON.stringify({ ...payload, job_id: jobId });
        for (let attempt = 0; attempt < 4; attempt++) {
            const t = Math.floor(now() / 1000);
            try {
                const res = await fetchImpl(env.EDITOR_RENDER_CALLBACK_URL, { method: 'POST', redirect: 'error',
                    headers: { 'content-type': 'application/json', [TIMESTAMP_HEADER]: String(t), [SIGNATURE_HEADER]: await signEditorRenderBody(env.EDITOR_RENDER_SIGNING_SECRET, CALLBACK_PATH, raw, t) },
                    body: raw, signal: AbortSignal.timeout(30000) });
                if (res.ok) return await res.json();
                if (res.status < 500) return null;
            } catch { /* Signed redelivery; the Worker owns dedupe. */ }
            await pause(250 * (attempt + 1));
        }
        return null;
    };
    return async (path, raw, headers) => {
        if (!await verifyEditorRenderBody(env.EDITOR_RENDER_SIGNING_SECRET, path, raw, headers.get(TIMESTAMP_HEADER), headers.get(SIGNATURE_HEADER), Math.floor(now() / 1000))) return { status: 401, body: { error: 'invalid_signature' } };
        let body;
        try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { return { status: 400, body: { error: 'invalid_json' } }; }
        if (path === '/runs') return { status: 200, body: { runs: Object.fromEntries((Array.isArray(body.job_ids) ? body.job_ids.slice(0, 100) : []).map(id => [id, active?.id === id ? 'running' : ended.has(id) ? 'ended' : 'unknown'])) } };
        if (!UUID.test(body.job_id || '')) return { status: 400, body: { error: 'invalid_job' } };
        if (path === '/cancel') { if (active?.id === body.job_id) active.controller.abort(); return { status: 200, body: { ok: true } }; }
        if (path !== '/run') return { status: 404, body: { error: 'not_found' } };
        if (active?.id === body.job_id || ended.has(body.job_id)) return { status: 200, body: { ok: true, idempotent: true } };
        if (active) return { status: 429, body: { error: 'render_busy' } };
        if (body.callback_url !== env.EDITOR_RENDER_CALLBACK_URL || !Array.isArray(body.calls) || body.calls.length > 500 || !Array.isArray(body.sources) || body.sources.length > 40
            || body.sources.reduce((sum, s) => sum + (Number(s.size_bytes) || Infinity), 0) > 512 * 1024 * 1024) return { status: 400, body: { error: 'invalid_render' } };
        const controller = new AbortController();
        active = { id: body.job_id, controller };
        const timeout = setTimeout(() => controller.abort(), 45 * 60000);
        Promise.resolve().then(() => execute(body, { env, signal: controller.signal, callback: payload => callback(body.job_id, payload) }))
            .catch(async error => { await callback(body.job_id, { event: 'failed', error_code: error.message === 'render_too_large' ? 'render_too_large' : 'runner_failed' }); })
            .finally(() => { clearTimeout(timeout); ended.set(body.job_id, now()); if (ended.size > 1000) ended.delete(ended.keys().next().value); active = null; });
        return { status: 202, body: { ok: true } };
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (!process.env.EDITOR_RENDER_SIGNING_SECRET || !process.env.EDITOR_RENDER_CALLBACK_URL) throw new Error('runner_not_configured');
    const handle = runnerHandler();
    http.createServer(async (req, res) => {
        try {
            if (req.method !== 'POST') { res.writeHead(405).end(); return; }
            const chunks = []; let size = 0;
            for await (const chunk of req) { size += chunk.length; if (size > 512 * 1024) { res.writeHead(413).end(); return; } chunks.push(chunk); }
            const result = await handle(req.url, Buffer.concat(chunks), new Headers(req.headers));
            res.writeHead(result.status, { 'content-type': 'application/json' }).end(JSON.stringify(result.body));
        } catch { res.writeHead(500).end('{"error":"internal"}'); }
    }).listen(Number(process.env.PORT || 8080), '0.0.0.0');
}
