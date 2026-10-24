/**
 * Crun provider adapter (ADR-0256, phase 5), Worker runtime, no dependencies.
 *
 * NOT REGISTERED. Nothing in packages/provider-sdk/registry.js names it and no
 * catalog row uses it, so no job can reach Crun. It exists so the route and its
 * request shapes are reviewed and tested before the owner has answers on resale
 * rights, upstream supply and credit expiry, and before there is a key.
 *
 *   submitTask(job, cfg)   POST /api/v1/client/job/CreateTask
 *   fetchTask(taskId, cfg) GET  /api/v1/client/job/TaskInfo
 *
 * Request shapes are copied from docs.crun.ai (read 2026-10-24) for the
 * text-to-video models only. The TaskInfo query parameter name (`task_id`) and
 * any status word beyond running / success / failed are unconfirmed until one
 * live probe; an unknown status is treated as still running, never as success.
 * Crun documents no signed callback, so the route is poll-only: callback_url
 * is never sent. Media is kept 14 days, so a completed output must be copied to
 * R2 on first read.
 *
 * `provider_endpoint` is `crun:<crun model id>`, for example
 * `crun:google/veo3-1-lite-t2v`.
 */

import { readBoundedBody } from '../../lib/boundedBody.js';

export const CRUN_API_BASE = 'https://api.crun.ai';

// Model id -> what the model accepts. Seconds are the clip lengths that map
// onto one priced unit; resolutions are what the catalog row is priced at.
const MODELS = {
    'google/veo3-1-lite-t2v': { seconds: new Set([8]), resolutions: new Set(['720p']), aspects: new Set(['16:9', '9:16']) },
    'google/veo3-1-fast-t2v': { seconds: new Set([8]), resolutions: new Set(['720p']), aspects: new Set(['16:9', '9:16']) },
    'google/veo3-1-t2v': { seconds: new Set([8]), resolutions: new Set(['720p']), aspects: new Set(['16:9', '9:16']) },
    'bytedance/seedance2-0-fast-t2v': { seconds: new Set([5]), resolutions: new Set(['720p']), aspects: new Set(['16:9', '9:16', '1:1']) },
};
const ENDPOINT_RE = /^crun:([a-z0-9][a-z0-9./_-]{1,80})$/i;
const TASK_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

/** @returns {{model:string}|null} */
export function parseEndpoint(endpoint) {
    const m = ENDPOINT_RE.exec(String(endpoint || ''));
    return m && !m[1].includes('..') && MODELS[m[1]] ? { model: m[1] } : null;
}

/**
 * Map gateway-validated inputs onto a Crun CreateTask body. Refuses what the
 * model cannot take instead of changing what the user asked for.
 * @returns {{ok:true, body:object}|{ok:false, error:string}}
 */
export function buildRequest(target, inputs) {
    const spec = MODELS[target.model];
    if (!spec) return { ok: false, error: 'provider_unsupported' };
    const prompt = typeof inputs.prompt === 'string' ? inputs.prompt.trim() : '';
    if (!prompt) return { ok: false, error: 'prompt_required' };
    // One priced unit per request: the catalog row is costed at this length, so it is pinned and the page's
    // default duration_seconds is ignored, exactly as the kie Veo builder does (the studio sends 5 for every video).
    const seconds = [...spec.seconds][0];
    const aspect = inputs.aspect_ratio === undefined ? '16:9' : inputs.aspect_ratio;
    if (!spec.aspects.has(aspect)) return { ok: false, error: 'aspect_ratio_unsupported' };
    if (inputs.image_url || inputs.reference_urls) return { ok: false, error: 'input_media_unsupported' };
    return {
        ok: true,
        body: { model: target.model, input: { prompt, duration: seconds, resolution: [...spec.resolutions][0], aspect_ratio: aspect } },
    };
}

/**
 * @returns {Promise<{ok:true, providerJobId:string}|{ok:false, outcome:'rejected'|'unknown', error:string, errorCode?:string, clientError?:string}>}
 */
export async function submitTask(job, cfg) {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(String(job.job_id || ''))) return { ok: false, outcome: 'rejected', error: 'invalid job_id' };
    const target = parseEndpoint(job.provider_endpoint);
    if (!target) return { ok: false, outcome: 'rejected', error: 'invalid provider_endpoint' };
    const req = buildRequest(target, job.inputs || {});
    if (!req.ok) return { ok: false, outcome: 'rejected', error: req.error, clientError: req.error };
    if (!cfg?.apiKey) return { ok: false, outcome: 'rejected', error: 'provider_not_configured' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 15000);
    try {
        let res;
        try {
            res = await fetch(`${CRUN_API_BASE}/api/v1/client/job/CreateTask`, {
                method: 'POST',
                redirect: 'manual',
                signal: controller.signal,
                headers: { 'X-API-KEY': cfg.apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body),
            });
        } catch (err) {
            // Nothing is known about whether the task was created: ambiguous (0329).
            return { ok: false, outcome: 'unknown', error: `transport: ${err && err.message}` };
        }
        let data = null;
        try {
            const bytes = await readBoundedBody(res.body, 128 * 1024, controller.signal);
            data = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
            if (res.ok) return { ok: false, outcome: 'unknown', error: 'crun returned an invalid response' };
        }
        const code = data && typeof data.code === 'number' ? data.code : res.status;
        if (!res.ok || code !== 200) {
            const error = `crun ${res.status}/${code}: ${String((data && (data.message || data.msg)) || '').slice(0, 200)}`;
            const outcome = res.status === 408 || res.status >= 500 ? 'unknown' : 'rejected';
            return { ok: false, outcome, error };
        }
        const taskId = data && data.data && data.data.task_id;
        if (typeof taskId !== 'string' || !TASK_ID_RE.test(taskId)) {
            return { ok: false, outcome: 'unknown', error: 'crun did not return a task_id' };
        }
        return { ok: true, providerJobId: taskId };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Map a TaskInfo body onto the shape the sweeps use. An unknown status is
 * pending: a surprise word must never complete a job.
 * @returns {{ok:true, state:'success', outputUrl:string}|{ok:true, state:'fail', errorCode:string}|{ok:true, state:'pending'}|{ok:false, error:string}}
 */
export function interpretTask(data) {
    const task = data && data.data;
    if (!task || typeof task.status !== 'string') return { ok: false, error: 'crun task info missing' };
    if (task.status === 'success') {
        const url = task.result && Array.isArray(task.result.media_urls) ? task.result.media_urls[0] : null;
        if (typeof url !== 'string' || !/^https:\/\//.test(url)) return { ok: false, error: 'crun success without an https output' };
        return { ok: true, state: 'success', outputUrl: url };
    }
    if (task.status === 'failed') return { ok: true, state: 'fail', errorCode: String((task.result && task.result.code) || 'provider_failed').slice(0, 40) };
    return { ok: true, state: 'pending' };
}

export async function fetchTask(taskId, cfg) {
    if (!TASK_ID_RE.test(String(taskId || ''))) return { ok: false, error: 'invalid task_id' };
    const url = new URL(`${CRUN_API_BASE}/api/v1/client/job/TaskInfo`);
    url.searchParams.set('task_id', taskId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 15000);
    try {
        const res = await fetch(url.toString(), { signal: controller.signal, headers: { 'X-API-KEY': cfg.apiKey } });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || data.code !== 200) return { ok: false, error: `crun ${res.status}` };
        return interpretTask(data);
    } catch (err) {
        return { ok: false, error: `transport: ${err && err.message}` };
    } finally {
        clearTimeout(timer);
    }
}
