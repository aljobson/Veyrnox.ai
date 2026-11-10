import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { submitTask, ENDPOINT } from '../packages/adapters/grsai.js';
import { classifySubmitFailure } from '../lib/supplierRoutesFailover.js';

const sql = readFileSync('packages/db/schema/supabase/0456_nano_banana_pro_kie_standby_route.sql', 'utf8');
const CAP = 0.01796; // ADR-0037
const job = { provider_endpoint: ENDPOINT, inputs: { prompt: 'A blue teapot' } };

async function withFetch(fn, run) {
    const real = globalThis.fetch;
    globalThis.fetch = fn;
    try { await run(); } finally { globalThis.fetch = real; }
}

test('GrsAI "insufficient credits" is a payment refusal and may be routed around', async () => {
    await withFetch(async () => Response.json({ code: -1, msg: 'insufficient credits' }), async () => {
        const r = await submitTask(job, { apiKey: 'k' });
        assert.deepEqual(r, { ok: false, error: 'provider_payment_required', outcome: 'rejected', errorCode: 'provider_payment_required' });
        assert.equal(classifySubmitFailure(r), 'failover');
    });
});

test('any other GrsAI refusal still stops: no message, other words, or a vendor message in the result', async () => {
    for (const body of [{ code: -1 }, { code: -1, msg: 'prompt blocked' }, { code: 500, msg: 'internal error' }, { code: -1, msg: 42 }]) {
        await withFetch(async () => Response.json(body), async () => {
            const r = await submitTask(job, { apiKey: 'k' });
            assert.equal(r.error, 'provider_request_rejected', JSON.stringify(body));
            assert.equal(classifySubmitFailure(r), 'stop', JSON.stringify(body));
        });
    }
    await withFetch(async () => Response.json({ code: -1, msg: 'insufficient credits for key sk-secret' }), async () => {
        assert.doesNotMatch(JSON.stringify(await submitTask(job, { apiKey: 'k' })), /sk-secret/);
    });
});

test('a GrsAI success is untouched by the rule', async () => {
    await withFetch(async () => Response.json({ code: 0, data: { id: '15-test-task' } }), async () => {
        assert.deepEqual(await submitTask(job, { apiKey: 'k' }), { ok: true, providerJobId: '15-test-task' });
    });
});

test('0456 adds one active kie route at priority 2 behind the GrsAI offer, with evidence, a waiver and a daily cap', () => {
    assert.match(sql, /'nano-banana-pro-grsai', 'kie', 'market:nano-banana-pro', 0\.0900, 'per_generation', 2, 'active', 'licensed_reseller'/);
    assert.match(sql, /26cba7722184e514a7373068284b82fa/, 'the probe task is the parity record');
    assert.match(sql, /margin_waiver_note/);
    assert.match(sql, /,\s*500\)\s*ON CONFLICT \(model_id, priority\) DO NOTHING/, 'daily_spend_cap_cents 500, idempotent');
    assert.match(sql, /<> 1 THEN/, 'it asserts exactly one row each way');
});

test('0456 touches no price, no catalog row and no other route; fal is not added', () => {
    assert.doesNotMatch(sql, /UPDATE\s+public\./i);
    assert.doesNotMatch(sql, /DELETE\s+FROM/i);
    assert.doesNotMatch(sql, /INSERT INTO public\.model_catalog/i);
    assert.doesNotMatch(sql, /'fal',/);
});

test('the waiver is real: kie at $0.09 breaches the 2-credit cap, so 0373 would refuse the hop without it', () => {
    assert.ok(0.09 > 2 * CAP);
    assert.match(sql, /margin_waiver_note/);
});

test('route 1 is the guard: the migration refuses to run if the GrsAI route is not there', () => {
    assert.match(sql, /supplier = 'grsai' AND r\.priority = 1 AND r\.state = 'active'/);
    assert.match(sql, /RAISE EXCEPTION 'Expected one active GrsAI route 1/);
});
