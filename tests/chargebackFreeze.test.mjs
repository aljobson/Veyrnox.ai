import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// Next resolves the extensionless `next/server` through its bundler; plain
// Node ESM needs the file name.
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    FAL_KEY: 'fal-test',
    PUBLIC_HOST: 'https://veyrnox.test',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_0123456789abcdef0123456789abcdef',
    PUBLIC_HOST: 'https://veyrnox.test',
});

const generations = await import('../app/api/v1/generations/route.js');
const topUps = await import('../app/api/v1/top-ups/route.js');

// ── routes ─────────────────────────────────────────────────────────────────

function stubFetch(routes) {
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
        const u = String(url);
        calls.push({ url: u, body: init.body ? JSON.parse(init.body) : undefined, method: init.method });
        for (const [needle, reply] of routes) {
            if (u.includes(needle)) return typeof reply === 'function' ? reply(u, init) : Response.json(reply);
        }
        throw new Error(`unexpected fetch ${u}`);
    };
    return calls;
}

test('a Frozen account gets 403 account_frozen from generations, and nothing is submitted', async () => {
    const calls = stubFetch([
        ['/rpc/check_generation_rate_limit', { ok: true }],
        ['/rest/v1/model_catalog', [{ id: 'm1', provider: 'fal', provider_endpoint: 'fal-ai/flux-2-pro', modality: 'text-to-image', credits_5s: 4, gated_flag: false, active: true }]],
        ['/rest/v1/users', [{ id: '00000000-0000-4000-8000-000000000009' }]],
        ['/rpc/ledger_debit', { ok: false, code: 'ACCOUNT_FROZEN' }],
    ]);
    const res = await generations.POST(new Request('https://veyrnox.test/api/v1/generations', {
        method: 'POST',
        headers: { 'x-veyrnox-auth-id': 'auth-user-1', 'content-type': 'application/json' },
        body: JSON.stringify({ model_id: 'm1', idempotency_key: 'gen-key-0001', inputs: { prompt: 'a cat' } }),
    }));
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'account_frozen' });
    assert.ok(!calls.some((c) => c.url.includes('fal.run') || c.url.includes('queue.fal')), 'no provider submission');
});

// Gateway contract checks (ADR-0027) share this file's fetch stub.
function genRequest(inputs) {
    return new Request('https://veyrnox.test/api/v1/generations', {
        method: 'POST',
        headers: { 'x-veyrnox-auth-id': 'auth-user-1', 'content-type': 'application/json' },
        body: JSON.stringify({ model_id: 'm1', idempotency_key: 'gen-key-0002', inputs }),
    });
}

test('an active row with no capability record gets 501 before any debit', async () => {
    const calls = stubFetch([
        ['/rpc/check_generation_rate_limit', { ok: true }],
        ['/rest/v1/model_catalog', [{ id: 'm1', provider: 'fal', provider_endpoint: 'fal-ai/unknown-model', modality: 'text-to-image', credits_5s: 4, gated_flag: false, active: true }]],
    ]);
    const res = await generations.POST(genRequest({ prompt: 'a cat' }));
    assert.equal(res.status, 501);
    assert.deepEqual(await res.json(), { error: 'provider_unsupported' });
    assert.ok(!calls.some((c) => c.url.includes('/rpc/ledger_debit')), 'no debit');
});

test('undeclared keys never reach the job row', async () => {
    const calls = stubFetch([
        ['/rpc/check_generation_rate_limit', { ok: true }],
        ['/rest/v1/model_catalog', [{ id: 'm1', provider: 'fal', provider_endpoint: 'fal-ai/elevenlabs/sound-effects/v2', modality: 'text-to-audio', credits_5s: 4, gated_flag: false, active: true }]],
        ['/rest/v1/users', [{ id: '00000000-0000-4000-8000-000000000009' }]],
        ['/rpc/ledger_debit', { ok: false, code: 'ACCOUNT_FROZEN' }],
    ]);
    await generations.POST(genRequest({ prompt: 'rain', aspect_ratio: '16:9' }));
    const debit = calls.find((c) => c.url.includes('/rpc/ledger_debit'));
    assert.deepEqual(debit.body.p_inputs, { prompt: 'rain' });
});

test('a Frozen account gets 403 account_frozen from top-ups, and no checkout is created', async () => {
    const calls = stubFetch([['/rpc/create_pending_top_up', { ok: false, code: 'ACCOUNT_FROZEN' }]]);
    const res = await topUps.POST(new Request('https://veyrnox.test/api/v1/top-ups', {
        method: 'POST',
        headers: { 'x-veyrnox-auth-id': '11111111-1111-4111-8111-111111111111', 'content-type': 'application/json' },
        body: JSON.stringify({ pack_id: 'web-300', idempotency_key: 'topup-key-0001', consent: true, consent_version: 'supply-consent-v1' }),
    }));
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'account_frozen' });
    assert.ok(!calls.some((c) => c.url.includes('api.stripe.com')), 'no checkout');
});

test('top-ups accepts only the approved Supply Consent version, before any DB call', async () => {
    for (const consent_version of [undefined, '', '2026-09-13', 'supply-consent-v2', 'SUPPLY-CONSENT-V1', ['supply-consent-v1']]) {
        const calls = stubFetch([]);
        const res = await topUps.POST(new Request('https://veyrnox.test/api/v1/top-ups', {
            method: 'POST',
            headers: { 'x-veyrnox-auth-id': '11111111-1111-4111-8111-111111111111', 'content-type': 'application/json' },
            body: JSON.stringify({ pack_id: 'web-300', idempotency_key: 'topup-key-0001', consent: true, consent_version }),
        }));
        assert.equal(res.status, 400, String(consent_version));
        assert.deepEqual(await res.json(), { error: 'consent_version_required' });
        assert.equal(calls.length, 0, 'no Top-up created');
    }
});
