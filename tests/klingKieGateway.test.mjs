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
const SOURCE = `uploads/${AUTH}/33333333-3333-4333-8333-333333333333.png`;
const TASK = 'kling-test-task';
const model = { id: 'kling-3.0-i2v-kie', provider: 'kie', provider_endpoint: 'market:kling-3.0/video', modality: 'image-to-video', credits_5s: 28, active: true, gated_flag: false };
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
            if (u.pathname.endsWith('/recordInfo')) return Response.json({ code: 200, data: { state: outcome, failCode: '500', resultJson: JSON.stringify({ resultUrls: ['https://tempfile.aiquickdraw.com/test.mp4'] }) } });
        }
        if (u.hostname.endsWith('.r2.cloudflarestorage.com')) {
            if (init.method === 'PUT') return new Response(null, { status: 200 });
            return new Response(png, { status: 206, headers: { 'content-type': 'image/png', 'content-range': `bytes 0-${png.length - 1}/${png.length}` } });
        }
        if (u.hostname === 'tempfile.aiquickdraw.com') return new Response('video-fixture', { status: copyFails ? 503 : 200, headers: { 'content-type': 'video/mp4' } });
        throw new Error(`Unexpected test request: ${u.hostname}${u.pathname}`);
    };
    return { calls, job, restore: () => { globalThis.fetch = real; } };
}
function post(extra = {}) {
    return generations.POST(new Request('https://veyrnox.test/api/v1/generations', {
        method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH, 'content-type': 'application/json' },
        body: JSON.stringify({ model_id: model.id, idempotency_key: 'kling-gateway-test', source_key: SOURCE, consent: true, inputs: { prompt: 'Move slowly', duration_seconds: 10 }, ...extra }),
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

test('Kling 10s gateway bills two units, signs its owned image and completes via verified callback', async () => {
    const net = network();
    try {
        assert.equal((await post({ inputs: { prompt: 'Move slowly', duration_seconds: 10, image_url: 'https://attacker.example/start.png' } })).status, 200);
        assert.equal(rpcCalls(net, 'ledger_debit')[0].body.p_credits, 56);
        const input = net.calls.find(c => c.url.endsWith('/createTask')).body.input;
        assert.equal(input.duration, '10'); assert.equal(input.mode, 'pro'); assert.equal(input.sound, false);
        assert.equal(input.image_urls.length, 1);
        assert.match(input.image_urls[0], /^https:\/\/test\.r2\.cloudflarestorage\.com\//);
        assert.ok(!JSON.stringify(rpcCalls(net, 'ledger_debit')[0].body.p_inputs).includes('X-Amz-Signature'));
        assert.equal((await callback()).status, 200); assert.equal(net.job.state, 'STORED');
        assert.ok(net.calls.some(c => c.method === 'PUT' && c.url.includes('r2.cloudflarestorage.com')));
        assert.ok(!net.calls.some(c => c.url.includes('attacker.example')));
        await callback(); assert.equal(rpcCalls(net, 'job_stored').length, 1); assert.equal(rpcCalls(net, 'ledger_refund').length, 0);
    } finally { net.restore(); }
});

test('Kling rejected submit refunds the full 10s debit', async () => {
    const net = network({ submitFails: true });
    try { assert.equal((await post()).status, 502); assert.equal(net.job.state, 'REFUNDED'); assert.equal(rpcCalls(net, 'ledger_refund')[0].body.p_credits, 56); }
    finally { net.restore(); }
});

test('Kling authenticated provider failure refunds once despite a forged success callback', async () => {
    const net = network({ outcome: 'fail' });
    try {
        await post(); assert.equal((await callback()).status, 200); await callback();
        assert.equal(net.job.state, 'REFUNDED'); assert.equal(rpcCalls(net, 'ledger_refund').length, 1);
        assert.equal(rpcCalls(net, 'ledger_refund')[0].body.p_credits, 56);
        assert.ok(!net.calls.some(c => c.method === 'PUT'));
    } finally { net.restore(); }
});

test('Kling copy failure remains retryable without claiming storage or refund', async () => {
    const net = network({ copyFails: true });
    try {
        await post(); assert.equal((await callback()).status, 500);
        assert.equal(net.job.state, 'SUCCEEDED'); assert.equal(rpcCalls(net, 'job_stored').length, 0);
        assert.equal(rpcCalls(net, 'ledger_refund').length, 0);
    } finally { net.restore(); }
});

test('Kling inactive, missing/foreign source, second image and unsupported duration never debit', async () => {
    for (const [options, extra] of [
        [{ active: false }, {}], [{}, { source_key: undefined }],
        [{}, { source_key: SOURCE.replace(AUTH, JOB) }],
        [{}, { source_keys: [SOURCE, SOURCE.replace('33333333', '44444444')] }],
        [{}, { inputs: { prompt: 'p', duration_seconds: 15 } }],
        [{}, { inputs: { prompt: 'p', endImage_url: 'https://attacker.example/end.png' } }],
    ]) {
        const net = network(options);
        try { assert.ok((await post(extra)).status >= 400); assert.equal(rpcCalls(net, 'ledger_debit').length, 0); assert.ok(!net.calls.some(c => c.url.includes('api.kie.ai'))); }
        finally { net.restore(); }
    }
});
