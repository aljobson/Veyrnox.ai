import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaProxyToken, verifyMediaProxyToken } from '../lib/social/mediaProxyToken.js';

const secret = 'proxy-secret-value';

test('round-trips the r2Key through a signed token', async () => {
    const token = await createMediaProxyToken({ r2Key: 'assets/a.jpg' }, secret);
    assert.equal(await verifyMediaProxyToken(token, secret), 'assets/a.jpg');
});

test('rejects a token signed with a different secret', async () => {
    const token = await createMediaProxyToken({ r2Key: 'assets/a.jpg' }, secret);
    assert.equal(await verifyMediaProxyToken(token, 'wrong-secret'), null);
});

test('rejects an expired token', async () => {
    const token = await createMediaProxyToken({ r2Key: 'assets/a.jpg', expiresInSeconds: -1 }, secret);
    assert.equal(await verifyMediaProxyToken(token, secret), null);
});

test('rejects malformed input without throwing', async () => {
    for (const bad of [undefined, null, '', 'not-a-token', 'a.b.c', 'a'.repeat(3000)]) {
        assert.equal(await verifyMediaProxyToken(bad, secret), null);
    }
});

test('a tampered payload fails signature verification', async () => {
    const token = await createMediaProxyToken({ r2Key: 'assets/a.jpg' }, secret);
    const [payload, sig] = token.split('.');
    const tamperedPayload = Buffer.from(payload, 'base64url').toString().replace('assets/a.jpg', 'assets/secret.jpg');
    const tampered = `${Buffer.from(tamperedPayload).toString('base64url')}.${sig}`;
    assert.equal(await verifyMediaProxyToken(tampered, secret), null);
});
