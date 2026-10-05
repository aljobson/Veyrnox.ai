import test from 'node:test';
import assert from 'node:assert/strict';
import { createOAuthState, verifyOAuthState } from '../lib/social/oauthState.js';

const secret = 'test-only-secret-value';
const authId = '11111111-1111-4111-8111-111111111111';

test('round-trips and verifies against the same caller/network', async () => {
    const token = await createOAuthState({ authId, network: 'instagram' }, secret);
    assert.equal(await verifyOAuthState(token, { authId, network: 'instagram' }, secret), true);
});

test('rejects a token issued to a different auth id (forged/replayed state)', async () => {
    const token = await createOAuthState({ authId, network: 'instagram' }, secret);
    const other = '22222222-2222-4222-8222-222222222222';
    assert.equal(await verifyOAuthState(token, { authId: other, network: 'instagram' }, secret), false);
});

test('rejects a token for a different network', async () => {
    const token = await createOAuthState({ authId, network: 'instagram' }, secret);
    assert.equal(await verifyOAuthState(token, { authId, network: 'tiktok' }, secret), false);
});

test('rejects a token signed with a different secret', async () => {
    const token = await createOAuthState({ authId, network: 'instagram' }, secret);
    assert.equal(await verifyOAuthState(token, { authId, network: 'instagram' }, 'wrong-secret'), false);
});

test('rejects tampered payloads', async () => {
    const token = await createOAuthState({ authId, network: 'instagram' }, secret);
    const [payload, sig] = token.split('.');
    const tampered = `${payload}x.${sig}`;
    assert.equal(await verifyOAuthState(tampered, { authId, network: 'instagram' }, secret), false);
});

test('rejects malformed tokens without throwing', async () => {
    for (const bad of ['', 'no-dot', 'a.b.c', null, undefined, 42, 'x'.repeat(3000)]) {
        assert.equal(await verifyOAuthState(bad, { authId, network: 'instagram' }, secret), false);
    }
});

test('rejects an expired token', async (t) => {
    t.mock.timers.enable({ apis: ['Date'] });
    const token = await createOAuthState({ authId, network: 'instagram' }, secret);
    t.mock.timers.tick(601 * 1000); // past the 600s TTL
    assert.equal(await verifyOAuthState(token, { authId, network: 'instagram' }, secret), false);
});
