import test from 'node:test';
import assert from 'node:assert/strict';
import { refundRejectedSubmit } from '../lib/submitRejection.js';

const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'svc' };
const job = { jobId: 'job-1', userId: 'user-1', credits: 28 };

function fakeRpc(answers = {}) {
    const calls = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        const name = String(url).split('/rpc/')[1];
        calls.push({ name, args: JSON.parse(init.body) });
        const a = answers[name];
        if (a instanceof Error) throw a;
        return Response.json(a ?? { ok: true });
    };
    return { calls, restore: () => { globalThis.fetch = real; } };
}

test('records the typed error_code on the job, then refunds exactly as before', async () => {
    const net = fakeRpc();
    try {
        await refundRejectedSubmit({ ...job, errorCode: 'provider_payment_required' }, cfg);
        assert.deepEqual(net.calls, [
            { name: 'job_submit_rejected', args: { p_job_id: 'job-1', p_error_code: 'provider_payment_required' } },
            { name: 'ledger_refund', args: { p_job_id: 'job-1', p_user_id: 'user-1', p_credits: 28, p_reason: 'refund:submit_failed' } },
        ]);
    } finally { net.restore(); }
});

test('a missing or untyped code falls back to provider_submit_failed', async () => {
    for (const errorCode of [undefined, 'fal 402: {"detail":"x"}', 'inputs_invalid:prompt', 'A'.repeat(65)]) {
        const net = fakeRpc();
        try {
            await refundRejectedSubmit({ ...job, errorCode }, cfg);
            assert.equal(net.calls[0].args.p_error_code, 'provider_submit_failed');
        } finally { net.restore(); }
    }
});

test('the refund still runs when recording the code fails', async () => {
    const net = fakeRpc({ job_submit_rejected: new Error('db down') });
    const errors = console.error;
    console.error = () => {};
    try {
        await refundRejectedSubmit({ ...job, errorCode: 'provider_auth_failed' }, cfg);
        assert.deepEqual(net.calls.map((c) => c.name), ['job_submit_rejected', 'ledger_refund']);
    } finally { net.restore(); console.error = errors; }
});

test('a refund error is logged, not thrown (the sweep refunds a DEBITED job)', async () => {
    const net = fakeRpc({ ledger_refund: new Error('db down') });
    const errors = console.error;
    console.error = () => {};
    try {
        await refundRejectedSubmit({ ...job, errorCode: 'provider_timeout' }, cfg);
        assert.equal(net.calls.length, 2);
    } finally { net.restore(); console.error = errors; }
});
