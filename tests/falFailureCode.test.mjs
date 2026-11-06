import test from 'node:test';
import assert from 'node:assert/strict';
import { falFailureCode, isReferenceLikenessRejection, REFERENCE_REJECTED_LIKENESS } from '../lib/falFailureCode.js';
import { createFalWebhookHandler } from '../lib/falWebhookHandler.js';
import { publicErrorCode } from '../lib/jobState.js';

const LIKENESS = {
    request_id: 'req-1', status: 'ERROR', error: 'Unprocessable Entity',
    payload: { detail: [{
        loc: ['body', 'image_urls', 0], type: 'content_policy_violation',
        msg: 'The images or videos provided may contain likenesses of real people or other private information that cannot be processed.',
        ctx: { extra_info: { reason: 'partner_validation_failed' } },
    }] },
};

test('a 422 content-policy detail on image_urls gets the typed code', () => {
    assert.equal(falFailureCode(LIKENESS), REFERENCE_REJECTED_LIKENESS);
    assert.equal(publicErrorCode(falFailureCode(LIKENESS)), REFERENCE_REJECTED_LIKENESS);
});

test('partner_validation_failed alone, on a picture, is enough', () => {
    const e = { status: 'ERROR', payload: { detail: [{ loc: ['body', 'image_urls', 2], type: 'x', ctx: { extra_info: { reason: 'partner_validation_failed' } } }] } };
    assert.equal(falFailureCode(e), REFERENCE_REJECTED_LIKENESS);
});

test('a policy violation on the prompt keeps the generic code', () => {
    const e = { status: 'ERROR', payload: { detail: [{ loc: ['body', 'prompt'], type: 'content_policy_violation' }] } };
    assert.equal(isReferenceLikenessRejection(e), false);
    assert.equal(falFailureCode(e), 'provider_error');
});

test('other failures keep their code or fall back to provider_error', () => {
    assert.equal(falFailureCode({ status: 'ERROR', error: { code: 'timeout' } }), 'timeout');
    assert.equal(falFailureCode({ status: 'ERROR', error: 'boom' }), 'provider_error');
    assert.equal(falFailureCode({ status: 'ERROR', payload: { detail: 'nope' } }), 'provider_error');
    assert.equal(falFailureCode(null), 'provider_error');
});

function fixture({ processed = true, failOk = true } = {}) {
    const rpcs = [];
    const handler = createFalWebhookHandler({
        config: () => ({ supabaseUrl: 'https://fixture.invalid', serviceRoleKey: 'fixture' }),
        storageConfig: () => ({ accountId: 'a', accessKeyId: 'a', secretAccessKey: 'a', bucket: 'a' }),
        expectedTenant: () => 'tenant',
        verify: async () => true,
        fetchCall: async (url, init = {}) => {
            if (url.pathname === '/rest/v1/jobs') return Response.json([{ id: 'job-1', user_id: 'u1', credits: 85, state: 'FAILED', model_id: 'seedance-2.0-reference' }]);
            if (url.pathname === '/rest/v1/webhook_events') {
                if (init.method === 'POST') return Response.json(processed ? [] : [{}], { status: 201 });
                return Response.json([{ processed_at: processed ? '2026-11-06T00:00:00Z' : null }]);
            }
            return Response.json({});
        },
        rpcCall: async (name, args) => {
            rpcs.push({ name, args });
            if (name === 'job_failed') return failOk ? { ok: true, job_id: 'job-1', user_id: 'u1', credits: 85 } : { ok: false };
            return { ok: true };
        },
    });
    const req = () => new Request('https://fixture.invalid/api/webhook/fal', {
        method: 'POST', body: JSON.stringify(LIKENESS),
        headers: { 'x-fal-webhook-request-id': 'req-1', 'x-fal-webhook-user-id': 'tenant' },
    });
    return { handler, rpcs, req };
}

test('webhook records the typed code, refunds once with the same reason, and leaks no vendor text', async () => {
    const f = fixture({ processed: false });
    const res = await f.handler(f.req());
    assert.equal(res.status, 200);
    assert.doesNotMatch(JSON.stringify(await res.json()), /likeness|partner|real people/i);
    const failed = f.rpcs.find((r) => r.name === 'job_failed');
    assert.equal(failed.args.p_error_code, 'reference_rejected_likeness');
    const refunds = f.rpcs.filter((r) => r.name === 'ledger_refund');
    assert.equal(refunds.length, 1);
    assert.deepEqual(refunds[0].args, { p_job_id: 'job-1', p_user_id: 'u1', p_credits: 85, p_reason: 'refund:provider_failed' });
});

test('a redelivery after job_failed still reaches the refund, from the job row', async () => {
    const f = fixture({ processed: false, failOk: false });
    assert.equal((await f.handler(f.req())).status, 200);
    assert.equal(f.rpcs.filter((r) => r.name === 'ledger_refund').length, 1);
});

test('a fully processed delivery is a no-op', async () => {
    const f = fixture({ processed: true });
    const res = await f.handler(f.req());
    assert.deepEqual(await res.json(), { ok: true, duplicate: true });
    assert.equal(f.rpcs.length, 0);
});
