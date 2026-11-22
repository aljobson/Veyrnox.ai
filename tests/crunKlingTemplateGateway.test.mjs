import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// The real generations route and Crun adapter on a fake network: no key, no spend.
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', PUBLIC_HOST: 'https://veyrnox.test',
    CRUN_ENABLED: 'true', CRUN_API_KEY: 'test-crun',
    R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test-access', R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET: 'test',
});
const generations = await import('../app/api/v1/generations/route.js');
const { ALL_TEMPLATES } = await import('../app/veyrnox/_lib/templates.js');
const { templateContract } = await import('../lib/templateContract.js');
const { checkTemplateRequest } = await import('../lib/templateFidelity.js');

const AUTH = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const SOURCE = `uploads/${AUTH}/33333333-3333-4333-8333-333333333333.png`;
const model = { id: 'kling-3.0-i2v', provider: 'crun', provider_endpoint: 'crun:kling/v3', modality: 'image-to-video', credits_5s: 32, active: true, gated_flag: false };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZQAAAABJRU5ErkJggg==', 'base64');
const runnable = t => t.model === 'Kling 3.0 · I2V' && !templateContract(t.id) && t.prompt.length <= 2000
    && checkTemplateRequest({ model_id: model.id, preset: t.id, inputs: { prompt: t.prompt } }).ok;
const withNegative = ALL_TEMPLATES.find(t => runnable(t) && t.negativePrompt?.trim());

function network({ idempotent = false } = {}) {
    const calls = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        const u = new URL(String(url));
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
        calls.push({ url: u.href, body });
        if (u.pathname.endsWith('/rpc/ledger_debit')) return Response.json({ ok: true, job_id: JOB, idempotent, balance_after: 100 });
        if (u.pathname.includes('/rpc/')) return Response.json({ ok: true });
        if (u.pathname === '/rest/v1/model_catalog') return Response.json([model]);
        if (u.pathname === '/rest/v1/users') return Response.json([{ id: AUTH }]);
        if (u.hostname === 'api.crun.ai') return Response.json({ code: 200, data: { task_id: 'crun-task-1' } });
        if (u.hostname.endsWith('.r2.cloudflarestorage.com')) {
            return new Response(png, { status: 206, headers: { 'content-type': 'image/png', 'content-range': `bytes 0-${png.length - 1}/${png.length}` } });
        }
        throw new Error(`Unexpected test request: ${u.hostname}${u.pathname}`);
    };
    return { calls, restore: () => { globalThis.fetch = real; } };
}
const post = (inputs, extra = {}) => generations.POST(new Request('https://veyrnox.test/api/v1/generations', {
    method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({ model_id: model.id, idempotency_key: 'crun-template-test', source_key: SOURCE, consent: true, preset: withNegative.id, inputs: { prompt: withNegative.prompt, duration_seconds: 10, ...inputs }, ...extra }),
}));
const debit = net => net.calls.find(c => c.url.includes('/rpc/ledger_debit'))?.body;
const crun = net => net.calls.filter(c => new URL(c.url).hostname === 'api.crun.ai');

for (const [name, inputs] of [['sends none', {}], ['still sends the template\'s own', { negative_prompt: withNegative?.negativePrompt }]]) {
    test(`a template whose client ${name} runs on Crun, charged in full, with no negative prompt stored or sent`, async () => {
        const net = network();
        try {
            const res = await post(inputs);
            assert.equal(res.status, 200);
            assert.equal(debit(net).p_credits, 64, 'two 5 s units at the unchanged price');
            assert.equal(Object.hasOwn(debit(net).p_inputs, 'negative_prompt'), false, 'the job row records what was sent');
            assert.equal(crun(net).length, 1);
            assert.equal(Object.hasOwn(crun(net)[0].body.input, 'negative_prompt'), false);
            assert.equal(crun(net)[0].body.input.prompt, withNegative.prompt.trim());
        } finally { net.restore(); }
    });
}

test('a replay of the same key returns the first job, with no second supplier task', async () => {
    const net = network({ idempotent: true });
    try {
        const res = await post({ negative_prompt: withNegative.negativePrompt });
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { job_id: JOB, idempotent: true, balance_after: 100 });
        assert.equal(crun(net).length, 0);
    } finally { net.restore(); }
});

test('a customer negative prompt on a template run is refused before any debit or supplier call', async () => {
    for (const inputs of [{ negative_prompt: 'blurry' }, { negative_prompt: withNegative.negativePrompt, prompt: 'A different prompt' }]) {
        const net = network();
        try {
            const res = await post(inputs);
            assert.equal(res.status, 400);
            assert.deepEqual(await res.json(), { error: 'inputs_key_not_allowed:negative_prompt' });
            assert.equal(debit(net), undefined);
            assert.equal(crun(net).length, 0);
        } finally { net.restore(); }
    }
});
