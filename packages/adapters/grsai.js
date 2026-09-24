/** GrsAI: fixed global API, one verified Nano Banana Pro 2K image per submit.
 * No webhook: only authenticated result polling can complete a task. Never
 * retry a submit automatically: an ambiguous timeout may already have billed.
 */
import { capabilityFor, checkInputs, shapePayload } from '../../lib/modelCapabilities.js';

export const ENDPOINT = 'grsai:nano-banana-pro';
const BASE = 'https://grsaiapi.com';
const ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_RESPONSE_BYTES = 64 * 1024;

export function buildRequest(endpoint, inputs) {
    if (endpoint !== ENDPOINT) return { ok: false, error: 'provider_unsupported' };
    const record = capabilityFor(endpoint);
    const checked = checkInputs(record, inputs);
    if (!checked.ok) return checked;
    return { ok: true, body: shapePayload(record, { aspect_ratio: '1:1', ...inputs }) };
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

async function request(path, body, { apiKey, timeoutMs = 15000 }) {
    if (!apiKey) return { ok: false, error: 'provider_not_configured' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`${BASE}${path}`, {
            method: 'POST', redirect: 'manual', signal: controller.signal,
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            await res.body?.cancel();
            return { ok: false, error: res.status === 401 || res.status === 403 ? 'provider_auth_failed'
                : res.status === 429 ? 'provider_rate_limited' : 'provider_unavailable' };
        }
        const payload = await readJson(res);
        if (payload?.code !== 0 || !payload.data || typeof payload.data !== 'object') {
            return { ok: false, error: 'provider_request_rejected' };
        }
        return { ok: true, data: payload.data };
    } catch {
        // Neither prompts, keys, URLs nor vendor messages enter logs/errors.
        return { ok: false, error: controller.signal.aborted ? 'provider_timeout' : 'provider_response_invalid' };
    } finally { clearTimeout(timer); }
}

export async function submitTask(job, cfg) {
    const built = buildRequest(job.provider_endpoint, job.inputs);
    if (!built.ok) return built;
    const r = await request('/v1/draw/nano-banana', built.body, cfg);
    if (!r.ok) return { ...r, errorCode: r.error };
    if (typeof r.data.id !== 'string' || !ID_RE.test(r.data.id)) {
        return { ok: false, error: 'provider_response_invalid', errorCode: 'provider_response_invalid' };
    }
    return { ok: true, providerJobId: r.data.id };
}

export async function fetchTask(taskId, cfg) {
    if (typeof taskId !== 'string' || !ID_RE.test(taskId)) return { ok: false, error: 'task_id_invalid' };
    const r = await request('/v1/draw/result', { id: taskId }, cfg);
    if (!r.ok) return r;
    const data = r.data;
    if (data.id !== taskId) return { ok: false, error: 'provider_response_invalid' };
    if (data.status === 'running') return { ok: true, state: 'pending' };
    if (data.status === 'failed') {
        const moderated = ['input_moderation', 'output_moderation'].includes(data.failure_reason);
        return { ok: true, state: 'fail', errorCode: moderated ? 'provider_moderation' : 'provider_error' };
    }
    if (data.status !== 'succeeded') return { ok: false, error: 'provider_response_invalid' };
    const outputUrl = Array.isArray(data.results) && data.results.length === 1 && data.results[0]?.url;
    if (typeof outputUrl !== 'string' || outputUrl.length > 2048) {
        return { ok: true, state: 'fail', errorCode: 'provider_output_missing' };
    }
    // The shared R2 copier enforces the provider-specific host allowlist and
    // refuses redirects. The API key is never sent to the output host.
    return { ok: true, state: 'success', outputUrl };
}
