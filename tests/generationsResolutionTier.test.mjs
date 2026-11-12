import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { rpc as realRpc } from '../packages/db/supabase-client.js';
import { takeFreeJob, takeFreeJobDetailed } from '../lib/freeJob.js';
import { mintPlanToken, planIdempotencyKey } from '../lib/montagePlan.js';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
    KIE_API_KEY: 'test-kie', KIE_WEBHOOK_HMAC_KEY: 'test-hmac', FAL_KEY: 'test-fal', PUBLIC_HOST: 'https://veyrnox.test',
    AGENT_VIDEO_ENABLED: 'true', MONTAGE_RUNNER_BASE: 'https://runner.test', MONTAGE_SIGNING_SECRET: 'test-sign', MONTAGE_PLAN_SECRET: 'test-plan',
    R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test', R2_BUCKET: 'test',
});
const { POST } = await import('../app/api/v1/generations/route.js');
const AUTH = '11111111-1111-4111-8111-111111111111', JOB = '22222222-2222-4222-8222-222222222222';
const model = { id: 'flux-2-pro-1k-kie', provider: 'kie', provider_endpoint: 'market:flux-2/pro-text-to-image', modality: 'text-to-image', credits_5s: 7, active: true, gated_flag: false };
const fal = { ...model, id: 'flux-2-pro', provider: 'fal', provider_endpoint: 'fal-ai/flux-2-pro' };
const video = { ...model, id: 'video-agent', provider: 'veyrnox', provider_endpoint: 'video-agent:v1', modality: 'text-to-video' };
const referenceModel = { ...fal, id: 'kling-3.0-i2v', provider_endpoint: 'fal-ai/kling-video/v3/pro/image-to-video', modality: 'image-to-video' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZQAAAABJRU5ErkJggg==', 'base64');
function network(t, { row = model, free = false, reply = { ok: true, taken: false }, existing = false, lookupError = false, durable = false, sqlPrice = 7, maxChargeFlag = 'true', cappedMissing = false } = {}) {
    if (maxChargeFlag === null) delete process.env.MAX_CHARGE_ENABLED;
    else process.env.MAX_CHARGE_ENABLED = maxChargeFlag;
    process.env.FREE_ALLOWANCE_ENABLED = String(free);
    process.env.FAL_DISPATCH_SCHEMA_ENABLED = String(durable);
    process.env.FAL_DURABLE_DISPATCH_ENABLED = String(durable);
    const calls = [];
    let charged = 0;
    t.mock.method(console, 'error', () => {});
    t.mock.method(globalThis, 'fetch', async (target, init = {}) => {
        const url = new URL(String(target)), body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
        const name = url.pathname.split('/').at(-1);
        calls.push({ name, body, url });
        if (url.pathname === '/rest/v1/model_catalog') return Response.json([{ ...row, free_allowance_per_day: free ? 3 : 0 }]);
        if (url.pathname === '/rest/v1/users') return Response.json([{ id: AUTH }]);
        if (url.pathname === '/rest/v1/jobs') {
            if (lookupError) throw new Error('lookup failed');
            if (url.searchParams.has('idempotency_key')) {
                assert.equal(url.searchParams.get('user_id'), `eq.${AUTH}`);
                return Response.json(existing ? [{ id: JOB }] : []);
            }
            return Response.json([]);
        }
        if (url.hostname === 'runner.test') return Response.json({ busy: false, ok: true });
        if (url.hostname.endsWith('.r2.cloudflarestorage.com')) return new Response(png, { status: 206, headers: { 'content-type': 'image/png', 'content-range': `bytes 0-${png.length - 1}/${png.length}` } });
        if (url.pathname.includes('/rpc/')) {
            if (name === 'submit_free_job') {
                if (reply === 'throw') throw new Error('lost acknowledgement');
                if (reply === 'unreadable') return new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } });
                return Response.json(reply);
            }
            if (name === 'admit_fal_dispatch_capped') {
                if (cappedMissing) return Response.json({ code: 'PGRST202', message: 'Could not find public.admit_fal_dispatch_capped in the schema cache' }, { status: 404 });
                if (!existing && !(free && reply?.taken) && sqlPrice > body.p_max_charge) return Response.json({ ok: false, code: 'PRICE_EXCEEDS_CEILING', expected_credits: sqlPrice });
                const taken = free && reply?.taken === true;
                if (!existing && !taken) charged += sqlPrice;
                return Response.json({ ok: true, job_id: JOB, idempotent: existing, free: taken, state: 'DEBITED', balance_after: 42 });
            }
            if (name === 'read_user_credits') return Response.json({ balance: 42 });
            if (name === 'get_user_asset') return Response.json({ ok: true, state: 'STORED', r2_key: `jobs/${JOB}/output.png`, mime_type: 'image/png' });
            if (name === 'admit_fal_dispatch' || name.startsWith('ledger_debit')) {
                if (!existing) charged += name === 'admit_fal_dispatch' ? sqlPrice : body.p_credits;
                return Response.json({ ok: true, job_id: JOB, idempotent: existing, state: 'SUBMITTED', balance_after: 42 });
            }
            return Response.json({ ok: true, claimed: true });
        }
        if (url.hostname === 'api.kie.ai') return Response.json({ code: 200, data: { taskId: 'task-test' } });
        if (url.hostname === 'queue.fal.run') return Response.json({ request_id: 'task-test' });
        throw new Error(`Unexpected request ${url.pathname}`);
    });
    return { calls, get charged() { return charged; }, count: name => calls.filter(c => c.name === name).length };
}
function post(inputs, modelRow) {
    return POST(new Request('https://veyrnox.test/api/v1/generations', { method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH, 'content-type': 'application/json' }, body: JSON.stringify({ model_id: modelRow.id, idempotency_key: 'tier-test-key-1', inputs }) }));
}
const veo = { id: 'veo-3.1-fal', provider: 'fal', provider_endpoint: 'fal-ai/veo3.1', modality: 'text-to-video', credits_5s: 40, active: true, gated_flag: false };
const kling = { ...veo, id: 'kling-2.6-fal', provider_endpoint: 'fal-ai/kling-video/v2.6/pro/text-to-video', credits_5s: 18 };
const debitOf = (n) => n.calls.find(c => /^(ledger_debit|admit_fal_dispatch)/.test(c.name) && c.url.pathname.includes('/rpc/'));
const creditsIn = (call) => call?.body?.p_credits ?? call?.body?.p_expected_credits;
const falBody = (n) => n.calls.find(c => c.url.hostname === 'queue.fal.run')?.body;

for (const [tier, credits, sent] of [[undefined, 40, '720p'], ['720p', 40, '720p'], ['1080p', 40, '1080p'], ['4k', 60, '4k']]) {
    test(`Veo 3.1 at ${tier ?? 'the default tier'} debits ${credits} credits and asks fal for ${sent}`, async (t) => {
        const n = network(t, { row: veo, maxChargeFlag: null, sqlPrice: credits });
        const r = await post({ prompt: 'A paper boat on a lake', ...(tier ? { resolution: tier } : {}) }, veo);
        assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
        assert.equal(creditsIn(debitOf(n)), credits);
        assert.equal(falBody(n)?.resolution, sent);
    });
}

test('a tier the model does not offer is refused before any debit', async (t) => {
    const n = network(t, { row: veo, maxChargeFlag: null });
    const r = await post({ prompt: 'A paper boat on a lake', resolution: '1440p' }, veo);
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error, 'resolution_not_supported');
    assert.equal(debitOf(n), undefined);
});

test('a tier on a model without tiers is dropped: same price, nothing extra sent to the provider', async (t) => {
    const n = network(t, { row: kling, maxChargeFlag: null, sqlPrice: 18 });
    const r = await post({ prompt: 'A paper boat on a lake', resolution: '4k' }, kling);
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
    assert.equal(creditsIn(debitOf(n)), 18);
    assert.equal(Object.hasOwn(falBody(n) || {}, 'resolution'), false);
});
