import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
    GRSAI_API_KEY: 'test-grsai', PUBLIC_HOST: 'https://veyrnox.test',
    R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test-access', R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET: 'test',
});
const { POST } = await import('../app/api/v1/generations/route.js');
const { sweepGrsai } = await import('../lib/grsaiSweep.js');
const AUTH = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const SOURCE = `uploads/${AUTH}/33333333-3333-4333-8333-333333333333.png`;
const model = { id: 'nano-banana-pro-edit-grsai', provider: 'grsai', provider_endpoint: 'grsai:nano-banana-pro-edit', modality: 'image-to-image', credits_5s: 2, active: true, gated_flag: false };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZQAAAABJRU5ErkJggg==', 'base64');
const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'test-service' };
const r2cfg = { accountId: 'test', accessKeyId: 'test-access', secretAccessKey: 'test-secret', bucket: 'test' };
const sweep = () => sweepGrsai({ cfg, r2cfg, apiKey: 'test-grsai' });

// Real gateway, adapter, sweep, completion and R2 signing; simulated network.
function network({ active = true, submitFails = false, outcome = 'succeeded', copyFails = false } = {}) {
    const calls = []; let processed = false, inserted = false, debited = false;
    const job = { id: JOB, user_id: AUTH, state: 'DEBITED', credits: 2, provider_job_id: 'edit-task', created_at: new Date().toISOString() };
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        const u = new URL(String(url));
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
        calls.push({ url: u.href, method: init.method, body });
        if (u.pathname.includes('/rpc/')) {
            const name = u.pathname.split('/rpc/')[1];
            if (name === 'ledger_debit') { const replay = debited; debited = true; return Response.json({ ok: true, job_id: JOB, idempotent: replay, balance_after: 98 }); }
            if (name === 'job_submitted') job.state = 'SUBMITTED';
            if (name === 'job_succeeded') job.state = 'SUCCEEDED';
            if (name === 'job_stored') job.state = 'STORED';
            if (name === 'job_failed') job.state = 'FAILED';
            if (name === 'ledger_refund') job.state = 'REFUNDED';
            return Response.json({ ok: true });
        }
        if (u.pathname === '/rest/v1/model_catalog') return Response.json([{ ...model, active }]);
        if (u.pathname === '/rest/v1/users') return Response.json([{ id: AUTH }]);
        if (u.pathname === '/rest/v1/jobs') return Response.json(['SUBMITTED', 'SUCCEEDED', 'FAILED'].includes(job.state) ? [job] : []);
        if (u.pathname === '/rest/v1/webhook_events') {
            if (init.method === 'POST') { const rows = inserted ? [] : [{ id: 'event' }]; inserted = true; return Response.json(rows, { status: 201 }); }
            if (init.method === 'PATCH') { processed = true; return new Response(null, { status: 204 }); }
            return Response.json([{ processed_at: processed ? 'done' : null }]);
        }
        if (u.hostname === 'grsaiapi.com') {
            if (u.pathname.endsWith('/nano-banana')) return Response.json(submitFails ? { code: -1 } : { code: 0, data: { id: 'edit-task' } });
            if (u.pathname.endsWith('/result')) return Response.json({ code: 0, data: { id: 'edit-task', status: outcome, failure_reason: 'input_moderation', results: [{ url: 'https://file6.aitohumanize.com/edit.png' }] } });
        }
        if (u.hostname.endsWith('.r2.cloudflarestorage.com')) {
            if (init.method === 'PUT') return new Response(null, { status: 200 });
            return new Response(png, { status: 206, headers: { 'content-type': 'image/png', 'content-range': `bytes 0-${png.length - 1}/${png.length}` } });
        }
        if (u.hostname === 'file6.aitohumanize.com') return new Response(png, { status: copyFails ? 503 : 200, headers: { 'content-type': 'image/png' } });
        throw new Error(`Unexpected request: ${u.hostname}${u.pathname}`);
    };
    return { calls, job, recoverStorage: () => { copyFails = false; }, restore: () => { globalThis.fetch = real; } };
}
const rpcCalls = (net, name) => net.calls.filter(c => c.url.includes(`/rpc/${name}`));
const submits = net => net.calls.filter(c => c.url.endsWith('/draw/nano-banana'));
function post(extra = {}) {
    return POST(new Request('https://veyrnox.test/api/v1/generations', {
        method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH, 'content-type': 'application/json' },
        body: JSON.stringify({ model_id: model.id, idempotency_key: 'grsai-edit-test', consent: true, source_key: SOURCE,
            inputs: { prompt: 'Make the teapot blue', seed: 10, image_url: 'https://attacker.example/input.png' }, ...extra }),
    }));
}

test('owned edit bills two credits, drops client URL/seed, stores source key and completes through polling', async () => {
    const net = network();
    try {
        assert.equal((await post()).status, 200);
        const debit = rpcCalls(net, 'ledger_debit')[0].body;
        assert.equal(debit.p_credits, 2);
        assert.deepEqual(debit.p_inputs.source_keys, { image_url: SOURCE });
        assert.equal(debit.p_inputs.image_url, undefined);
        assert.equal(debit.p_inputs.seed, undefined);
        const input = submits(net)[0].body;
        assert.equal(input.imageSize, '2K');
        assert.equal(input.aspectRatio, 'auto');
        assert.equal(input.urls.length, 1);
        const source = new URL(input.urls[0]);
        assert.equal(source.hostname, 'test.r2.cloudflarestorage.com');
        assert.equal(source.searchParams.get('X-Amz-Expires'), '900');
        assert.equal(input.seed, undefined);
        assert.equal((await (await post()).json()).idempotent, true);
        assert.equal(submits(net).length, 1);
        assert.equal((await sweep()).applied, 1);
        assert.equal(net.job.state, 'STORED');
        await sweep();
        assert.equal(rpcCalls(net, 'job_stored').length, 1);
        assert.equal(rpcCalls(net, 'ledger_refund').length, 0);
        assert.ok(!net.calls.some(c => c.url.includes('attacker.example')));
    } finally { net.restore(); }
});

test('invalid ownership, absent source, duplicate images and missing consent never debit or submit', async () => {
    for (const [extra, expected] of [
        [{ source_key: SOURCE.replace(AUTH, JOB) }, 'source_not_found'],
        [{ source_key: undefined }, 'inputs_invalid:image_url'],
        [{ consent: false }, 'consent_required'],
        [{ source_keys: [SOURCE, SOURCE] }, 'source_key_invalid'],
        [{ inputs: { prompt: 'p', imageSize: '4K' } }, 'inputs_key_not_allowed:imageSize'],
    ]) {
        const net = network();
        try {
            const res = await post(extra);
            assert.ok(res.status >= 400);
            assert.equal((await res.json()).error, expected);
            assert.equal(rpcCalls(net, 'ledger_debit').length, 0);
            assert.equal(submits(net).length, 0);
        } finally { net.restore(); }
    }
});

test('inactive edit cannot debit or submit', async () => {
    const net = network({ active: false });
    try {
        assert.equal((await post()).status, 404);
        assert.equal(rpcCalls(net, 'ledger_debit').length, 0);
        assert.equal(submits(net).length, 0);
    } finally { net.restore(); }
});

test('rejected submission and polled provider failure each refund the original two-credit debit', async () => {
    for (const options of [{ submitFails: true }, { outcome: 'failed' }]) {
        const net = network(options);
        try {
            assert.equal((await post()).status, options.submitFails ? 502 : 200);
            if (!options.submitFails) { await sweep(); await sweep(); }
            assert.equal(net.job.state, 'REFUNDED');
            assert.equal(rpcCalls(net, 'ledger_refund').length, 1);
            assert.equal(rpcCalls(net, 'ledger_refund')[0].body.p_credits, 2);
            assert.equal(submits(net).length, 1);
        } finally { net.restore(); }
    }
});

test('transient storage failure retries completion without buying another edit', async () => {
    const net = network({ copyFails: true });
    try {
        await post();
        assert.equal((await sweep()).errors, 1);
        assert.equal(net.job.state, 'SUCCEEDED');
        assert.equal(rpcCalls(net, 'job_stored').length, 0);
        net.recoverStorage();
        assert.equal((await sweep()).applied, 1);
        assert.equal(net.job.state, 'STORED');
        assert.equal(submits(net).length, 1);
        assert.equal(rpcCalls(net, 'ledger_refund').length, 0);
    } finally { net.restore(); }
});
