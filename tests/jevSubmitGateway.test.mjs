import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// The real generations route and kie adapter on a fake network (same harness
// as fluxKieGateway.test.mjs): a kie submit refusal, classified or not by Jev.
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
    KIE_API_KEY: 'test-kie', KIE_WEBHOOK_HMAC_KEY: 'test-hmac', PUBLIC_HOST: 'https://veyrnox.test',
    TYPESAFE_API_KEY: 'test-jev',
});
const generations = await import('../app/api/v1/generations/route.js');
const AUTH = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const model = { id: 'flux-2-pro-1k-kie', provider: 'kie', provider_endpoint: 'market:flux-2/pro-text-to-image', modality: 'text-to-image', credits_5s: 2, active: true, gated_flag: false };

function network({ jev }) {
    const calls = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        const u = new URL(String(url));
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
        calls.push({ url: u.href, body });
        if (u.pathname.includes('/rpc/')) {
            if (u.pathname.endsWith('/ledger_debit')) return Response.json({ ok: true, job_id: JOB, idempotent: false, balance_after: 100 });
            return Response.json({ ok: true });
        }
        if (u.pathname === '/rest/v1/model_catalog') return Response.json([model]);
        if (u.pathname === '/rest/v1/users') return Response.json([{ id: AUTH }]);
        if (u.hostname === 'api.kie.ai') return Response.json({ code: 400, msg: 'Your prompt was flagged as sensitive' });
        if (u.hostname === 'api.typesafe.ai') return jev();
        throw new Error(`Unexpected test request: ${u.hostname}${u.pathname}`);
    };
    return { calls, restore: () => { globalThis.fetch = real; } };
}
const answer = (choice, p) => () => Response.json({ answers: { cause: { type: 'choice', choice, probabilities: { [choice]: p }, confidence: p } } });

function post() {
    return generations.POST(new Request('https://veyrnox.test/api/v1/generations', {
        method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH, 'content-type': 'application/json' },
        body: JSON.stringify({ model_id: model.id, idempotency_key: 'jev-gateway-test', inputs: { prompt: 'A teapot', duration_seconds: 5 } }),
    }));
}
const rpc = (net, name) => net.calls.filter(c => c.url.includes(`/rpc/${name}`));
async function quietly(fn) {
    const errors = console.error;
    console.error = () => {};
    try { return await fn(); } finally { console.error = errors; }
}

test('enforce: a refusal Jev calls content_policy answers 422 provider_moderation and still refunds', async () => {
    process.env.JEV_SUBMIT_ERRORS_MODE = 'enforce';
    const net = network({ jev: answer('content_policy', 0.97) });
    try {
        const res = await quietly(post);
        assert.equal(res.status, 422);
        assert.deepEqual(await res.json(), { error: 'provider_moderation' });
        assert.equal(rpc(net, 'job_submit_rejected')[0].body.p_error_code, 'provider_moderation');
        assert.deepEqual(rpc(net, 'ledger_refund')[0].body, { p_job_id: JOB, p_user_id: AUTH, p_credits: 2, p_reason: 'refund:submit_failed' });
        // Jev saw kie's answer, not the user's prompt field.
        const sent = net.calls.find(c => c.url.startsWith('https://api.typesafe.ai')).body.state;
        assert.match(sent, /^kie 200\/400: Your prompt was flagged as sensitive$/);
    } finally { net.restore(); delete process.env.JEV_SUBMIT_ERRORS_MODE; }
});

test('enforce: a Jev outage keeps 502 provider_submit_failed and the same refund', async () => {
    process.env.JEV_SUBMIT_ERRORS_MODE = 'enforce';
    const net = network({ jev: () => new Response('overloaded', { status: 529 }) });
    try {
        const res = await quietly(post);
        assert.equal(res.status, 502);
        assert.deepEqual(await res.json(), { error: 'provider_submit_failed' });
        assert.equal(rpc(net, 'job_submit_rejected')[0].body.p_error_code, 'provider_submit_failed');
        assert.equal(rpc(net, 'ledger_refund').length, 1);
    } finally { net.restore(); delete process.env.JEV_SUBMIT_ERRORS_MODE; }
});

test('off (the shipped default): Jev is never called and the route behaves as before', async () => {
    const net = network({ jev: () => { throw new Error('must not be called'); } });
    try {
        const res = await quietly(post);
        assert.equal(res.status, 502);
        assert.ok(!net.calls.some(c => c.url.startsWith('https://api.typesafe.ai')));
        assert.equal(rpc(net, 'ledger_refund').length, 1);
    } finally { net.restore(); }
});
