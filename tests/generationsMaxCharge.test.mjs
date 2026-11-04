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
function post(max, extra = {}) {
    return POST(new Request('https://veyrnox.test/api/v1/generations', { method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH, 'content-type': 'application/json' }, body: JSON.stringify({ model_id: model.id, idempotency_key: 'max-charge-test-key', inputs: { prompt: 'A quiet blue sphere' }, ...(max !== undefined ? { max_charge_credits: max } : {}), ...extra }) }));
}
for (const maxChargeFlag of [null, 'false', 'true']) for (const max of [null, -1, 0.5, '7', true, {}]) test(`invalid ceiling ${JSON.stringify(max)}, flag=${maxChargeFlag} is rejected before any network call`, async t => {
    const n = network(t, { maxChargeFlag });
    const r = await post(max);
    assert.equal(r.status, 400); assert.equal((await r.json()).error, 'max_charge_credits_invalid'); assert.equal(n.calls.length, 0);
});
for (const max of [undefined, 7, 100]) test(`paid request ceiling ${max} admits at catalog price`, async t => {
    const n = network(t);
    const r = await post(max);
    assert.equal(r.status, 200); assert.equal(n.charged, 7); assert.equal(n.count('ledger_debit'), 1);
    assert.equal(n.count('jobs'), 0);
});
test('below-price cap refuses with authoritative quote, no job or debit', async t => {
    const n = network(t);
    const r = await post(6);
    assert.equal(r.status, 409); assert.deepEqual(await r.json(), { error: 'price_changed', expected_credits: 7, max_charge_credits: 6 });
    assert.equal(n.charged, 0); assert.equal(n.count('ledger_debit'), 0);
});
test('taken allowance fits zero ceiling', async t => {
    const n = network(t, { free: true, reply: { ok: true, taken: true, job_id: JOB } });
    const r = await post(0);
    assert.equal(r.status, 200); assert.equal((await r.json()).free_allowance, true); assert.equal(n.count('ledger_debit'), 0);
});
test('explicit exhausted allowance gives definitive price_changed', async t => {
    const n = network(t, { free: true });
    const r = await post(0);
    assert.equal(r.status, 409); assert.equal((await r.json()).error, 'price_changed'); assert.equal(n.count('ledger_debit'), 0);
});
for (const reply of ['throw', 'unreadable', null, {}, { ok: true }, { ok: true, taken: true }]) {
    for (const existing of [true, false]) test(`ambiguous ${JSON.stringify(reply)}, existing=${existing}`, async t => {
        const n = network(t, { free: true, reply, existing });
        const r = await post(0), body = await r.json();
        assert.equal(r.status, existing ? 200 : 503);
        assert.equal(body.error, existing ? undefined : 'admission_unknown');
        if (existing) assert.equal(body.job_id, JOB);
        assert.equal(n.count('ledger_debit'), existing ? 1 : 0); assert.equal(n.charged, 0);
    });
}
test('ambiguous allowance and failed lookup never claim rejection', async t => {
    const n = network(t, { free: true, reply: 'throw', lookupError: true });
    const r = await post(0);
    assert.equal(r.status, 503); assert.equal((await r.json()).error, 'admission_unknown'); assert.equal(n.count('ledger_debit'), 0);
});
test('accepted key replays below the current catalog price', async t => {
    const n = network(t, { existing: true, row: { ...model, credits_5s: 100 } });
    const r = await post(0);
    assert.equal(r.status, 200); assert.equal((await r.json()).job_id, JOB); assert.equal(n.charged, 0);
});
for (const max of [0, 7, 100]) test(`new durable ceiling ${max} enforces SQL price changes after Worker read`, async t => {
    const n = network(t, { row: fal, durable: true, sqlPrice: 1000 });
    const r = await post(max, { model_id: fal.id });
    assert.equal(r.status, 409); assert.deepEqual(await r.json(), { error: 'price_changed', expected_credits: 1000, max_charge_credits: max });
    assert.equal(n.count('admit_fal_dispatch_capped'), 1); assert.equal(n.count('jobs'), 0); assert.equal(n.count('admit_fal_dispatch'), 0); assert.equal(n.charged, 0);
});
for (const max of [0, 7, 100]) test(`durable replay ceiling ${max} calls capped admission despite catalog increase`, async t => {
    const n = network(t, { row: { ...fal, credits_5s: 200 }, durable: true, existing: true });
    const r = await post(max, { model_id: fal.id });
    assert.equal(r.status, 200); assert.equal((await r.json()).job_id, JOB); assert.equal(n.count('admit_fal_dispatch_capped'), 1); assert.equal(n.count('admit_fal_dispatch'), 0); assert.equal(n.count('jobs'), 0); assert.equal(n.charged, 0);
});
test('missing capped RPC and failed replay lookup stays unknown', async t => {
    const n = network(t, { row: fal, durable: true, lookupError: true, cappedMissing: true });
    const r = await post(10, { model_id: fal.id });
    assert.equal(r.status, 503); assert.equal((await r.json()).error, 'dispatch_acceptance_unknown'); assert.equal(n.count('admit_fal_dispatch'), 0);
});
test('uncapped durable request uses legacy admission without added lookup', async t => {
    const n = network(t, { row: fal, durable: true });
    const r = await post(undefined, { model_id: fal.id });
    assert.equal(r.status, 202); assert.equal(n.count('admit_fal_dispatch'), 1); assert.equal(n.count('jobs'), 0);
});
test('video agent ceiling checked before guarded debit', async t => {
    const n = network(t, { row: video });
    const brief = 'A quiet blue sphere';
    const minted = await mintPlanToken({ secret: process.env.MONTAGE_PLAN_SECRET, authId: AUTH, brief, aspect: '9:16', credits: 7 });
    const r = await post(0, { model_id: video.id, idempotency_key: planIdempotencyKey(minted.nonce), inputs: { brief, aspect_ratio: '9:16', plan_id: minted.token } });
    assert.equal(r.status, 409); assert.equal((await r.json()).error, 'price_changed'); assert.equal(n.count('ledger_debit_video_agent'), 0); assert.equal(n.charged, 0);
});
test('reference path stays on the guarded generic debit even with durable flags on', async t => {
    const n = network(t, { row: referenceModel, durable: true });
    const r = await post(0, { model_id: referenceModel.id, consent: true, source_assets: [{ asset_id: JOB, slot: 'image' }] });
    assert.equal(r.status, 409); assert.equal((await r.json()).error, 'price_changed'); assert.equal(n.count('ledger_debit'), 0); assert.equal(n.count('admit_fal_dispatch'), 0);
});
for (const reply of [null, undefined, {}, { ok: true }, { ok: true, taken: false }, { ok: true, taken: true, job_id: JOB }, { ok: false, code: 'RATE_LIMITED' }, { ok: false }, { ok: true, taken: true }]) test(`wrapper preserves legacy value for ${JSON.stringify(reply)}`, async () => {
    const rpc = async name => name === 'read_user_credits' ? { balance: 42 } : reply;
    const detailed = await takeFreeJobDetailed({ rpc });
    const legacy = reply?.ok === false ? reply : reply?.ok === true && reply?.taken === true ? { ok: true, job_id: reply.job_id, idempotent: false, free: true, balance_after: 42 } : null;
    assert.deepEqual(await takeFreeJob({ rpc }), legacy); assert.deepEqual(detailed.result, legacy);
    const kind = reply?.ok === false ? 'refused' : reply?.ok === true && reply?.taken === true && reply?.job_id ? 'taken' : reply?.ok === true && reply?.taken === false ? 'none' : 'ambiguous';
    assert.equal(detailed.kind, kind);
});

for (const maxChargeFlag of [null, 'false', 'TRUE', '1']) {
    for (const durable of [false, true]) test(`disabled ceiling flag ${maxChargeFlag}, durable=${durable} ignores a breach without lookups`, async t => {
        const n = network(t, { maxChargeFlag, durable, row: durable ? fal : model, sqlPrice: 100 });
        const r = await post(0, { model_id: durable ? fal.id : model.id });
        assert.equal(r.status, durable ? 202 : 200);
        assert.equal(n.charged, durable ? 100 : 7);
        assert.equal(n.count(durable ? 'admit_fal_dispatch' : 'ledger_debit'), 1);
        assert.equal(n.count('jobs'), 0);
    });
}
for (const max of [undefined, 0]) test(`unlisted free refusal is preserved with ceiling ${max}`, async t => {
    const n = network(t, { free: true, reply: { ok: false, code: 'FUTURE_ADMISSION_REFUSAL' } });
    const r = await post(max);
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), { error: 'future_admission_refusal' });
    assert.equal(n.count('jobs'), 0);
    assert.equal(n.count('ledger_debit'), 0);
});
test('the unreadable 2xx fixture exercises the real rpc JSON parse failure and returns null', async t => {
    const n = network(t, { reply: 'unreadable' });
    const result = await realRpc('submit_free_job', {}, { supabaseUrl: 'https://db.test', serviceRoleKey: 'test-service' });
    assert.equal(result, null);
    assert.equal(n.count('submit_free_job'), 1);
});

for (const maxChargeFlag of ['false', 'true']) test(`durable mobile payload is identical; server flag ${maxChargeFlag} decides admission`, async t => {
    const n = network(t, { row: fal, durable: true, maxChargeFlag });
    const response = await post(0, { model_id: fal.id, confirmed_credits: 7 });
    assert.equal(response.status, maxChargeFlag === 'true' ? 409 : 202);
    assert.equal(n.count('admit_fal_dispatch'), maxChargeFlag === 'true' ? 0 : 1);
    assert.equal(n.charged, maxChargeFlag === 'true' ? 0 : 7);
});
test('disabled ceiling retains the legacy ambiguous allowance fallback without a lookup', async t => {
    const n = network(t, { maxChargeFlag: 'false', free: true, reply: 'unreadable' });
    const response = await post(0);
    assert.equal(response.status, 200);
    assert.equal(n.charged, 7);
    assert.equal(n.count('ledger_debit'), 1);
    assert.equal(n.count('jobs'), 0);
});

// An enabled ceiling must let cached mobile gross prices reach net-price recovery.
test('enabled ceiling below the real price supersedes stale gross confirmation with price_changed', async t => {
    const n = network(t, { row: { ...model, credits_5s: 9 } });
    const response = await post(2, { confirmed_credits: 2 });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'price_changed', expected_credits: 9, max_charge_credits: 2 });
    assert.equal(n.count('ledger_debit'), 0);
    assert.equal(n.charged, 0);
});
for (const ceiling of [9, 12]) test(`enabled ceiling ${ceiling} admits at the real price despite stale gross confirmation`, async t => {
    const n = network(t, { row: { ...model, credits_5s: 9 } });
    const response = await post(ceiling, { confirmed_credits: 2 });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).job_id, JOB);
    assert.equal(n.count('ledger_debit'), 1);
    assert.equal(n.charged, 9);
});
for (const maxChargeFlag of ['false', null]) test(`disabled flag ${maxChargeFlag} retains exact gross confirmation despite a ceiling`, async t => {
    const n = network(t, { row: { ...model, credits_5s: 9 }, maxChargeFlag });
    const response = await post(9, { confirmed_credits: 2 });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'credit_confirmation_mismatch', confirmed_credits: 2, expected_credits: 9 });
    assert.equal(n.count('ledger_debit'), 0);
    assert.equal(n.count('jobs'), 0);
    assert.equal(n.charged, 0);
});
test('enabled flag without a ceiling retains exact gross confirmation for API clients', async t => {
    const n = network(t, { row: { ...model, credits_5s: 9 } });
    const response = await post(undefined, { confirmed_credits: 2 });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'credit_confirmation_mismatch', confirmed_credits: 2, expected_credits: 9 });
    assert.equal(n.count('ledger_debit'), 0);
    assert.equal(n.charged, 0);
});
for (const maxChargeFlag of ['false', 'true']) for (const confirmed of [null, -1, 0.5, '2', true, {}]) test(`gross type validation still runs with ceiling, flag=${maxChargeFlag}, value=${JSON.stringify(confirmed)}`, async t => {
    const n = network(t, { maxChargeFlag });
    const response = await post(9, { confirmed_credits: confirmed });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'confirmed_credits_invalid' });
    assert.equal(n.calls.length, 0);
});

for (const max of [7, 2147483647, 2147483648, Number.MAX_SAFE_INTEGER]) for (const existing of [false, true]) {
    test(`durable route ceiling ${max}, replay=${existing} uses capped RPC without lookup`, async t => {
        const n = network(t, { row: fal, durable: true, existing, lookupError: true });
        const response = await post(max, { model_id: fal.id });
        assert.equal(response.status, existing ? 200 : 202);
        assert.equal((await response.json()).job_id, JOB);
        assert.equal(n.count('admit_fal_dispatch'), 0); assert.equal(n.count('jobs'), 0);
        assert.equal(n.calls.find(c => c.name === 'admit_fal_dispatch_capped').body.p_max_charge, Math.min(max, 2147483647));
        assert.equal(n.charged, existing ? 0 : 7);
    });
}
for (const existing of [false, true]) test(`missing capped function route compatibility, existing=${existing}`, async t => {
    const n = network(t, { row: fal, durable: true, existing, cappedMissing: true });
    const response = await post(0, { model_id: fal.id });
    assert.equal(response.status, existing ? 200 : 503);
    const body = await response.json();
    if (existing) assert.equal(body.job_id, JOB);
    else assert.deepEqual(body, { error: 'admission_unavailable' });
    assert.equal(n.count('admit_fal_dispatch_capped'), 1);
    assert.equal(n.count('admit_fal_dispatch'), existing ? 1 : 0);
    assert.equal(n.count('jobs'), 1); assert.equal(n.charged, 0);
});
test('durable free allowance admits at zero ceiling through capped RPC', async t => {
    const n = network(t, { row: fal, durable: true, free: true, reply: { taken: true } });
    const response = await post(0, { model_id: fal.id });
    assert.equal(response.status, 202); assert.equal((await response.json()).free_allowance, true);
    assert.equal(n.charged, 0); assert.equal(n.count('admit_fal_dispatch_capped'), 1);
    assert.equal(n.count('admit_fal_dispatch'), 0); assert.equal(n.count('submit_free_job'), 0); assert.equal(n.count('jobs'), 0);
});
