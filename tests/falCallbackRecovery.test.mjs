import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
    FAL_WEBHOOK_USER_ID: 'test-tenant', R2_ACCOUNT_ID: 'test-account',
    R2_ACCESS_KEY_ID: 'test-key', R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET: 'test-bucket',
});
const { POST } = await import('../app/api/webhook/fal/route.js');
const { _resetJwksCache } = await import('../packages/adapters/fal.js');
const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
const requestId = 'callback-recovery-fixture';
const encoder = new TextEncoder();
const hex = bytes => Buffer.from(bytes).toString('hex');

async function signedRequest() {
    const body = JSON.stringify({ request_id: requestId, status: 'OK',
        payload: { images: [{ url: 'https://fal.media/files/fixture.jpeg' }] } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const hash = hex(await crypto.subtle.digest('SHA-256', encoder.encode(body)));
    const signature = hex(await crypto.subtle.sign('Ed25519', pair.privateKey,
        encoder.encode(`${requestId}\ntest-tenant\n${timestamp}\n${hash}`)));
    return new Request('https://veyrnox.test/api/webhook/fal', {
        method: 'POST', body, headers: {
            'content-type': 'application/json', 'x-fal-webhook-request-id': requestId,
            'x-fal-webhook-user-id': 'test-tenant', 'x-fal-webhook-timestamp': timestamp,
            'x-fal-webhook-signature': signature,
        },
    });
}

function network(t, { mapped = false, lookupFails = false, copyFailures = 0 } = {}) {
    _resetJwksCache();
    const state = { mapped, processed: false, event: false, stored: 0, jobState: 'SUBMITTED', calls: [] };
    t.mock.method(console, 'error', () => {});
    t.mock.method(console, 'warn', () => {});
    t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
        const u = new URL(String(url)), method = init.method || 'GET';
        state.calls.push({ path: u.pathname, host: u.hostname, method });
        if (u.hostname === 'rest.alpha.fal.ai') return Response.json({ keys: [jwk] });
        if (u.pathname === '/rest/v1/jobs') {
            if (lookupFails) return new Response(null, { status: 503 });
            return Response.json(state.mapped ? [{ id: 'job-fixture', user_id: 'user-fixture',
                credits: 2, state: state.jobState }] : []);
        }
        if (u.pathname === '/rest/v1/job_steps') return Response.json([]);
        if (u.pathname === '/rest/v1/webhook_events') {
            if (method === 'POST') {
                const existed = state.event; state.event = true;
                return Response.json(existed ? [] : [{ id: 'event-fixture' }], { status: 201 });
            }
            if (method === 'PATCH') {
                state.processed = true;
                return new Response(null, { status: 204 });
            }
            return Response.json([{ processed_at: state.processed ? '2026-10-09T00:00:00Z' : null }]);
        }
        if (u.pathname === '/rest/v1/rpc/job_succeeded') {
            if (state.jobState !== 'SUBMITTED') return Response.json({ ok: false });
            state.jobState = 'SUCCEEDED';
            return Response.json({ ok: true });
        }
        if (u.pathname === '/rest/v1/rpc/job_stored') {
            state.stored++; state.jobState = 'STORED';
            return Response.json({ ok: true });
        }
        if (u.hostname === 'fal.media') {
            if (copyFailures-- > 0) return new Response(null, { status: 503 });
            return new Response('image-fixture', { headers: { 'content-type': 'image/jpeg' } });
        }
        if (u.hostname.endsWith('.r2.cloudflarestorage.com') && method === 'PUT') {
            return new Response(null, { status: 200 });
        }
        throw new Error(`Unexpected fixture request: ${method} ${u.hostname}${u.pathname}`);
    });
    return state;
}
const effects = state => state.calls.filter(c => c.method !== 'GET');

test('early signed callback stays retryable; mapped redelivery stores once and duplicate has no effect', async t => {
    const state = network(t);
    const early = await POST(await signedRequest());
    assert.equal(early.status, 409);
    assert.deepEqual(await early.json(), { error: 'job_not_found' });
    assert.equal(state.event, false);
    assert.deepEqual(effects(state), []);

    state.mapped = true;
    assert.equal((await POST(await signedRequest())).status, 200);
    assert.equal(state.stored, 1);
    assert.equal(state.processed, true);
    const before = effects(state).length;
    const duplicate = await POST(await signedRequest());
    assert.equal(duplicate.status, 200);
    assert.deepEqual(await duplicate.json(), { ok: true, duplicate: true });
    assert.equal(state.stored, 1);
    assert.equal(effects(state).length, before + 1, 'duplicate only attempts idempotent inbox insertion');
});

test('job lookup outage returns a retryable response before inbox consumption', async t => {
    const state = network(t, { lookupFails: true });
    assert.equal((await POST(await signedRequest())).status, 500);
    assert.equal(state.event, false);
    assert.deepEqual(effects(state), []);
});

test('transient asset copy leaves the signed delivery unfinished and redelivery completes it', async t => {
    const state = network(t, { mapped: true, copyFailures: 1 });
    assert.equal((await POST(await signedRequest())).status, 500);
    assert.equal(state.jobState, 'SUCCEEDED');
    assert.equal(state.event, true);
    assert.equal(state.processed, false);
    assert.equal(state.stored, 0);
    assert.equal((await POST(await signedRequest())).status, 200);
    assert.equal(state.jobState, 'STORED');
    assert.equal(state.processed, true);
    assert.equal(state.stored, 1);
    assert.equal(state.calls.filter(c => c.method === 'PUT').length, 1);
});
