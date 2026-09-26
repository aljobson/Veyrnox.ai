import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-role',
    PUBLIC_HOST: 'https://veyrnox.test', BYTEPLUS_API_KEY: 'test-byteplus', FAL_KEY: 'test-fal',
    R2_ACCOUNT_ID: 'test-account', R2_ACCESS_KEY_ID: 'test-access',
    R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET: 'test-bucket',
});
const { POST } = await import('../app/api/v1/generations/route.js');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });
const endpoints = ['seedance-2.0-fast', 'seedance-2.0-mini', 'seedance-2.0', 'seedance-2.5', 'seedance-1.0-pro-fast'];

async function invoke({ country = 'US', provider = 'byteplus', endpoint = endpoints[0], active = true } = {}) {
    const calls = [];
    globalThis.fetch = async (url) => {
        const u = new URL(url);
        const name = u.hostname === 'db.test' ? u.pathname.split('/').pop() : 'provider-submit';
        calls.push(name);
        if (name === 'check_generation_rate_limit') return Response.json({ ok: true });
        if (name === 'model_catalog') return Response.json([{
            id: 'test-model', provider, active, credits_5s: 20, modality: 'text-to-video',
            provider_endpoint: provider === 'byteplus' ? `byteplus:${endpoint}` : 'fal-ai/wan-25-preview/text-to-video',
        }]);
        if (name === 'users') return Response.json([{ id: 'test-user' }]);
        if (name === 'ledger_debit') return Response.json({ ok: true, job_id: 'test-job', balance_after: 80 });
        if (name === 'provider-submit') return Response.json({ id: 'provider-job', request_id: 'provider-job' });
        if (name === 'job_submitted') return Response.json({ ok: true });
        assert.fail(`Unexpected network call: ${url}`);
    };
    const headers = { 'content-type': 'application/json', 'x-veyrnox-auth-id': 'test-auth' };
    if (country !== null) headers['cf-ipcountry'] = country;
    const response = await POST(new Request('https://veyrnox.test/api/v1/generations', {
        method: 'POST', headers,
        body: JSON.stringify({ model_id: 'test-model', idempotency_key: 'region-test-001', inputs: { prompt: 'A landscape' } }),
    }));
    return { status: response.status, body: await response.json(), calls };
}

test('US requests to every BytePlus row stop before debit, job creation and provider submission', async () => {
    for (const endpoint of endpoints) for (const country of ['US', 'us', ' Us ']) {
        const result = await invoke({ endpoint, country });
        assert.deepEqual(result, {
            status: 451, body: { error: 'model_region_unavailable' },
            calls: ['check_generation_rate_limit', 'model_catalog'],
        });
    }
});

test('non-US and missing/unknown country headers preserve BytePlus submission', async () => {
    for (const country of ['GB', 'ES', 'SG', null, 'XX', 'T1']) {
        const result = await invoke({ country });
        assert.equal(result.status, 200);
        assert.equal(result.body.state, 'SUBMITTED');
        assert.deepEqual(result.calls, ['check_generation_rate_limit', 'model_catalog', 'users', 'ledger_debit', 'provider-submit', 'job_submitted']);
    }
});

test('US users can still submit to other providers', async () => {
    const result = await invoke({ provider: 'fal' });
    assert.equal(result.status, 200);
    assert.equal(result.body.state, 'SUBMITTED');
    assert.ok(result.calls.includes('ledger_debit'));
    assert.ok(result.calls.includes('provider-submit'));
});

test('inactive BytePlus rows retain model-not-found behavior', async () => {
    const result = await invoke({ active: false });
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, { error: 'model_not_found' });
    assert.deepEqual(result.calls, ['check_generation_rate_limit', 'model_catalog']);
});
