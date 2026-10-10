// Audit 2026-10-09 M-07: a ceiling on refunded composite jobs per account.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compositeRefundGate, COMPOSITE_MODELS, COMPOSITE_REFUNDS_PER_DAY } from '../lib/compositeRefunds.js';

const cfg = { supabaseUrl: 'https://db.test' };
const USER = '00000000-0000-4000-8000-000000000009';
function rpcReturning(value) {
    const calls = [];
    const rpc = async (name, args) => { calls.push([name, args]); if (value instanceof Error) throw value; return value; };
    return { rpc, calls };
}

test('the two composite models are gated; everything else passes without a database call', async () => {
    assert.deepEqual([...COMPOSITE_MODELS], ['clip-edit', 'auto-short-32s']);
    const f = rpcReturning(COMPOSITE_REFUNDS_PER_DAY);
    assert.equal(await compositeRefundGate({ rpc: f.rpc, cfg, userId: USER, modelId: 'kling-v3' }), null);
    assert.equal(f.calls.length, 0);
});

test('under the ceiling the job goes ahead; at it the job is refused with a retry-after', async () => {
    let f = rpcReturning(COMPOSITE_REFUNDS_PER_DAY - 1);
    assert.equal(await compositeRefundGate({ rpc: f.rpc, cfg, userId: USER, modelId: 'clip-edit' }), null);
    assert.deepEqual(f.calls, [['refunded_jobs_recent', { p_user_id: USER, p_model_ids: COMPOSITE_MODELS }]]);

    f = rpcReturning(COMPOSITE_REFUNDS_PER_DAY);
    const refused = await compositeRefundGate({ rpc: f.rpc, cfg, userId: USER, modelId: 'auto-short-32s' });
    assert.equal(refused.status, 429);
    assert.deepEqual(refused.body, { error: 'composite_refund_limit', limit: COMPOSITE_REFUNDS_PER_DAY, count: COMPOSITE_REFUNDS_PER_DAY, retry_after_seconds: 3600 });
    assert.equal(refused.retryAfter, 3600);
});

test('a database without the count (before 0251), or a count that is not a number, admits the job', async () => {
    for (const value of [new Error('PGRST202 function not found'), null, 'many', undefined]) {
        const f = rpcReturning(value);
        assert.equal(await compositeRefundGate({ rpc: f.rpc, cfg, userId: USER, modelId: 'clip-edit' }), null, String(value));
    }
});

test('the generations route asks the gate after the user is known and before the debit', () => {
    const src = readFileSync(new URL('../app/api/v1/generations/route.js', import.meta.url), 'utf8');
    const user = src.indexOf("return NextResponse.json({ error: 'user_not_provisioned' }");
    const gate = src.indexOf('await compositeRefundGate({ rpc, cfg, userId, modelId })');
    const debit = src.indexOf("rpc('ledger_debit'");
    assert.ok(user > 0 && gate > user && debit > gate, 'user lookup, then the gate, then the debit');
    assert.match(src, /headers: \{ 'retry-after': String\(refundsGate\.retryAfter\) \}/);
});
