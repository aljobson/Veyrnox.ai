import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenCryptoConfig, encryptToken, decryptToken } from '../lib/social/tokenCrypto.js';

const validKey = Buffer.alloc(32, 7).toString('base64');

test('a missing or malformed key is reported as unconfigured, not a throw', () => {
    assert.equal(tokenCryptoConfig({}), null);
    assert.equal(tokenCryptoConfig({ SOCIAL_TOKEN_ENCRYPTION_KEY: 'not-base64!!' }), null);
    assert.equal(tokenCryptoConfig({ SOCIAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }), null);
});

test('round-trips a token through encrypt/decrypt', async () => {
    const cfg = tokenCryptoConfig({ SOCIAL_TOKEN_ENCRYPTION_KEY: validKey });
    assert.ok(cfg);
    const literal = await encryptToken('super-secret-oauth-token', cfg);
    assert.match(literal, /^\\x[0-9a-f]+$/);
    assert.equal(await decryptToken(literal, cfg), 'super-secret-oauth-token');
});

test('two encryptions of the same plaintext produce different ciphertext (random IV)', async () => {
    const cfg = tokenCryptoConfig({ SOCIAL_TOKEN_ENCRYPTION_KEY: validKey });
    const a = await encryptToken('same-token', cfg);
    const b = await encryptToken('same-token', cfg);
    assert.notEqual(a, b);
    assert.equal(await decryptToken(a, cfg), 'same-token');
    assert.equal(await decryptToken(b, cfg), 'same-token');
});

test('decrypting with the wrong key fails rather than returning garbage', async () => {
    const cfg = tokenCryptoConfig({ SOCIAL_TOKEN_ENCRYPTION_KEY: validKey });
    const otherCfg = tokenCryptoConfig({ SOCIAL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64') });
    const literal = await encryptToken('token', cfg);
    await assert.rejects(decryptToken(literal, otherCfg));
});

test('tampered ciphertext is rejected (GCM authentication)', async () => {
    const cfg = tokenCryptoConfig({ SOCIAL_TOKEN_ENCRYPTION_KEY: validKey });
    const literal = await encryptToken('token', cfg);
    const tampered = literal.slice(0, -2) + (literal.slice(-2) === '00' ? '01' : '00');
    await assert.rejects(decryptToken(tampered, cfg));
});

test('empty plaintext is rejected', async () => {
    const cfg = tokenCryptoConfig({ SOCIAL_TOKEN_ENCRYPTION_KEY: validKey });
    await assert.rejects(encryptToken('', cfg));
});
