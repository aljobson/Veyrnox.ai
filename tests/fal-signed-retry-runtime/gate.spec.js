import { env } from 'cloudflare:workers';
import { reset, evictDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { signedRetryFetch, retryPlan } from '../../workers/staging-fal-signed-retry-worker.js';
import { _resetJwksCache } from '../../packages/adapters/fal.js';

const job = '11111111-1111-4111-8111-111111111111';
const handle = '22222222-2222-4222-8222-222222222222';
const wrong = '33333333-3333-4333-8333-333333333333';
const encoder = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
let pair;
beforeEach(async () => {
    _resetJwksCache();
    pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
        expect(String(url)).toBe('https://rest.alpha.fal.ai/.well-known/jwks.json');
        return Response.json({ keys: [jwk] });
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(async () => { vi.restoreAllMocks(); await reset(); });
async function request({ user = 'test-tenant', requestId = handle, bodyId = requestId, tamper = false, jobId = job } = {}) {
    const raw = JSON.stringify({ request_id: bodyId, status: 'OK', payload: { images: [{ url: 'https://fal.media/private-fixture.png' }] } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const hash = hex(await crypto.subtle.digest('SHA-256', encoder.encode(raw)));
    const signature = hex(await crypto.subtle.sign('Ed25519', pair.privateKey, encoder.encode(`${requestId}\n${user}\n${timestamp}\n${hash}`)));
    return new Request(`https://relay.test/api/webhook/fal?job_id=${jobId}`, { method: 'POST', body: raw + (tamper ? ' ' : ''), headers: {
        'x-fal-webhook-signature': signature, 'x-fal-webhook-user-id': user,
        'x-fal-webhook-request-id': requestId, 'x-fal-webhook-timestamp': timestamp,
    } });
}
const cfg = forward => ({ ...env, STAGING_APP: { fetch: forward } });

it('persists a single rejection across eviction and refuses conflicting handle registration', async () => {
    const stub = env.CALLBACK_GATE.getByName(job);
    expect(await stub.delivery(job, handle)).toBe('UNMAPPED');
    await stub.register(job, handle); await stub.register(job, handle);
    expect(await stub.register(job, wrong)).toBe(false);
    expect(await stub.delivery(job, wrong)).toBe('REFUSED');
    const outcomes = await Promise.all([stub.delivery(job, handle), stub.delivery(job, handle)]);
    expect(outcomes.sort()).toEqual(['FORWARD', 'REJECT_ONCE']);
    await evictDurableObject(stub);
    expect(await stub.delivery(job, handle)).toBe('FORWARD');
    expect(await stub.register(wrong, handle)).toBe(false);
});
it('real verifier rejects unsigned, altered and other-tenant requests before gate/storage effects', async () => {
    const forward = vi.fn(); const config = cfg(forward);
    for (const req of [new Request(`https://relay.test/api/webhook/fal?job_id=${job}`, { method: 'POST', body: '{}' }),
        await request({ tamper: true }), await request({ user: 'other-tenant' })]) {
        expect((await signedRetryFetch(req, config)).status).toBe(401);
    }
    await env.CALLBACK_GATE.getByName(job).register(job, handle);
    expect(await env.CALLBACK_GATE.getByName(job).delivery(job, handle)).toBe('REJECT_ONCE');
    expect(forward).not.toHaveBeenCalled();
});
it('early verified delivery retries; first mapped delivery faults; later delivery preserves signed bytes and headers', async () => {
    const forwarded = []; const forward = vi.fn(async req => { forwarded.push(req); return Response.json({ ok: true }); });
    const config = cfg(forward);
    expect((await signedRetryFetch(await request(), config)).status).toBe(409);
    await env.CALLBACK_GATE.getByName(job).register(job, handle);
    expect((await signedRetryFetch(await request(), config)).status).toBe(503);
    expect(forward).not.toHaveBeenCalled();
    const req = await request(), raw = await req.clone().text();
    expect((await signedRetryFetch(req, config)).status).toBe(200);
    expect(forwarded[0].url).toBe(`${env.PUBLIC_HOST}/api/webhook/fal?job_id=${job}`);
    expect(await forwarded[0].text()).toBe(raw);
    expect(forwarded[0].headers.get('x-fal-webhook-signature')).toBe(req.headers.get('x-fal-webhook-signature'));
    expect((await signedRetryFetch(await request(), config)).status).toBe(200);
    expect(forward).toHaveBeenCalledTimes(2);
});
it('mapping/body mismatches do not consume the rejection and forwarding outages remain retryable', async () => {
    const config = cfg(vi.fn(async () => new Response(null, { status: 302 })));
    await env.CALLBACK_GATE.getByName(job).register(job, handle);
    expect((await signedRetryFetch(await request({ bodyId: wrong }), config)).status).toBe(400);
    expect((await signedRetryFetch(await request({ requestId: wrong }), config)).status).toBe(401);
    expect((await signedRetryFetch(await request(), config)).status).toBe(503);
    expect((await signedRetryFetch(await request(), config)).status).toBe(503);
    expect((await signedRetryFetch(await request(), cfg(async () => { throw Error('outage'); }))).status).toBe(503);
});
it('production, missing bindings, expired plans and body overflow fail closed', async () => {
    for (const patch of [{ APP_ENV: 'production' }, { PUBLIC_HOST: 'https://veyrnox.ai' },
        { FAL_SIGNED_RETRY_ENABLED: 'false' }, { FAL_SIGNED_RETRY_JOB_ID: 'bad' },
        { FAL_SIGNED_RETRY_EXPIRES_AT: new Date(0).toISOString() }]) {
        expect(retryPlan({ ...env, ...patch })).toBe(false);
        expect((await signedRetryFetch(await request(), { ...cfg(vi.fn()), ...patch })).status).toBe(404);
    }
    expect((await signedRetryFetch(await request(), { ...env })).status).toBe(404);
    expect((await signedRetryFetch(await request({ jobId: wrong }), cfg(vi.fn()))).status).toBe(404);
    const large = new Request(`https://relay.test/api/webhook/fal?job_id=${job}`, { method: 'POST', body: 'x'.repeat(128 * 1024 + 1) });
    expect((await signedRetryFetch(large, cfg(vi.fn()))).status).toBe(413);
});
