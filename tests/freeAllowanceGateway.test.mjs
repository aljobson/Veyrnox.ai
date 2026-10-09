import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// The real generations route on a fake network (same harness as jevSubmitGateway.test.mjs): the free-allowance
// path of ADR-0069. The database half is covered by scripts/test-free-allowance-jobs.mjs.
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
    KIE_API_KEY: 'test-kie', KIE_WEBHOOK_HMAC_KEY: 'test-hmac', PUBLIC_HOST: 'https://veyrnox.test',
});
const generations = await import('../app/api/v1/generations/route.js');
const AUTH = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const TASK = 'task_free_allowance';
const baseModel = { id: 'flux-2-pro-1k-kie', provider: 'kie', provider_endpoint: 'market:flux-2/pro-text-to-image', modality: 'text-to-image', credits_5s: 2, active: true, gated_flag: false };

/** `rpcs` maps an RPC name to its answer; `kieFails` makes the provider refuse the job. */
function network({ model = baseModel, rpcs = {}, kieFails = false } = {}) {
    const calls = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        const u = new URL(String(url));
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
        calls.push({ url: u.href, search: u.search, body });
        if (u.pathname.includes('/rpc/')) {
            const name = u.pathname.split('/rpc/')[1];
            if (name in rpcs) return Response.json(typeof rpcs[name] === 'function' ? rpcs[name](body) : rpcs[name]);
            if (name === 'ledger_debit') return Response.json({ ok: true, job_id: JOB, idempotent: false, balance_after: 100 });
            if (name === 'read_user_credits') return Response.json({ balance: 42 });
            return Response.json({ ok: true });
        }
        if (u.pathname === '/rest/v1/model_catalog') return Response.json([model]);
        if (u.pathname === '/rest/v1/users') return Response.json([{ id: AUTH }]);
        if (u.hostname === 'api.kie.ai') return Response.json(kieFails ? { code: 500, msg: 'rejected' } : { code: 200, data: { taskId: TASK } });
        throw new Error(`Unexpected test request: ${u.hostname}${u.pathname}`);
    };
    return { calls, restore: () => { globalThis.fetch = real; } };
}
const post = (key = 'free-allowance-gateway') => generations.POST(new Request('https://veyrnox.test/api/v1/generations', {
    method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({ model_id: baseModel.id, idempotency_key: key, inputs: { prompt: 'A teapot', duration_seconds: 5 } }),
}));
const rpc = (net, name) => net.calls.filter(c => c.url.includes(`/rpc/${name}`));
async function quietly(fn) {
    const errors = console.error; console.error = () => {};
    try { return await fn(); } finally { console.error = errors; }
}
const withFlag = async (value, fn) => {
    const before = process.env.FREE_ALLOWANCE_ENABLED;
    if (value === undefined) delete process.env.FREE_ALLOWANCE_ENABLED; else process.env.FREE_ALLOWANCE_ENABLED = value;
    try { return await fn(); } finally { if (before === undefined) delete process.env.FREE_ALLOWANCE_ENABLED; else process.env.FREE_ALLOWANCE_ENABLED = before; }
};
const offered = { ...baseModel, free_allowance_per_day: 3 };

test('flag off: the allowance column is never requested and the paid debit runs, even if a model offers one', () => withFlag(undefined, async () => {
    const net = network({ model: offered });
    try {
        const res = await post();
        assert.equal(res.status, 200);
        const catalog = net.calls.find(c => c.url.includes('/rest/v1/model_catalog'));
        assert.ok(!catalog.search.includes('free_allowance_per_day'), 'a Worker before 0205 must not query the column');
        assert.equal(rpc(net, 'ledger_debit').length, 1);
        assert.equal(rpc(net, 'submit_free_job').length, 0);
        assert.equal((await res.json()).free_allowance, undefined);
    } finally { net.restore(); }
}));

test('flag on, model without an allowance: paid debit, no free call', () => withFlag('true', async () => {
    const net = network({ model: { ...baseModel, free_allowance_per_day: 0 } });
    try {
        const res = await post();
        assert.equal(res.status, 200);
        assert.equal(rpc(net, 'submit_free_job').length, 0);
        assert.equal(rpc(net, 'ledger_debit')[0].body.p_credits, 2);
    } finally { net.restore(); }
}));

test('flag on, allowance taken: no ledger_debit, a 0-credit job, balance returned, marked free', () => withFlag('true', async () => {
    const net = network({ model: offered, rpcs: { submit_free_job: { ok: true, taken: true, job_id: JOB, idempotent: false, left: 2 } } });
    try {
        const res = await post();
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { job_id: JOB, state: 'SUBMITTED', balance_after: 42, free_allowance: true });
        assert.equal(rpc(net, 'ledger_debit').length, 0);
        const sent = rpc(net, 'submit_free_job')[0].body;
        assert.deepEqual([sent.p_user_id, sent.p_idempotency_key, sent.p_model_id], [AUTH, 'free-allowance-gateway', baseModel.id]);
        assert.equal(sent.p_limit_per_window, 10);
    } finally { net.restore(); }
}));

test('flag on, allowance used up: falls through to the paid debit at the catalog price', () => withFlag('true', async () => {
    const net = network({ model: offered, rpcs: { submit_free_job: { ok: true, taken: false, code: 'ALLOWANCE_USED' } } });
    try {
        const res = await post();
        assert.equal(res.status, 200);
        assert.equal(rpc(net, 'ledger_debit')[0].body.p_credits, 2);
        assert.equal((await res.json()).free_allowance, undefined);
    } finally { net.restore(); }
}));

test('flag on, the free call fails: the paid debit runs (it finds an already-created free job by key)', () => withFlag('true', async () => {
    const net = network({ model: offered, rpcs: {} });
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        if (String(url).includes('/rpc/submit_free_job')) throw new Error('network down');
        return real(url, init);
    };
    try {
        const res = await quietly(post);
        assert.equal(res.status, 200);
        assert.equal(rpc(net, 'ledger_debit').length, 1);
    } finally { net.restore(); }
}));

test('flag on: a rate limit or Frozen refusal from the free path is answered exactly like the paid one', () => withFlag('true', async () => {
    let net = network({ model: offered, rpcs: { submit_free_job: { ok: false, code: 'RATE_LIMITED', count: 10, limit: 10, retry_after_seconds: 7 } } });
    try {
        const res = await post();
        assert.equal(res.status, 429);
        assert.equal(res.headers.get('retry-after'), '7');
        assert.equal(rpc(net, 'ledger_debit').length, 0);
    } finally { net.restore(); }
    net = network({ model: offered, rpcs: { submit_free_job: { ok: false, code: 'ACCOUNT_FROZEN' } } });
    try {
        const res = await post();
        assert.equal(res.status, 403);
        assert.deepEqual(await res.json(), { error: 'account_frozen' });
        assert.equal(rpc(net, 'ledger_debit').length, 0);
    } finally { net.restore(); }
}));

test('a provider refusal on a free job refunds 0 Credits, which returns the allowance', () => withFlag('true', async () => {
    const net = network({ model: offered, kieFails: true, rpcs: { submit_free_job: { ok: true, taken: true, job_id: JOB, idempotent: false } } });
    try {
        const res = await quietly(post);
        assert.equal(res.status, 502);
        assert.deepEqual(rpc(net, 'ledger_refund')[0].body, { p_job_id: JOB, p_user_id: AUTH, p_credits: 0, p_reason: 'refund:submit_failed' });
    } finally { net.restore(); }
}));

test('a replay of a free job returns it without touching the provider again', () => withFlag('true', async () => {
    const net = network({ model: offered, rpcs: { submit_free_job: { ok: true, taken: true, job_id: JOB, idempotent: true } } });
    try {
        const res = await post();
        assert.deepEqual(await res.json(), { job_id: JOB, idempotent: true, balance_after: 42 });
        assert.ok(!net.calls.some(c => c.url.includes('api.kie.ai')));
    } finally { net.restore(); }
}));

test('paid and free admission pauses return retryable 503 before any provider call', async () => {
    for (const useFree of [false,true]) await withFlag(useFree ? 'true' : undefined, async () => {
        const name=useFree?'submit_free_job':'ledger_debit';
        const net=network({ model:offered, rpcs:{ [name]:{ ok:false,code:'PROVIDER_ADMISSION_PAUSED',retry_after_seconds:7 } } });
        try {
            const res=await post();assert.equal(res.status,503);
            assert.equal(res.headers.get('retry-after'),'7');
            assert.deepEqual(await res.json(),{ error:'provider_admission_paused' });
            assert.equal(rpc(net,name).length,1);
            if(useFree) assert.equal(rpc(net,'ledger_debit').length,0);
            assert.equal(net.calls.filter(c=>new URL(c.url).hostname==='api.kie.ai').length,0);
        } finally { net.restore(); }
    });
});
