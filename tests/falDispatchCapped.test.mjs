import test from 'node:test';
import assert from 'node:assert/strict';
import { admitFalDispatch } from '../lib/falDispatch.js';
import { SupabaseError, rpc as realRpc } from '../packages/db/supabase-client.js';
import { runInOutageScope, outageNoted } from '../lib/outageScope.js';

const args = { userId: 'fixture-user', key: 'fixture-key',
    model: { id: 'flux-2-pro', provider_endpoint: 'fal-ai/flux-2-pro' },
    record: { inputs: { prompt: {} }, rename: {}, media: {}, fixed: {} },
    inputs: { prompt: 'test' }, jobInputs: { prompt: 'test' }, free: false,
    cfg: { supabaseUrl: 'https://db.test', serviceRoleKey: 'test' } };
const accepted = { ok: true, job_id: 'original-job', state: 'DEBITED', balance_after: 93, idempotent: false, free: false };
const missing = () => new SupabaseError('rpc failed', { status: 404,
    body: { code: 'PGRST202', message: 'Could not find the function public.admit_fal_dispatch_capped in the schema cache' } });
const unknown = async r => {
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { error: 'dispatch_acceptance_unknown' });
    assert.equal(r.headers.get('retry-after'), null);
};

for (const maxCharge of [undefined, 0, 7, 2147483647, 2147483648, Number.MAX_SAFE_INTEGER]) {
    for (const replay of [false, true]) test(`RPC keys and ceiling width: ${maxCharge}, replay=${replay}`, async () => {
        const calls = [], wakes = [];
        const response = await admitFalDispatch({ ...args, maxCharge,
            existingJob: () => { assert.fail('function present: no lookup'); },
            rpc: async (name, input) => { calls.push({ name, input }); return { ...accepted, idempotent: replay }; },
            onCommitted: id => wakes.push(id) });
        assert.equal(response.status, replay ? 200 : 202);
        assert.equal((await response.json()).job_id, accepted.job_id);
        assert.deepEqual(calls, [{ name: maxCharge === undefined ? 'admit_fal_dispatch' : 'admit_fal_dispatch_capped', input: {
            p_user_id: args.userId, p_idempotency_key: args.key, p_model_id: args.model.id,
            p_inputs: args.jobInputs, p_payload: args.inputs, p_endpoint: args.model.provider_endpoint, p_allow_free: false,
            ...(maxCharge === undefined ? {} : { p_max_charge: Math.min(maxCharge, 2147483647) }),
        } }]);
        assert.deepEqual(wakes, [accepted.job_id]);
    });
}
test('price refusal preserves original client ceiling and never wakes dispatch', async () => {
    const response = await admitFalDispatch({ ...args, maxCharge: 6,
        rpc: async () => ({ ok: false, code: 'PRICE_EXCEEDS_CEILING', expected_credits: 7 }),
        onCommitted: () => assert.fail('refused admission') });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'price_changed', expected_credits: 7, max_charge_credits: 6 });
});
for (const [code, status] of [['PROVIDER_ADMISSION_PAUSED',503], ['ACCOUNT_FROZEN',403], ['ACCOUNT_ON_HOLD',403],
    ['INSUFFICIENT_BALANCE',402], ['MODEL_UNAVAILABLE',400], ['RATE_LIMITED',429], ['IDEMPOTENCY_CONFLICT',409], ['FUTURE_REFUSAL',400]]) {
    test(`definite ${code} is preserved`, async () => {
        const response = await admitFalDispatch({ ...args, maxCharge: 0,
            rpc: async () => ({ ok: false, code }), onCommitted: () => assert.fail('refused admission') });
        assert.equal(response.status, status); assert.deepEqual(await response.json(), { error: code.toLowerCase() });
    });
}
for (const [scope, retry] of [['user_inflight',30], ['global_day',7200]]) for (const thrown of [true,false]) {
    test(`capped ${scope} refusal matches legacy; thrown=${thrown}`, async () => {
        await runInOutageScope(async () => {
            const calls = [];
            const rpc = async name => {
                calls.push(name);
                if (thrown) throw new SupabaseError('trigger refusal', { status: 400,
                    body: { code: 'P0001', message: `PROVIDER_SPEND_LIMIT:${scope}:${retry}` } });
                return { ok: false, code: 'PROVIDER_SPEND_LIMIT', scope, retry_after_seconds: retry };
            };
            const onCommitted = () => assert.fail('no wakeup for a refusal');
            const legacy = await admitFalDispatch({ ...args, rpc, onCommitted });
            const capped = await admitFalDispatch({ ...args, rpc, onCommitted, maxCharge: 0,
                existingJob: () => assert.fail('no fallback lookup') });
            assert.equal(capped.status, scope === 'user_inflight' ? 429 : 503);
            assert.equal(capped.status, legacy.status);
            assert.equal(capped.headers.get('retry-after'), String(retry));
            assert.deepEqual(await capped.json(), await legacy.json());
            assert.deepEqual(calls, ['admit_fal_dispatch', 'admit_fal_dispatch_capped']);
            assert.equal(outageNoted(), false);
        });
    });
}
for (const reply of [null, undefined, {}, [], 'invalid', { ok: 'true' }, { ok: false }, { ok: false, code: 42 },
    { ok: true }, { ...accepted, job_id: undefined }, { ...accepted, job_id: '' }, { ...accepted, state: null },
    { ...accepted, balance_after: null }, { ...accepted, free: 'true' }, { ok: false, code: 'PRICE_EXCEEDS_CEILING' }]) {
    test(`incomplete reply is unknown: ${JSON.stringify(reply)}`, async () => {
        const calls = [];
        await unknown(await admitFalDispatch({ ...args, maxCharge: 0,
            rpc: async name => { calls.push(name); return reply; },
            existingJob: () => assert.fail('no fallback'), onCommitted: () => assert.fail('no wakeup') }));
        assert.deepEqual(calls, ['admit_fal_dispatch_capped']);
    });
}
for (const body of ['unreadable', 'null']) test(`real RPC 2xx ${body} is unknown`, async t => {
    const calls = [];
    t.mock.method(globalThis, 'fetch', async url => {
        calls.push(new URL(url).pathname);
        return new Response(body, { headers: { 'content-type': 'application/json' } });
    });
    await unknown(await admitFalDispatch({ ...args, maxCharge: 0, rpc: realRpc,
        existingJob: () => assert.fail('no fallback'), onCommitted: () => assert.fail('no wakeup') }));
    assert.deepEqual(calls, ['/rest/v1/rpc/admit_fal_dispatch_capped']);
});
for (const error of [new Error('transport failed'), new SupabaseError('timeout', { status: 0, body: null }),
    new SupabaseError('gateway 404', { status: 404, body: 'not found' }),
    new SupabaseError('wrong missing function', { status: 404, body: { code: 'PGRST202', message: 'missing other_function' } })]) {
    test(`unproven non-execution stays unknown: ${error.message}`, async () => {
        let calls = 0;
        await unknown(await admitFalDispatch({ ...args, maxCharge: 0,
            rpc: async () => { calls++; throw error; }, existingJob: () => assert.fail('no lookup'),
            onCommitted: () => assert.fail('no wakeup') }));
        assert.equal(calls, 1);
    });
}
for (const existing of [false, true, 'lookup-error']) test(`missing function compatibility: ${existing}`, async () => {
    const calls = []; let wakes = 0, lookups = 0;
    const response = await admitFalDispatch({ ...args, maxCharge: 0,
        existingJob: async () => { lookups++; if (existing === 'lookup-error') throw Error('lookup failed'); return existing; },
        rpc: async name => { calls.push(name); if (name.endsWith('_capped')) throw missing(); return { ...accepted, idempotent: true }; },
        onCommitted: () => { wakes++; } });
    assert.equal(lookups, 1);
    assert.deepEqual(calls, ['admit_fal_dispatch_capped', ...(existing === true ? ['admit_fal_dispatch'] : [])]);
    assert.equal(wakes, existing === true ? 1 : 0);
    if (existing === 'lookup-error') await unknown(response);
    else if (existing) { assert.equal(response.status, 200); assert.equal((await response.json()).job_id, accepted.job_id); }
    else { assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'admission_unavailable' }); }
});
test('lost acknowledgement after commit replays the original job and key', async () => {
    const calls = []; let committed = false, debits = 0;
    const rpc = async (name, input) => {
        calls.push({ name, input });
        if (!committed) { committed = true; debits++; throw Error('ack lost after commit'); }
        return { ...accepted, idempotent: true };
    };
    await unknown(await admitFalDispatch({ ...args, maxCharge: 7, rpc, onCommitted: () => assert.fail('unknown') }));
    const replay = await admitFalDispatch({ ...args, maxCharge: 0, rpc });
    assert.equal(replay.status, 200); assert.equal((await replay.json()).job_id, accepted.job_id);
    assert.equal(debits, 1);
    assert.deepEqual(calls.map(c => c.name), ['admit_fal_dispatch_capped', 'admit_fal_dispatch_capped']);
    assert.equal(calls[0].input.p_idempotency_key, calls[1].input.p_idempotency_key);
});

test('an incomplete 2xx that only carries a spend-limit code is an unknown outcome, not a refusal', async () => {
    for (const reply of [{ code: 'PROVIDER_SPEND_LIMIT', scope: 'user_inflight', retry_after_seconds: 30 }, { ok: true, code: 'PROVIDER_SPEND_LIMIT' }, { code: 'PROVIDER_SPEND_UNAVAILABLE' }]) {
        const wakes = [];
        const response = await admitFalDispatch({ ...args, maxCharge: 5, rpc: async () => reply, onCommitted: id => wakes.push(id) });
        await unknown(response);
        assert.deepEqual(wakes, []);
    }
});

