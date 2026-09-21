/**
 * kie.ai provider adapter — Worker runtime, Web Crypto only.
 *
 * Three responsibilities:
 *   1. `submitTask(job, cfg)` — create a generation task; returns kie's taskId,
 *      which we persist as jobs.provider_job_id.
 *   2. `fetchTask(endpoint, taskId, cfg)` — read a task back from kie with our
 *      API key. This is the ONLY source of truth for a kie result.
 *   3. `verifyCallback(taskId, headers, cfg)` — check a callback's HMAC.
 *
 * Why the re-fetch: kie signs only `taskId + "." + timestamp`
 * (docs.kie.ai/common-api/webhook-verification). The body — state and result
 * URLs — is not covered, so a replayed signature could carry a forged result.
 * The webhook therefore treats a verified callback as "go and look", never as
 * the result itself.
 *
 * `provider_endpoint` encodes which kie API a catalog row uses:
 *   market:<model>   POST /api/v1/jobs/createTask   (Nano Banana, Kling, ...)
 *   veo:<model>      POST /api/v1/veo/generate      (veo3_lite | veo3_fast | veo3)
 * Veo uses the tier-explicit endpoint because the unified `veo-3-1` model has
 * no documented way to choose Fast or Quality.
 *
 * Configuration (read at the route layer):
 *   KIE_API_KEY          backend secret
 *   KIE_WEBHOOK_HMAC_KEY the webhookHmacKey enabled in kie.ai settings
 */

export const KIE_API_BASE = 'https://api.kie.ai';
const SIGNATURE_WINDOW_SECONDS = 300;

const MARKET_RE = /^market:[a-z0-9][a-z0-9./_-]{1,96}$/i;
// veo3_lite: kie's cheapest tier, $0.15 per 8s 720p clip (kie.ai/pricing,
// 2026-09-18). Allowed here so a catalog row can name it; the row itself stays
// inactive until scripts/verify-kie-endpoints.mjs has run it live (ADR-0011).
const VEO_MODELS = new Set(['veo3_lite', 'veo3_fast', 'veo3']);

/**
 * @param {string} endpoint catalog provider_endpoint
 * @returns {{kind:'market', model:string}|{kind:'veo', model:string}|null}
 */
export function parseEndpoint(endpoint) {
    const ep = String(endpoint || '');
    if (MARKET_RE.test(ep) && !ep.includes('..')) return { kind: 'market', model: ep.slice('market:'.length) };
    if (ep.startsWith('veo:') && VEO_MODELS.has(ep.slice(4))) return { kind: 'veo', model: ep.slice(4) };
    return null;
}

// Aspect ratios each kie family accepts. Our gateway validates against a wider
// list; a value the model cannot take is refused before the debit.
const VEO_ASPECTS = new Set(['16:9', '9:16']);
const NANO_ASPECTS = new Set(['1:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9']);

/**
 * Map our validated gateway inputs onto a kie request body. Returns an error
 * code instead of silently changing what the user asked for.
 *
 * @param {{kind:string, model:string}} target from parseEndpoint
 * @param {object} inputs  gateway-validated inputs (prompt, aspect_ratio, ...)
 * @returns {{ok:true, body:object}|{ok:false, error:string}}
 */
export function buildRequest(target, inputs) {
    const prompt = inputs && inputs.prompt;
    if (typeof prompt !== 'string' || !prompt.trim()) return { ok: false, error: 'inputs_invalid:prompt' };
    const aspect = inputs.aspect_ratio;

    if (target.kind === 'veo') {
        if (aspect && !VEO_ASPECTS.has(aspect)) return { ok: false, error: 'inputs_invalid:aspect_ratio' };
        if (inputs.duration_seconds && inputs.duration_seconds !== 5) return { ok: false, error: 'duration_not_supported' };
        // One priced unit = kie's per-video price: an 8-second 720p clip with
        // audio (kie.ai/pricing). Duration and resolution are pinned so the
        // request always matches what the catalog row is costed at.
        const body = {
            prompt,
            model: target.model,
            aspect_ratio: aspect || '16:9',
            resolution: '720p',
            duration: 8,
            generationType: inputs.image_url ? 'FIRST_AND_LAST_FRAMES_2_VIDEO' : 'TEXT_2_VIDEO',
            enableTranslation: false,
        };
        if (inputs.image_url) body.imageUrls = [inputs.image_url];
        return { ok: true, body };
    }

    if (target.model === 'google/nano-banana') {
        if (aspect && !NANO_ASPECTS.has(aspect)) return { ok: false, error: 'inputs_invalid:aspect_ratio' };
        if (inputs.image_url) return { ok: false, error: 'inputs_key_not_allowed:image_url' };
        return { ok: true, body: { model: target.model, input: { prompt, aspect_ratio: aspect || '1:1', output_format: 'png' } } };
    }

    // A market model with no mapping here is not sellable: fail closed rather
    // than forward inputs kie may bill differently for.
    return { ok: false, error: 'provider_model_unmapped' };
}

/**
 * Create a kie task. Caller has validated the model and debited credits.
 *
 * @param {object} job
 * @param {string} job.job_id            our jobs.id
 * @param {string} job.provider_endpoint catalog provider_endpoint
 * @param {object} job.inputs            gateway-validated inputs
 * @param {object} cfg
 * @param {string} cfg.apiKey            KIE_API_KEY
 * @param {string} cfg.callbackUrl       https URL of /api/webhook/kie
 * @param {number} [cfg.timeoutMs=15000]
 * @returns {Promise<{ok:true, providerJobId:string}|{ok:false, error:string, clientError?:string}>}
 */
export async function submitTask(job, cfg) {
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(String(job.job_id || ''))) return { ok: false, error: 'invalid job_id' };
    const target = parseEndpoint(job.provider_endpoint);
    if (!target) return { ok: false, error: 'invalid provider_endpoint' };
    const req = buildRequest(target, job.inputs || {});
    if (!req.ok) return { ok: false, error: req.error, clientError: req.error };

    let callback;
    try { callback = new URL(cfg.callbackUrl); } catch { return { ok: false, error: 'invalid callbackUrl' }; }
    if (callback.protocol !== 'https:') return { ok: false, error: 'callbackUrl must be https' };

    const path = target.kind === 'veo' ? '/api/v1/veo/generate' : '/api/v1/jobs/createTask';
    const body = { ...req.body, callBackUrl: callback.toString() };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 15000);
    try {
        let res;
        try {
            res = await fetch(`${KIE_API_BASE}${path}`, {
                method: 'POST',
                signal: controller.signal,
                headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        } catch (err) {
            return { ok: false, error: `transport: ${err && err.message}` };
        }
        const data = await res.json().catch(() => null);
        // kie reports errors both as HTTP status and as a `code` field in a 200.
        const code = data && typeof data.code === 'number' ? data.code : res.status;
        if (!res.ok || code !== 200) {
            return { ok: false, error: `kie ${res.status}/${code}: ${String((data && data.msg) || '').slice(0, 200)}` };
        }
        const taskId = data && data.data && data.data.taskId;
        if (typeof taskId !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(taskId)) {
            return { ok: false, error: 'kie did not return a taskId' };
        }
        return { ok: true, providerJobId: taskId };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Read a task back from kie. Authoritative: uses our API key over TLS to kie's
 * fixed host, so its answer can be trusted where a callback body cannot.
 *
 * @returns {Promise<
 *   {ok:true, state:'success', outputUrl:string} |
 *   {ok:true, state:'fail', errorCode:string} |
 *   {ok:true, state:'pending'} |
 *   {ok:false, error:string}
 * >}
 */
export async function fetchTask(providerEndpoint, taskId, cfg) {
    const target = parseEndpoint(providerEndpoint);
    if (!target) return { ok: false, error: 'invalid provider_endpoint' };
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(String(taskId || ''))) return { ok: false, error: 'invalid taskId' };

    const path = target.kind === 'veo' ? '/api/v1/veo/record-info' : '/api/v1/jobs/recordInfo';
    const url = new URL(`${KIE_API_BASE}${path}`);
    url.searchParams.set('taskId', taskId);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 15000);
    let data;
    try {
        const res = await fetch(url.toString(), {
            signal: controller.signal,
            headers: { Authorization: `Bearer ${cfg.apiKey}` },
        });
        data = await res.json().catch(() => null);
        if (!res.ok || !data || data.code !== 200 || !data.data) {
            return { ok: false, error: `kie record ${res.status}/${data && data.code}` };
        }
    } catch (err) {
        return { ok: false, error: `transport: ${err && err.message}` };
    } finally {
        clearTimeout(timer);
    }
    return interpretRecord(target.kind, data.data);
}

/** Pure mapping of a kie record onto our outcome. Exported for tests. */
export function interpretRecord(kind, record) {
    if (kind === 'veo') {
        // successFlag: 0 generating, 1 success, 2 failed, 3 generation failed.
        const flag = Number(record.successFlag);
        if (flag === 1) {
            const urls = record.response && record.response.resultUrls;
            const url = Array.isArray(urls) && typeof urls[0] === 'string' ? urls[0] : null;
            return url ? { ok: true, state: 'success', outputUrl: url } : { ok: true, state: 'fail', errorCode: 'no_output_url' };
        }
        if (flag === 2 || flag === 3) return { ok: true, state: 'fail', errorCode: String(record.errorCode || 'provider_error').slice(0, 128) };
        return { ok: true, state: 'pending' };
    }
    // market: state waiting | queuing | generating | success | fail
    if (record.state === 'success') {
        let parsed = null;
        try { parsed = typeof record.resultJson === 'string' ? JSON.parse(record.resultJson) : record.resultJson; } catch { parsed = null; }
        const urls = parsed && parsed.resultUrls;
        const url = Array.isArray(urls) && typeof urls[0] === 'string' ? urls[0] : null;
        return url ? { ok: true, state: 'success', outputUrl: url } : { ok: true, state: 'fail', errorCode: 'no_output_url' };
    }
    if (record.state === 'fail') return { ok: true, state: 'fail', errorCode: String(record.failCode || 'provider_error').slice(0, 128) };
    return { ok: true, state: 'pending' };
}

function b64(bytes) {
    let s = '';
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s);
}

/** Constant-time string compare over equal-length digests. */
async function sameString(a, b) {
    const enc = new TextEncoder();
    const [da, db] = await Promise.all([
        crypto.subtle.digest('SHA-256', enc.encode(a)),
        crypto.subtle.digest('SHA-256', enc.encode(b)),
    ]);
    const x = new Uint8Array(da); const y = new Uint8Array(db);
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
    return diff === 0;
}

/**
 * Verify a kie callback: base64(HMAC-SHA256(taskId + "." + timestamp, key)).
 * Fails closed when no key is configured — kie sends unsigned callbacks unless
 * webhookHmacKey is enabled, and an unsigned callback is not ours to trust.
 *
 * @param {string} taskId
 * @param {{signature:string|null, timestamp:string|null}} headers
 * @param {{hmacKey?:string, nowSeconds?:number}} cfg
 */
export async function verifyCallback(taskId, headers, cfg) {
    if (!cfg || typeof cfg.hmacKey !== 'string' || !cfg.hmacKey) return false;
    if (!headers || typeof headers.signature !== 'string' || typeof headers.timestamp !== 'string') return false;
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(String(taskId || ''))) return false;
    if (!/^\d{9,11}$/.test(headers.timestamp)) return false;
    const now = cfg.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(headers.timestamp)) > SIGNATURE_WINDOW_SECONDS) return false;

    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(cfg.hmacKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${taskId}.${headers.timestamp}`));
    return sameString(b64(mac), headers.signature.trim());
}

/**
 * The task id from a kie callback body. The docs disagree on its location
 * (data.taskId in callback schemas, data.task_id in the verification guide).
 */
export function callbackTaskId(body) {
    const d = body && body.data;
    const id = (d && (d.taskId || d.task_id)) || (body && (body.taskId || body.task_id));
    return typeof id === 'string' ? id : null;
}
