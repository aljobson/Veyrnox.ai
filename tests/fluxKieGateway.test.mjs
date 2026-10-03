import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
    KIE_API_KEY: 'test-kie', KIE_WEBHOOK_HMAC_KEY: 'test-hmac', PUBLIC_HOST: 'https://veyrnox.test',
    R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test-access', R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET: 'test',
});
const generations = await import('../app/api/v1/generations/route.js');
const webhook = await import('../app/api/webhook/kie/route.js');
const AUTH = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const TASK = 'flux-test-task';
const model = { id: 'flux-2-pro-1k-kie', provider: 'kie', provider_endpoint: 'market:flux-2/pro-text-to-image', modality: 'text-to-image', credits_5s: 2, active: true, gated_flag: false };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZQAAAABJRU5ErkJggg==', 'base64');

// Real route handlers/adapters, isolated fake network; no external credentials or spend.
function network({ active = true, submitFails = false, outcome = 'success', copyFails = false } = {}) {
    const calls = []; let processed = false; let inserted = false;
    const job = { id: JOB, user_id: AUTH, state: 'DEBITED', credits: 0, provider_endpoint: model.provider_endpoint };
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        const u = new URL(String(url));
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
        calls.push({ url: u.href, method: init.method, body });
        if (u.pathname.includes('/rpc/')) {
            const name = u.pathname.split('/rpc/')[1];
            if (name === 'ledger_debit') { job.credits = body.p_credits; return Response.json({ ok: true, job_id: JOB, idempotent: false, balance_after: 100 }); }
            if (name === 'job_submitted') job.state = 'SUBMITTED';
            if (name === 'job_succeeded') job.state = 'SUCCEEDED';
            if (name === 'job_stored') job.state = 'STORED';
            if (name === 'ledger_refund') job.state = 'REFUNDED';
            return Response.json({ ok: true });
        }
        if (u.pathname === '/rest/v1/model_catalog') return Response.json([{ ...model, active }]);
        if (u.pathname === '/rest/v1/users') return Response.json([{ id: AUTH }]);
        if (u.pathname === '/rest/v1/jobs') return Response.json([job]);
        if (u.pathname === '/rest/v1/webhook_events') {
            if (init.method === 'POST') { const rows = inserted ? [] : [{ id: 'event' }]; inserted = true; return Response.json(rows, { status: 201 }); }
            if (init.method === 'PATCH') { processed = true; return new Response(null, { status: 204 }); }
            return Response.json([{ processed_at: processed ? 'done' : null }]);
        }
        if (u.hostname === 'api.kie.ai') {
            if (u.pathname.endsWith('/createTask')) return Response.json(submitFails ? { code: 500, msg: 'rejected' } : { code: 200, data: { taskId: TASK } });
            if (u.pathname.endsWith('/recordInfo')) return Response.json({ code: 200, data: { state: outcome, failCode: '500', resultJson: JSON.stringify({ resultUrls: ['https://tempfile.aiquickdraw.com/test.jpg'] }) } });
        }
        if (u.hostname.endsWith('.r2.cloudflarestorage.com')) {
            if (init.method === 'PUT') return new Response(null, { status: 200 });
            return new Response(png, { status: 206, headers: { 'content-type': 'image/png', 'content-range': `bytes 0-${png.length - 1}/${png.length}` } });
        }
        if (u.hostname === 'tempfile.aiquickdraw.com') return new Response(png, { status: copyFails ? 503 : 200, headers: { 'content-type': 'image/png' } });
        throw new Error(`Unexpected test request: ${u.hostname}${u.pathname}`);
    };
    return { calls, job, restore: () => { globalThis.fetch = real; } };
}
function post(extra = {}) {
    return generations.POST(new Request('https://veyrnox.test/api/v1/generations', {
        method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH, 'content-type': 'application/json' },
        body: JSON.stringify({ model_id: model.id, idempotency_key: 'flux-gateway-test', inputs: { prompt: 'Ceramic teapot on linen', duration_seconds: 5 }, ...extra }),
    }));
}
async function callback() {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('test-hmac'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${TASK}.${timestamp}`))).toString('base64');
    return webhook.POST(new Request('https://veyrnox.test/api/webhook/kie', {
        method: 'POST', headers: { 'x-webhook-signature': signature, 'x-webhook-timestamp': timestamp },
        // Forged callback outcome must be ignored in favor of authenticated recordInfo.
        body: JSON.stringify({ data: { taskId: TASK, state: 'success', resultJson: JSON.stringify({ resultUrls: ['https://attacker.example/forged.mp4'] }) } }),
    }));
}
const rpcCalls = (net, name) => net.calls.filter(c => c.url.includes(`/rpc/${name}`));

test('Flux bills two credits, pins 1K, stores output and ignores duplicate callbacks', async () => {
    const net = network();
    try {
        assert.equal((await post()).status, 200);
        assert.equal(rpcCalls(net, 'ledger_debit')[0].body.p_credits, 2);
        const input = net.calls.find(c => c.url.endsWith('/createTask')).body.input;
        assert.equal(input.resolution, '1K');
        assert.equal(input.nsfw_checker, true);
        assert.equal((await callback()).status, 200);
        assert.equal(net.job.state, 'STORED');
        await callback();
        assert.equal(rpcCalls(net, 'job_stored').length, 1);
        assert.equal(rpcCalls(net, 'ledger_refund').length, 0);
        assert.ok(!net.calls.some(c => c.url.includes('attacker.example')));
    } finally { net.restore(); }
});

test('Flux rejected submission refunds its two-credit debit', async () => {
    const net = network({ submitFails: true });
    try {
        assert.equal((await post()).status, 502);
        assert.equal(net.job.state, 'REFUNDED');
        assert.equal(rpcCalls(net, 'ledger_refund')[0].body.p_credits, 2);
    } finally { net.restore(); }
});

test('Flux authenticated failure refunds once despite forged success and callback replay', async () => {
    const net = network({ outcome: 'fail' });
    try {
        await post(); await callback(); await callback();
        assert.equal(net.job.state, 'REFUNDED');
        assert.equal(rpcCalls(net, 'ledger_refund').length, 1);
        assert.equal(rpcCalls(net, 'ledger_refund')[0].body.p_credits, 2);
        assert.ok(!net.calls.some(c => c.method === 'PUT'));
    } finally { net.restore(); }
});

test('Flux storage failure stays retryable without a false completion or refund', async () => {
    const net = network({ copyFails: true });
    try {
        await post(); assert.equal((await callback()).status, 500);
        assert.equal(net.job.state, 'SUCCEEDED');
        assert.equal(rpcCalls(net, 'job_stored').length, 0);
        assert.equal(rpcCalls(net, 'ledger_refund').length, 0);
    } finally { net.restore(); }
});

test('Inactive Flux cannot debit or submit upstream', async () => {
    const net = network({ active: false });
    try {
        assert.ok((await post()).status >= 400);
        assert.equal(rpcCalls(net, 'ledger_debit').length, 0);
        assert.ok(!net.calls.some(c => c.url.includes('api.kie.ai')));
    } finally { net.restore(); }
});
