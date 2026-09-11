import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyWebhookSignature } from '../packages/adapters/fal.js';

// These paths return before any JWKS fetch, so no network is touched.
const body = new TextEncoder().encode('{"request_id":"r1"}');
const headers = () => ({
    signature: 'ab'.repeat(64),
    timestamp: String(Math.floor(Date.now() / 1000)),
    requestId: 'r1',
    userId: 'tenant-other',
});

test('rejects a callback signed for another fal tenant', async () => {
    assert.equal(await verifyWebhookSignature(body, headers(), { expectedUserId: 'tenant-ours' }), false);
});

test('fails closed when our tenant id is not configured', async () => {
    assert.equal(await verifyWebhookSignature(body, headers(), {}), false);
    assert.equal(await verifyWebhookSignature(body, headers(), undefined), false);
});

test('rejects a stale timestamp', async () => {
    const h = { ...headers(), userId: 'tenant-ours', timestamp: String(Math.floor(Date.now() / 1000) - 3600) };
    assert.equal(await verifyWebhookSignature(body, h, { expectedUserId: 'tenant-ours' }), false);
});
