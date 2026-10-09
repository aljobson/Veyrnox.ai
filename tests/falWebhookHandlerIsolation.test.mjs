import test from 'node:test';
import assert from 'node:assert/strict';
import { createFalWebhookHandler } from '../lib/falWebhookHandler.js';

const storageConfig = () => ({ accountId: 'fixture', accessKeyId: 'fixture', secretAccessKey: 'fixture', bucket: 'fixture' });
function fixture(tenant) {
    const calls = [];
    const handler = createFalWebhookHandler({
        config: () => ({ supabaseUrl: 'https://fixture.invalid', serviceRoleKey: 'fixture' }),
        storageConfig, expectedTenant: () => tenant,
        verify: async (_bytes, headers, cfg) => headers.userId === cfg.expectedUserId,
        fetchCall: async (url, init = {}) => {
            calls.push({ path: url.pathname, method: init.method || 'GET' });
            if (url.pathname === '/rest/v1/jobs') return Response.json([{ id: tenant, state: 'STORED' }]);
            if (url.pathname === '/rest/v1/webhook_events') {
                return Response.json(init.method === 'POST' ? [] : [{ processed_at: '2026-10-09T00:00:00Z' }],
                    { status: init.method === 'POST' ? 201 : 200 });
            }
            throw new Error('Unexpected fixture I/O');
        },
        rpcCall: async () => { throw new Error('Terminal delivery must not call an RPC'); },
        copyAsset: async () => { throw new Error('Terminal delivery must not copy an asset'); },
    });
    return { handler, calls };
}
const request = tenant => new Request('https://fixture.invalid/api/webhook/fal', {
    method: 'POST', body: JSON.stringify({ request_id: 'fixture-request', status: 'OK' }),
    headers: { 'x-fal-webhook-request-id': 'fixture-request', 'x-fal-webhook-user-id': tenant },
});

test('handler instances keep tenant verification and I/O dependencies isolated', async () => {
    const a = fixture('tenant-a'), b = fixture('tenant-b');
    const results = await Promise.all([a.handler(request('tenant-a')), b.handler(request('tenant-b'))]);
    assert.deepEqual(results.map(r => r.status), [200, 200]);
    assert.deepEqual(await results[0].json(), { ok: true, duplicate: true });
    assert.deepEqual(a.calls, b.calls);
    assert.equal(a.calls.length, 3);
    assert.equal((await a.handler(request('tenant-b'))).status, 401);
    assert.equal(a.calls.length, 3, 'wrong tenant fails before database I/O');
});
