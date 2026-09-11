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

    const webhookUrl = new URL(cfg.webhookBaseUrl);
    webhookUrl.searchParams.set('job_id', job.job_id);

    const payload = { ...job.inputs, webhook_url: webhookUrl.toString() };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 15000);
    let res;
    try {
        res = await fetch(`${FAL_QUEUE_BASE}/${endpoint}`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                Authorization: `Key ${cfg.falKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });
    } catch (err) {
        clearTimeout(timer);
        return { ok: false, error: `transport: ${err && err.message}` };
    }
    clearTimeout(timer);

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, error: `fal ${res.status}: ${text.slice(0, 200)}` };
    }
    /** @type {any} */
    let data;
    try { data = await res.json(); } catch { return { ok: false, error: 'fal returned non-JSON' }; }
    const providerJobId = data.request_id || data.id;
    if (!providerJobId) return { ok: false, error: 'fal did not return request_id' };
    return { ok: true, providerJobId, statusUrl: data.status_url };
}

// ─── Webhook verification ──────────────────────────────────────────────────

async function loadFalPublicKeys() {
    const now = Date.now();
    if (jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
    const res = await fetch(FAL_JWKS_URL);
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

/**
 * Verify a fal webhook signature against the JWKS.
 * @param {Uint8Array} rawBody      the exact request body bytes (unparsed)
 * @param {string|null} signatureB64 x-fal-signature-256 header value
 * @returns {Promise<boolean>}
 */
export async function verifyWebhookSignature(rawBody, signatureB64) {
    if (!signatureB64 || typeof signatureB64 !== 'string') return false;
    let sigBytes;
    try { sigBytes = b64ToBytes(signatureB64.trim()); } catch { return false; }
    if (sigBytes.length !== 64) return false;
    const keys = await loadFalPublicKeys();
    for (const key of keys) {
        if (await crypto.subtle.verify({ name: 'Ed25519' }, key, sigBytes, rawBody)) return true;
    }
    return false;
}

/**
 * Test-only: clear the JWKS cache. Called by adapter tests that mock fetch.
 * Not exported to the runtime path.
 */
export function _resetJwksCache() { jwksCache = null; }
