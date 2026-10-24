import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFalDispatchStaging, readFalDispatchStatus } from '../scripts/check-fal-dispatch-staging.mjs';

const credentials = { CLOUDFLARE_API_TOKEN: 'fixture-cloudflare', SUPABASE_SERVICE_ROLE_KEY: 'fixture-stage', FAL_KEY: 'fixture-fal' };

test('staging preflight requires all protected credentials before any request', async () => {
    for (const name of Object.keys(credentials)) {
        await assert.rejects(checkFalDispatchStaging({ ...credentials, [name]: '' }, () => {
            assert.fail('missing credentials must not send a request');
        }), /Missing protected staging secret/);
    }
});

test('staging preflight checks only the isolated database sentinel, never fal', async () => {
    let calls = 0;
    assert.equal(await checkFalDispatchStaging(credentials, async (url, options) => {
        calls++;
        assert.equal(url, 'https://yrqzwqywxfesmbvhzjgj.supabase.co/rest/v1/rpc/claim_fal_dispatch');
        assert.equal(options.headers.apikey, credentials.SUPABASE_SERVICE_ROLE_KEY);
        assert.equal(options.headers.Authorization, `Bearer ${credentials.SUPABASE_SERVICE_ROLE_KEY}`);
        assert.deepEqual(JSON.parse(options.body), { p_job_id: '00000000-0000-4000-8000-000000000000' });
        assert.ok(options.signal instanceof AbortSignal);
        return Response.json({ disposition: 'MISSING' });
    }), true);
    assert.equal(calls, 1);
});

test('staging preflight refuses wrong credentials, missing schema and unexpected claims', async () => {
    for (const response of [new Response('private vendor detail', { status: 401 }), new Response('', { status: 404 }),
        Response.json({ disposition: 'CLAIMED', payload: { prompt: 'private prompt' } }), Response.json(null)]) {
        await assert.rejects(checkFalDispatchStaging(credentials, async () => response), error => {
            assert.doesNotMatch(error.message, /private|fixture/);
            return true;
        });
    }
});

test('status diagnostic reads only lifecycle fields and never sends a mutation', async () => {
    const jobId = '5589c751-9c6c-4da9-a280-37cb3e2213d5';
    const calls = [];
    const result = await readFalDispatchStatus(jobId, credentials, async (url, options) => {
        calls.push({ url, options });
        if (url.includes('/jobs?')) return Response.json([{ id: jobId, state: 'FAILED', error_code: 'provider_timeout', updated_at: '2026-10-21T15:59:40Z' }]);
        return Response.json([{ state: 'CLOSED', projected_at: null, recovery_checked_at: '2026-10-21T16:00:00Z' }]);
    });
    assert.deepEqual(result, { found: true, job: { state: 'FAILED', error_code: 'provider_timeout' },
        dispatch: { state: 'CLOSED', projected_at: null, recovery_checked_at: '2026-10-21T16:00:00Z' } });
    assert.equal(calls.length, 2);
    for (const { url, options } of calls) {
        assert.match(url, /\/rest\/v1\/(jobs|fal_dispatch)\?/);
        assert.equal(options.method, undefined);
        assert.equal(options.body, undefined);
        assert.equal(options.headers.apikey, credentials.SUPABASE_SERVICE_ROLE_KEY);
    }
});

test('status diagnostic rejects invalid identifiers and redacts database failures', async () => {
    await assert.rejects(readFalDispatchStatus('not-a-uuid', credentials), /Invalid dispatch job identifier/);
    await assert.rejects(readFalDispatchStatus('5589c751-9c6c-4da9-a280-37cb3e2213d5', credentials,
        async () => new Response('private query detail', { status: 500 })), error => {
        assert.doesNotMatch(error.message, /private|fixture/);
        return true;
    });
});
