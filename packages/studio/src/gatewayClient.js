/**
 * Veyrnox gateway client — talks to /api/v1/*.
 *
 * Slice 9 wiring: when the localStorage feature flag `veyrnox_gateway`
 * is `on`, the studio components route generation calls here instead
 * of the legacy MuAPI proxy in muapi.js.
 *
 * Auth: relies on a Supabase SSR session cookie being present on the
 * origin — middleware.js at the app root verifies the JWT and gates
 * /api/v1/*. If the cookie is missing, calls come back 401 and the
 * caller toasts an error prompting a manual Supabase login until the
 * proper login flow ships (Phase 2 signup UI).
 *
 * Shape adapter: the gateway returns { job_id, state, balance_after }
 * on submit and requires polling /api/v1/jobs/:id/asset for the final
 * URL. Callers of `generateViaGateway` get the same `{ url, id }`
 * shape MuAPI proxies used to return, so ImageStudio.jsx's downstream
 * doesn't change.
 */

const FLAG_KEY = "veyrnox_gateway";

/** Lazy resolver — never fails, returns null when not in the browser. */
async function readBearer() {
    try {
        const mod = await import("./authClient.js");
        return mod.getAccessToken ? mod.getAccessToken() : null;
    } catch {
        return null;
    }
}
const IDEMPOTENCY_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";

/** Feature-flag check. Reads localStorage synchronously. */
export function gatewayEnabled() {
    try {
        return globalThis.localStorage?.getItem(FLAG_KEY) === "on";
    } catch {
        return false;
    }
}

/** Generate a random idempotency key that matches the gateway's regex. */
function makeIdempotencyKey() {
    const bytes = new Uint8Array(24);
    globalThis.crypto.getRandomValues(bytes);
    let out = "";
    for (const b of bytes) out += IDEMPOTENCY_ALPHABET[b % IDEMPOTENCY_ALPHABET.length];
    return out;
}

export class GatewayError extends Error {
    constructor(message, { status, code, retryAfter, body } = {}) {
        super(message);
        this.name = "GatewayError";
        this.status = status;
        this.code = code;
        this.retryAfter = retryAfter;
        this.body = body;
    }
}

/**
 * Submit a generation and poll until STORED.
 *
 * @param {object} params
 * @param {string} params.model_id            catalog id, e.g. "wan-2.5"
 * @param {Record<string, unknown>} params.inputs  model-specific inputs
 * @param {string} [params.idempotency_key]   defaults to a random one
 * @param {AbortSignal} [params.signal]       user-cancel
 * @param {(state:string) => void} [params.onState]   fires on each poll
 * @param {number} [params.timeoutMs=300000]  overall polling ceiling
 * @param {number} [params.pollIntervalMs=2000]
 * @returns {Promise<{ id: string, url: string, mime_type: string, size_bytes: number, balance_after: number }>}
 */
export async function generateViaGateway(params) {
    const idempotencyKey = params.idempotency_key || makeIdempotencyKey();
    const submit = await fetch("/api/v1/generations", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        signal: params.signal,
        body: JSON.stringify({
            model_id: params.model_id,
            idempotency_key: idempotencyKey,
            inputs: params.inputs,
        }),
    });

    if (!submit.ok) {
        const body = await safeJson(submit);
        const code = body && (body.error || body.code);
        const retryAfter = Number(submit.headers.get("retry-after")) || null;
        throw new GatewayError(gatewayErrorMessage(submit.status, code), {
            status: submit.status,
            code,
            retryAfter,
            body,
        });
    }

    const submitBody = await submit.json();
    const jobId = submitBody.job_id;
    const balanceAfter = submitBody.balance_after;
    if (!jobId) throw new GatewayError("gateway did not return job_id", { status: 500, body: submitBody });

    // Poll /api/v1/jobs/:id/asset — 404 while pending, 200 with url when STORED.
    const started = Date.now();
    const timeout = params.timeoutMs ?? 300_000;
    const interval = params.pollIntervalMs ?? 2000;

    while (true) {
        if (params.signal?.aborted) throw new GatewayError("cancelled", { status: 0 });
        if (Date.now() - started > timeout) {
            throw new GatewayError("generation timed out", { status: 504, body: { job_id: jobId } });
        }

        // Sleep first — the job needs at least fal's minimum latency
        // (~a few seconds) before the asset can possibly exist.
        await sleep(interval, params.signal);

        const asset = await fetch(`/api/v1/jobs/${encodeURIComponent(jobId)}/asset`, {
            credentials: "same-origin",
            signal: params.signal,
        });
        if (asset.status === 404) {
            params.onState?.("pending");
            continue;
        }
        if (asset.status === 401) {
            throw new GatewayError("session expired", { status: 401 });
        }
        if (!asset.ok) {
            const body = await safeJson(asset);
            throw new GatewayError("asset lookup failed", { status: asset.status, body });
        }
        const assetBody = await asset.json();
        params.onState?.("stored");
        return {
            id: jobId,
            url: assetBody.url,
            mime_type: assetBody.mime_type,
            size_bytes: assetBody.size_bytes,
            balance_after: balanceAfter,
        };
    }
}

/** Fetch current credit balance. Returns 0 on 401. */
export async function fetchBalance() {
    const res = await fetch("/api/v1/balance", { credentials: "same-origin" });
    if (res.status === 401) return null;
    if (!res.ok) throw new GatewayError("balance lookup failed", { status: res.status });
    const body = await res.json();
    return typeof body.balance === "number" ? body.balance : 0;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new GatewayError("cancelled", { status: 0 }));
        const timer = setTimeout(() => {
            signal?.removeEventListener?.("abort", onAbort);
            resolve();
        }, ms);
        function onAbort() {
            clearTimeout(timer);
            reject(new GatewayError("cancelled", { status: 0 }));
        }
        signal?.addEventListener?.("abort", onAbort, { once: true });
    });
}

async function safeJson(res) {
    try { return await res.json(); } catch { return null; }
}

function gatewayErrorMessage(status, code) {
    if (status === 401) return "Sign in to continue.";
    if (status === 402) return "You’re out of credits.";
    if (status === 429) return "You’re being rate-limited — try again in a moment.";
    if (status === 404) return "That model isn’t available.";
    if (status === 501) return "That model isn’t enabled on the new gateway yet.";
    if (status >= 500) return "The gateway is having trouble — try again shortly.";
    return code ? `Request rejected (${code}).` : "Request failed.";
}
