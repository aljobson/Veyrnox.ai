/** BytePlus ModelArk (ByteDance Seedance), ADR-0058.
 *
 * One fixed host, API-key auth, async task create + authenticated read.
 * ModelArk's callback is unsigned, so it is never registered: completion is
 * polling only (lib/byteplusSweep.js), the same shape as GrsAI. Every request
 * is pinned by its capability record to the unit the catalog row is costed
 * at (5s, 720p, no video input). Never retry a submit automatically: an
 * ambiguous timeout may already have billed.
 *
 *   POST /api/v3/contents/generations/tasks       -> { id }
 *   GET  /api/v3/contents/generations/tasks/{id}  -> { id, status, content.video_url, usage.completion_tokens, error }
 *
 * Output URLs are valid for 24 hours; the sweep copies them to R2 on the
 * first successful read. Prompts, keys, URLs and vendor messages never
 * enter logs or error strings.
 */
import { capabilityFor, checkInputs, shapePayload } from '../../lib/modelCapabilities.js';

export const BYTEPLUS_API_BASE = 'https://ark.ap-southeast.bytepluses.com';
export const ENDPOINT_PREFIX = 'byteplus:';
const TASKS_PATH = '/api/v3/contents/generations/tasks';
const ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MODERATION_RE = /sensitive|moderat|risk|prohibit|violat/i;

/** True for a catalog endpoint this adapter owns ('byteplus:<row slug>'). */
export function isEndpoint(endpoint) {
    return typeof endpoint === 'string' && endpoint.startsWith(ENDPOINT_PREFIX)
        && /^[a-z0-9.-]{1,64}$/.test(endpoint.slice(ENDPOINT_PREFIX.length));
}

/**
 * ModelArk's request body from our inputs. The record supplies the model id,
 * resolution, watermark and duration pins; the prompt and optional first
 * frame become the `content` array ModelArk expects.
 * @returns {{ok:true, body:object}|{ok:false, error:string}}
 */
export function buildRequest(endpoint, inputs) {
    if (!isEndpoint(endpoint)) return { ok: false, error: 'provider_unsupported' };
    const record = capabilityFor(endpoint);
    if (!record || record.provider !== 'byteplus' || typeof record.fixed.model !== 'string') {
        return { ok: false, error: 'provider_unsupported' };
    }
    const checked = checkInputs(record, inputs || {});
    if (!checked.ok) return checked;
    const { prompt, image_url: imageUrl, ...rest } = shapePayload(record, inputs || {});
    const content = [{ type: 'text', text: prompt }];
    if (imageUrl !== undefined) {
        // Only a URL this server signed reaches here (the gateway drops client
        // media URLs), and only https can be fetched by ModelArk.
        let parsed;
        try { parsed = new URL(imageUrl); } catch { return { ok: false, error: 'inputs_invalid:image_url' }; }
        if (parsed.protocol !== 'https:') return { ok: false, error: 'inputs_invalid:image_url' };
        content.push({ type: 'image_url', image_url: { url: parsed.toString() }, role: 'first_frame' });
    }
    return { ok: true, body: { ...rest, content } };
}

async function readJson(response) {
    if (!response.body) throw new Error('empty');
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new Error('large');
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) { bytes.set(c, offset); offset += c.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
}

function statusError(status) {
    if (status === 401 || status === 403) return 'provider_auth_failed';
    if (status === 402) return 'provider_payment_required';
    if (status === 429) return 'provider_rate_limited';
    if (status === 404) return 'provider_task_unknown';
    if (status >= 400 && status < 500) return 'provider_request_rejected';
    return 'provider_unavailable';
}

async function request(method, path, body, { apiKey, timeoutMs = 15000 }) {
    if (!apiKey) return { ok: false, error: 'provider_not_configured' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`${BYTEPLUS_API_BASE}${path}`, {
            method, redirect: 'manual', signal: controller.signal,
            headers: { Authorization: `Bearer ${apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (!res.ok) {
            await res.body?.cancel();
            return { ok: false, error: statusError(res.status) };
        }
        const payload = await readJson(res);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return { ok: false, error: 'provider_response_invalid' };
        }
        return { ok: true, data: payload };
    } catch {
        return { ok: false, error: controller.signal.aborted ? 'provider_timeout' : 'provider_response_invalid' };
    } finally { clearTimeout(timer); }
}

/**
 * @param {{provider_endpoint:string, inputs:object}} job
 * @param {{apiKey:string, timeoutMs?:number}} cfg
 * @returns {Promise<{ok:true, providerJobId:string}|{ok:false, error:string, errorCode:string}>}
 */
export async function submitTask(job, cfg) {
    const built = buildRequest(job.provider_endpoint, job.inputs);
    if (!built.ok) return { ok: false, error: built.error, errorCode: built.error };
    const r = await request('POST', TASKS_PATH, built.body, cfg);
    if (!r.ok) return { ...r, errorCode: r.error };
    if (typeof r.data.id !== 'string' || !ID_RE.test(r.data.id)) {
        return { ok: false, error: 'provider_response_invalid', errorCode: 'provider_response_invalid' };
    }
    return { ok: true, providerJobId: r.data.id };
}

/** Pure mapping of a ModelArk task record onto our outcome. Exported for tests. */
export function interpretTask(taskId, data) {
    if (!data || data.id !== taskId) return { ok: false, error: 'provider_response_invalid' };
    const tokens = Number(data.usage && data.usage.completion_tokens);
    const completionTokens = Number.isFinite(tokens) && tokens >= 0 ? tokens : null;
    switch (data.status) {
        case 'queued':
        case 'running':
            return { ok: true, state: 'pending' };
        case 'cancelled':
            return { ok: true, state: 'fail', errorCode: 'provider_cancelled' };
        case 'failed': {
            const code = data.error && typeof data.error.code === 'string' ? data.error.code : '';
            return { ok: true, state: 'fail', errorCode: MODERATION_RE.test(code) ? 'provider_moderation' : 'provider_error' };
        }
        case 'succeeded': {
            const url = data.content && data.content.video_url;
            if (typeof url !== 'string' || url.length > 2048) {
                return { ok: true, state: 'fail', errorCode: 'provider_output_missing' };
            }
            // The shared R2 copier enforces the byteplus host allowlist and
            // refuses redirects. The API key is never sent to the output host.
            return { ok: true, state: 'success', outputUrl: url, completionTokens };
        }
        default:
            return { ok: false, error: 'provider_response_invalid' };
    }
}

/**
 * Authoritative task read with our key over TLS to the fixed host.
 * @returns {Promise<
 *   {ok:true, state:'success', outputUrl:string, completionTokens:number|null} |
 *   {ok:true, state:'fail', errorCode:string} |
 *   {ok:true, state:'pending'} |
 *   {ok:false, error:string}
 * >}
 */
export async function fetchTask(taskId, cfg) {
    if (typeof taskId !== 'string' || !ID_RE.test(taskId)) return { ok: false, error: 'task_id_invalid' };
    const r = await request('GET', `${TASKS_PATH}/${encodeURIComponent(taskId)}`, null, cfg);
    if (!r.ok) return r;
    return interpretTask(taskId, r.data);
}
