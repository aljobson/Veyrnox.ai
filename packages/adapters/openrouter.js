/**
 * OpenRouter video provider adapter — Worker runtime, Web Crypto only.
 *
 *   1. `submitVideo(job, cfg)`  POST /api/v1/videos → OpenRouter job id,
 *      persisted as jobs.provider_job_id.
 *   2. `fetchVideo(id, cfg)`    GET /api/v1/videos/{id} — authoritative status.
 *   3. `verifyWebhook(raw, header, cfg)` — X-OpenRouter-Signature
 *      `t=<unix>,v1=<hex HMAC-SHA256 over "<t>," + raw body>`.
 *      docs: openrouter.ai/docs/guides/overview/multimodal/video-generation
 *
 * Outputs are NOT public URLs: /api/v1/videos/{id}/content needs our API key.
 * The webhook downloads from that fixed path on openrouter.ai only — it never
 * follows a URL out of the payload — so the key cannot be sent anywhere else.
 *
 * `provider_endpoint` is the OpenRouter model slug, e.g.
 * "bytedance/seedance-2.0-fast". Only slugs mapped in MODELS are sellable.
 *
 * Configuration (read at the route layer):
 *   OPENROUTER_API_KEY         backend secret
 *   OPENROUTER_WEBHOOK_SECRET  workspace webhook signing secret
 */

export const OPENROUTER_BASE = 'https://openrouter.ai';
const SIGNATURE_WINDOW_SECONDS = 300;
const JOB_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

// Per-model request limits, from GET /api/v1/videos/models (2026-09-12).
// One priced unit = what the catalog row is costed at; the request is pinned
// to it so billing cannot drift from price.
const MODELS = {
    'bytedance/seedance-2.0-fast': {
        // 5 s, 720p, 16:9 — $0.4536 at $4.20/M video tokens. Other aspect
        // ratios change the token count, so only 16:9 and 9:16 are sold.
        durations: { 5: 5, 10: 10 },
        resolution: '720p',
        aspects: new Set(['16:9', '9:16']),
    },
};

/** @returns {{ok:true, body:object}|{ok:false, error:string}} */
export function buildRequest(modelSlug, inputs) {
    const spec = Object.prototype.hasOwnProperty.call(MODELS, modelSlug) ? MODELS[modelSlug] : null;
    if (!spec) return { ok: false, error: 'provider_model_unmapped' };
    const prompt = inputs && inputs.prompt;
    if (typeof prompt !== 'string' || !prompt.trim()) return { ok: false, error: 'inputs_invalid:prompt' };
    const aspect = inputs.aspect_ratio || '16:9';
    if (!spec.aspects.has(aspect)) return { ok: false, error: 'inputs_invalid:aspect_ratio' };
    const seconds = inputs.duration_seconds || 5;
    const duration = spec.durations[seconds];
    if (!duration) return { ok: false, error: 'duration_not_supported' };

    const body = {
        model: modelSlug,
        prompt,
        duration,
        resolution: spec.resolution,
        aspect_ratio: aspect,
        // Always explicit: the docs disagree on the default.
        generate_audio: true,
    };
    if (Number.isInteger(inputs.seed)) body.seed = inputs.seed;
    if (inputs.image_url) {
        body.frame_images = [{ type: 'image_url', image_url: { url: inputs.image_url }, frame_type: 'first_frame' }];
    }
    return { ok: true, body };
}

/**
 * @param {{job_id:string, provider_endpoint:string, inputs:object}} job
 * @param {{apiKey:string, callbackUrl:string, timeoutMs?:number}} cfg
 * @returns {Promise<{ok:true, providerJobId:string}|{ok:false, error:string, clientError?:string}>}
 */
export async function submitVideo(job, cfg) {
    if (!JOB_ID_RE.test(String(job.job_id || ''))) return { ok: false, error: 'invalid job_id' };
    const req = buildRequest(String(job.provider_endpoint || ''), job.inputs || {});
    if (!req.ok) return { ok: false, error: req.error, clientError: req.error };

    let callback;
    try { callback = new URL(cfg.callbackUrl); } catch { return { ok: false, error: 'invalid callbackUrl' }; }
    if (callback.protocol !== 'https:') return { ok: false, error: 'callbackUrl must be https' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 15000);
    try {
        let res;
        try {
            res = await fetch(`${OPENROUTER_BASE}/api/v1/videos`, {
                method: 'POST',
                signal: controller.signal,
                headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...req.body, callback_url: callback.toString() }),
            });
        } catch (err) {
            return { ok: false, error: `transport: ${err && err.message}` };
        }
        const data = await res.json().catch(() => null);
        if (res.status !== 202 && res.status !== 200) {
            return { ok: false, error: `openrouter ${res.status}: ${String(JSON.stringify(data && data.error) || '').slice(0, 200)}` };
        }
        const id = data && data.id;
        if (typeof id !== 'string' || !JOB_ID_RE.test(id)) return { ok: false, error: 'openrouter did not return an id' };
        return { ok: true, providerJobId: id };
    } finally {
        clearTimeout(timer);
    }
}

/** Pure mapping of an OpenRouter job onto our outcome. Exported for tests. */
export function interpretJob(job) {
    const status = job && job.status;
    if (status === 'completed') return { ok: true, state: 'success' };
    if (status === 'failed' || status === 'cancelled' || status === 'expired') {
        const code = (job.error && (job.error.code || job.error.message)) || status;
        return { ok: true, state: 'fail', errorCode: String(code).slice(0, 128) };
    }
    return { ok: true, state: 'pending' };
}

/** Authoritative status read with our key. */
export async function fetchVideo(providerJobId, cfg) {
    if (!JOB_ID_RE.test(String(providerJobId || ''))) return { ok: false, error: 'invalid id' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 15000);
    try {
        const res = await fetch(`${OPENROUTER_BASE}/api/v1/videos/${encodeURIComponent(providerJobId)}`, {
            signal: controller.signal,
            headers: { Authorization: `Bearer ${cfg.apiKey}` },
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) return { ok: false, error: `openrouter poll ${res.status}` };
        return interpretJob(data);
    } catch (err) {
        return { ok: false, error: `transport: ${err && err.message}` };
    } finally {
        clearTimeout(timer);
    }
}

/** The only URL outputs are downloaded from: fixed host, fixed path, our id. */
export function contentUrl(providerJobId, index = 0) {
    return `${OPENROUTER_BASE}/api/v1/videos/${encodeURIComponent(providerJobId)}/content?index=${Number(index) | 0}`;
}

function hex(bytes) {
    return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

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
 * Verify `X-OpenRouter-Signature: t=<unix>,v1=<hex>` over "<t>," + raw body.
 * Fails closed with no secret: OpenRouter delivers unsigned when none is set.
 *
 * @param {Uint8Array} rawBody exact request bytes
 * @param {string|null} header
 * @param {{secret?:string, nowSeconds?:number}} cfg
 */
export async function verifyWebhook(rawBody, header, cfg) {
    if (!cfg || typeof cfg.secret !== 'string' || !cfg.secret) return false;
    if (typeof header !== 'string') return false;
    const parts = Object.fromEntries(header.split(',').map((p) => {
        const i = p.indexOf('=');
        return i > 0 ? [p.slice(0, i).trim(), p.slice(i + 1).trim()] : [p.trim(), ''];
    }));
    const t = parts.t; const v1 = parts.v1;
    if (!/^\d{9,11}$/.test(t || '') || !/^[0-9a-f]{64}$/i.test(v1 || '')) return false;
    const now = cfg.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (Math.abs(now - Number(t)) > SIGNATURE_WINDOW_SECONDS) return false;

    const prefix = new TextEncoder().encode(`${t},`);
    const signed = new Uint8Array(prefix.length + rawBody.length);
    signed.set(prefix, 0);
    signed.set(rawBody, prefix.length);
    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(cfg.secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    return sameString(hex(await crypto.subtle.sign('HMAC', key, signed)), v1.toLowerCase());
}
