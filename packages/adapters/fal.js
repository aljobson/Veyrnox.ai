/**
 * fal.ai provider adapter — Worker-runtime version.
 *
 * Two responsibilities:
 *   1. `submitJob(job, cfg)` — POST to queue.fal.run to enqueue a generation.
 *      fal returns `{ request_id, status_url, ... }`; we persist request_id
 *      as jobs.provider_job_id.
 *   2. `verifyWebhookSignature(rawBody, headers, cfg)` — Ed25519 verification
 *      against fal's JWKS. §5.4 architectural invariant: fal uses Ed25519,
 *      NOT HMAC — do not conflate with Replicate's shape.
 *
 * A JS twin of packages/adapters/fal.ts (which stays for Node tests). Web
 * Crypto is native in the Worker runtime and matches Ed25519 exactly.
 * Adding a big JS library (jose, @supabase/supabase-js, tsx) to the root
 * bundle trips the OpenNext / Cloudflare Workers Builds pipeline
 * (bisected on Slice 1 tsx + Slice 3b jose). Web Crypto keeps the
 * dependency graph flat.
 *
 * Configuration (per-call, read from process.env at the route layer):
 *   FAL_KEY — the API key (Key <id>:<secret> shape). Backend only.
 */

const FAL_QUEUE_BASE = 'https://queue.fal.run';
const FAL_JWKS_URL = 'https://rest.alpha.fal.ai/.well-known/jwks.json';
const JWKS_TTL_MS = 24 * 60 * 60 * 1000;

/** @type {{fetchedAt:number, keys:CryptoKey[]} | null} */
let jwksCache = null;

/**
 * Submit a job to fal.ai's queue API. Caller must have already validated
 * the model + debited credits.
 *
 * @param {object} job
 * @param {string} job.job_id            our own jobs.id (UUID)
 * @param {string} job.provider_endpoint fal endpoint from model_catalog.provider_endpoint,
 *                                       e.g. "fal-ai/wan-2.5-standard/text-to-video"
 * @param {object} job.inputs            model-specific payload (prompt, aspect_ratio, ...)
 * @param {object} cfg
 * @param {string} cfg.falKey            FAL_KEY (Backend secret)
 * @param {string} cfg.webhookBaseUrl    Our host + /api/webhook/fal (public)
 * @param {number} [cfg.timeoutMs=15000] submit timeout
 * @returns {Promise<{ok: boolean, providerJobId?: string, statusUrl?: string, error?: string}>}
 */
export async function submitJob(job, cfg) {
    // Job-id-only signalling. fal will call us back with the job_id in the
    // webhook_url's query string so we can look up the matching row.
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(job.job_id)) {
        return { ok: false, error: 'invalid job_id' };
    }
    const endpoint = job.provider_endpoint;
    if (!endpoint || !/^[A-Za-z0-9/_.-]{3,128}$/.test(endpoint)) {
        return { ok: false, error: 'invalid provider_endpoint' };
    }

    // fal takes the webhook URL as a `fal_webhook` query parameter on the
    // POST URL, NOT a JSON body field. Docs: fal.ai/docs/model-endpoints/webhooks.
    let webhookUrl;
    try {
        webhookUrl = new URL(cfg.webhookBaseUrl);
    } catch {
        return { ok: false, error: 'invalid webhookBaseUrl' };
    }
    // Fal POSTs webhook payloads over the public internet — must be TLS.
    if (webhookUrl.protocol !== 'https:') {
        return { ok: false, error: 'webhookBaseUrl must be https' };
    }
    webhookUrl.searchParams.set('job_id', job.job_id);

    const postUrl = new URL(`${FAL_QUEUE_BASE}/${endpoint}`);
    postUrl.searchParams.set('fal_webhook', webhookUrl.toString());

    const payload = { ...job.inputs };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 15000);
    try {
        let res;
        try {
            res = await fetch(postUrl.toString(), {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    Authorization: `Key ${cfg.falKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });
        } catch (err) {
            const msg = err && err.message;
            console.error('fal submit transport error:', msg);
            return { ok: false, error: `transport: ${msg}` };
        }

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            console.error('fal submit non-ok:', res.status, text.slice(0, 200));
            return { ok: false, error: `fal ${res.status}: ${text.slice(0, 200)}` };
        }
        /** @type {any} */
        let data;
        try { data = await res.json(); } catch {
            console.error('fal submit returned non-JSON');
            return { ok: false, error: 'fal returned non-JSON' };
        }
        const providerJobId = data.request_id || data.id;
        if (!providerJobId) {
            console.error('fal submit missing request_id');
            return { ok: false, error: 'fal did not return request_id' };
        }
        return { ok: true, providerJobId, statusUrl: data.status_url };
    } finally {
        clearTimeout(timer);
    }
}

// ─── Webhook verification ──────────────────────────────────────────────────

async function loadFalPublicKeys() {
    const now = Date.now();
    if (jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    let res;
    try {
        res = await fetch(FAL_JWKS_URL, { signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`fal JWKS fetch failed: ${res.status}`);
    const jwks = await res.json();
    const keys = [];
    for (const jwk of (jwks && jwks.keys) || []) {
        if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.x) continue;
        try {
            const key = await crypto.subtle.importKey(
                'jwk',
                { kty: 'OKP', crv: 'Ed25519', x: jwk.x },
                { name: 'Ed25519' },
                false,
                ['verify'],
            );
            keys.push(key);
        } catch {
            // skip unusable key
        }
    }
    if (keys.length === 0) throw new Error('fal JWKS contained no usable Ed25519 keys');
    jwksCache = { fetchedAt: now, keys };
    return keys;
}

function b64ToBytes(s) {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const bin = atob(b64 + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function hexToBytes(hex) {
    if (typeof hex !== 'string' || hex.length % 2 !== 0) throw new Error('bad hex');
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
        const v = parseInt(hex.substr(i * 2, 2), 16);
        if (Number.isNaN(v)) throw new Error('bad hex');
        out[i] = v;
    }
    return out;
}

async function bytesToHex(buf) {
    const arr = new Uint8Array(buf);
    let hex = '';
    for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, '0');
    return hex;
}

const FAL_TIMESTAMP_SKEW_SECONDS = 5 * 60;

/**
 * Verify a fal webhook signature against the JWKS.
 *
 * Fal signs an ED25519 message of shape:
 *   `${request_id}\n${user_id}\n${timestamp}\n${sha256(body).hex}`
 *
 * Signature is hex-encoded (not base64). Timestamp is checked against a
 * ±5-minute window to blunt replay. Docs: fal.ai/docs/model-endpoints/webhooks.
 *
 * @param {Uint8Array} rawBody
 * @param {object} headers  { signature, timestamp, requestId, userId }
 * @returns {Promise<boolean>}
 */
export async function verifyWebhookSignature(rawBody, headers) {
    if (!headers || typeof headers !== 'object') return false;
    const { signature, timestamp, requestId, userId } = headers;
    if (!signature || !timestamp || !requestId || !userId) return false;
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return false;
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - ts) > FAL_TIMESTAMP_SKEW_SECONDS) return false;

    let sigBytes;
    try { sigBytes = hexToBytes(signature.trim()); } catch { return false; }
    if (sigBytes.length !== 64) return false;

    const bodyHash = await crypto.subtle.digest('SHA-256', rawBody);
    const bodyHashHex = await bytesToHex(bodyHash);
    const message = new TextEncoder().encode(
        `${requestId}\n${userId}\n${timestamp}\n${bodyHashHex}`
    );

    let keys;
    try {
        keys = await loadFalPublicKeys();
    } catch (err) {
        // JWKS unavailable — fail closed (unverified) and log for ops.
        console.error('fal JWKS load failed:', err && err.message);
        return false;
    }
    for (const key of keys) {
        if (await crypto.subtle.verify({ name: 'Ed25519' }, key, sigBytes, message)) return true;
    }
    return false;
}

/**
 * Test-only: clear the JWKS cache. Called by adapter tests that mock fetch.
 * Not exported to the runtime path.
 */
export function _resetJwksCache() { jwksCache = null; }
