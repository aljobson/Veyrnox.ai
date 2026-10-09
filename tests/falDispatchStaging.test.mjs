import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFalDispatchStaging } from '../scripts/check-fal-dispatch-staging.mjs';

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
