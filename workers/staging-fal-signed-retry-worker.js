// Operator-only, expiring staging callback relay. Never imported by the application.
import { DurableObject } from 'cloudflare:workers';
import { verifyWebhookSignature } from '../packages/adapters/fal.js';
import { FAL_JOB_ID } from '../lib/falDispatchMessage.js';

export function retryPlan(env, now = Date.now()) {
    const remaining = Date.parse(env.FAL_SIGNED_RETRY_EXPIRES_AT) - now;
    return env.FAL_SIGNED_RETRY_ENABLED === 'true'
        && env.APP_ENV === 'staging'
        && env.PUBLIC_HOST === 'https://veyrnox-ai-staging.al-jobson.workers.dev'
        && FAL_JOB_ID.test(env.FAL_SIGNED_RETRY_JOB_ID || '')
        && typeof env.FAL_WEBHOOK_USER_ID === 'string' && !!env.FAL_WEBHOOK_USER_ID
        && remaining > 0 && remaining <= 900_000;
}

export class FalSignedRetryGate extends DurableObject {
    constructor(ctx, env) {
        super(ctx, env);
        ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS gate (job_id TEXT PRIMARY KEY, request_id TEXT NOT NULL, rejected INTEGER NOT NULL DEFAULT 0)');
    }
    register(jobId, requestId) {
        if (!retryPlan(this.env) || jobId !== this.env.FAL_SIGNED_RETRY_JOB_ID || !FAL_JOB_ID.test(requestId || '')) return false;
        this.ctx.storage.sql.exec('INSERT OR IGNORE INTO gate(job_id,request_id) VALUES (?,?)', jobId, requestId);
        const saved = this.ctx.storage.sql.exec('SELECT request_id FROM gate WHERE job_id=?', jobId).one();
        return saved.request_id === requestId;
    }
    delivery(jobId, requestId) {
        if (!retryPlan(this.env) || jobId !== this.env.FAL_SIGNED_RETRY_JOB_ID) return 'REFUSED';
        const saved = this.ctx.storage.sql.exec('SELECT request_id FROM gate WHERE job_id=?', jobId).toArray()[0];
        if (!saved) return 'UNMAPPED';
        if (saved.request_id !== requestId) return 'REFUSED';
        const first = this.ctx.storage.sql.exec('UPDATE gate SET rejected=1 WHERE job_id=? AND rejected=0 RETURNING job_id', jobId).toArray();
        return first.length ? 'REJECT_ONCE' : 'FORWARD';
    }
}

async function boundedBody(request) {
    const reader = request.body?.getReader();
    if (!reader) return new Uint8Array();
    const chunks = []; let length = 0, expired = false;
    const deadline = setTimeout(() => { expired = true; void reader.cancel().catch(() => {}); }, 5000);
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (expired) throw Error('body timeout');
            if (done) break;
            length += value.byteLength;
            if (length > 128 * 1024) { await reader.cancel(); throw Error('body limit'); }
            chunks.push(value);
        }
    } finally { clearTimeout(deadline); reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
}

export async function signedRetryFetch(request, env) {
    const url = new URL(request.url), jobId = url.searchParams.get('job_id');
    if (!retryPlan(env) || request.method !== 'POST' || url.pathname !== '/api/webhook/fal'
        || jobId !== env.FAL_SIGNED_RETRY_JOB_ID || !env.CALLBACK_GATE || !env.STAGING_APP) return new Response(null, { status: 404 });
    let raw;
    try { raw = await boundedBody(request); } catch { return new Response(null, { status: 413 }); }
    const signatureHeaders = { signature: request.headers.get('x-fal-webhook-signature'),
        timestamp: request.headers.get('x-fal-webhook-timestamp'), requestId: request.headers.get('x-fal-webhook-request-id'),
        userId: request.headers.get('x-fal-webhook-user-id') };
    if (!await verifyWebhookSignature(raw, signatureHeaders, { expectedUserId: env.FAL_WEBHOOK_USER_ID })) return new Response(null, { status: 401 });
    let body;
    try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { return new Response(null, { status: 400 }); }
    if (body.request_id !== signatureHeaders.requestId) return new Response(null, { status: 400 });
    const decision = await env.CALLBACK_GATE.getByName(jobId).delivery(jobId, body.request_id);
    console.log(JSON.stringify({ event: 'staging.fal_signed_retry', job_id: jobId, request_id: body.request_id, decision }));
    if (decision !== 'FORWARD') return new Response(null, { status: decision === 'REFUSED' ? 401 : decision === 'UNMAPPED' ? 409 : 503 });
    // Preserve signed bytes and headers. The application's real verifier runs again.
    const headers = new Headers({ 'content-type': 'application/json' });
    for (const name of ['x-fal-webhook-signature', 'x-fal-webhook-timestamp', 'x-fal-webhook-request-id', 'x-fal-webhook-user-id']) headers.set(name, request.headers.get(name));
    const forwarded = new Request(`${env.PUBLIC_HOST}/api/webhook/fal?job_id=${jobId}`, {
        method: 'POST', headers, body: raw, redirect: 'manual', signal: AbortSignal.timeout(110_000),
    });
    try {
        const result = await env.STAGING_APP.fetch(forwarded);
        console.log(JSON.stringify({ event: 'staging.fal_signed_forward', job_id: jobId, status: result.status }));
        return new Response(null, { status: result.status >= 300 && result.status < 400 ? 503 : result.status });
    } catch { return new Response(null, { status: 503 }); }
}
export default { fetch: signedRetryFetch };
