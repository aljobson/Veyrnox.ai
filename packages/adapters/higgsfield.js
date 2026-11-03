/**
 * Higgsfield Kling adapter (ADR-0256), Worker runtime, no dependencies.
 * Ships dark: polling only, no webhook. Outputs expire after seven days and
 * must be copied immediately; the output host remains unverified and R2 refuses it.
 * Request contracts: frozen work order, docs.higgsfield.ai, 2026-11-03.
 */
import { readBoundedBody } from '../../lib/boundedBody.js';
import { GENERATION_PROMPT_MAX } from '../../lib/generationPromptLimits.js';

export const HIGGSFIELD_API_BASE = 'https://api.higgsfield.ai';
const IMAGE_MODEL = 'kling-video/v3.0/pro/image-to-video';
const TEXT_MODEL = 'kling-video/v2.6/pro/text-to-video';
// Dot-only path segments would be normalized by URL/fetch instead of naming a request.
const TASK_ID_RE = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,128}(?![\s\S])/;
const PROMPT_MAX = Math.min(2500, GENERATION_PROMPT_MAX);
const SECONDS = new Set([5, 10]);
const ASPECTS = new Set(['16:9', '9:16', '1:1']);

export function parseEndpoint(endpoint) {
    if (endpoint === `higgsfield:${IMAGE_MODEL}`) return { model: IMAGE_MODEL };
    if (endpoint === `higgsfield:${TEXT_MODEL}`) return { model: TEXT_MODEL };
    return null;
}

export function endpointKind(endpoint) {
    return parseEndpoint(endpoint) ? 'video' : null;
}

function isHttps(value) {
    if (typeof value !== 'string' || !/^https:\/\/\S+$/.test(value)) return false;
    try { const url = new URL(value); return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password; }
    catch { return false; }
}

export function buildRequest(target, inputs = {}) {
    if (!target || ![IMAGE_MODEL, TEXT_MODEL].includes(target.model)) return { ok: false, error: 'provider_unsupported' };
    const image = target.model === IMAGE_MODEL;
    const allowed = new Set(['prompt', 'duration_seconds', image ? 'image_url' : 'aspect_ratio']);
    for (const key of Object.keys(inputs)) {
        if (!allowed.has(key)) return { ok: false, error: `inputs_key_not_allowed:${key.slice(0, 32)}` };
    }
    const prompt = typeof inputs.prompt === 'string' ? inputs.prompt.trim() : '';
    if (!prompt) return { ok: false, error: 'prompt_required' };
    if (prompt.length > PROMPT_MAX) return { ok: false, error: 'inputs_invalid:prompt' };
    const duration = inputs.duration_seconds === undefined ? 5 : inputs.duration_seconds;
    if (!SECONDS.has(duration)) return { ok: false, error: 'duration_not_supported' };
    // Higgsfield defaults sound ON and bills it at 1.5x on 3.0. Every request pins it off.
    const body = { sound: 'off', prompt, duration };
    if (image) {
        if (!isHttps(inputs.image_url)) return { ok: false, error: 'inputs_invalid:image_url' };
        // Film Studio passport handles are labels, exactly as in the kie builder.
        body.prompt = prompt.replace(/@([a-zA-Z][a-zA-Z0-9_]{0,39}:v[1-9]\d{0,3})\b/g, '$1');
        body.image_url = inputs.image_url;
        body.multi_shots = false;
    } else {
        const aspect = inputs.aspect_ratio === undefined ? '16:9' : inputs.aspect_ratio;
        if (!ASPECTS.has(aspect)) return { ok: false, error: 'inputs_invalid:aspect_ratio' };
        body.aspect_ratio = aspect;
    }
    return { ok: true, body };
}

async function readJson(res, signal) {
    const bytes = await readBoundedBody(res.body, 128 * 1024, signal);
    return JSON.parse(new TextDecoder().decode(bytes));
}

/** Same rejected/unknown contract as Crun. Never expose upstream payloads or transport messages. */
export async function submitTask(job, cfg) {
    if (typeof job.job_id !== 'string' || !TASK_ID_RE.test(job.job_id)) return { ok: false, outcome: 'rejected', error: 'invalid job_id' };
    const target = parseEndpoint(job.provider_endpoint);
    if (!target) return { ok: false, outcome: 'rejected', error: 'invalid provider_endpoint' };
    const req = buildRequest(target, job.inputs || {});
    if (!req.ok) return { ok: false, outcome: 'rejected', error: req.error, clientError: req.error };
    if (!cfg?.apiKey) return { ok: false, outcome: 'rejected', error: 'provider_not_configured' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 15000);
    try {
        const res = await fetch(`${HIGGSFIELD_API_BASE}/${target.model}`, {
            method: 'POST', redirect: 'manual', signal: controller.signal,
            headers: { Authorization: `Key ${cfg.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': job.job_id },
            body: JSON.stringify(req.body),
        });
        // Refusal format: "higgsfield <HTTP status>/rejected". Failover pins 401/403/429 only.
        // In particular 429 account_queue_full creates no task and incurs no charge, regardless of Retry-After.
        if (!res.ok) {
            void res.body?.cancel().catch(() => {});
            const outcome = res.status === 408 || res.status >= 500 ? 'unknown' : 'rejected';
            return { ok: false, outcome, error: `higgsfield ${res.status}/${outcome}` };
        }
        const data = await readJson(res, controller.signal);
        const taskId = data?.request_id;
        if (typeof taskId !== 'string' || !TASK_ID_RE.test(taskId)) return { ok: false, outcome: 'unknown', error: 'higgsfield invalid request_id' };
        // Only the id survives to the next tick. Never read or persist status_url or cancel_url.
        return { ok: true, providerJobId: taskId };
    } catch {
        return { ok: false, outcome: 'unknown', error: 'higgsfield response unavailable' };
    } finally { clearTimeout(timer); }
}

export function interpretTask(data) {
    if (data?.status === 'completed') {
        const url = data.video?.url;
        return isHttps(url) ? { ok: true, state: 'success', outputUrl: url }
            : { ok: false, error: 'higgsfield completed without an https output' };
    }
    if (data?.status === 'failed') return { ok: true, state: 'fail', errorCode: 'provider_failed' };
    if (data?.status === 'nsfw') return { ok: true, state: 'fail', errorCode: 'provider_moderated' };
    if (data?.status === 'canceled') return { ok: true, state: 'fail', errorCode: 'provider_canceled' };
    return { ok: true, state: 'pending' };
}

export async function fetchTask(taskId, cfg) {
    if (typeof taskId !== 'string' || !TASK_ID_RE.test(taskId)) return { ok: false, error: 'invalid request_id' };
    if (!cfg?.apiKey) return { ok: false, error: 'provider_not_configured' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 15000);
    try {
        const res = await fetch(`${HIGGSFIELD_API_BASE}/requests/${encodeURIComponent(taskId)}/status`, {
            redirect: 'manual', signal: controller.signal, headers: { Authorization: `Key ${cfg.apiKey}` },
        });
        if (!res.ok) { void res.body?.cancel().catch(() => {}); return { ok: false, error: `higgsfield ${res.status}` }; }
        return interpretTask(await readJson(res, controller.signal));
    } catch { return { ok: false, error: 'higgsfield response unavailable' }; }
    finally { clearTimeout(timer); }
}
