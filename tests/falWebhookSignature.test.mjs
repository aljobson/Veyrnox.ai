import test from 'node:test';
import assert from 'node:assert/strict';

// Full Ed25519 path with a generated key pair and a stubbed JWKS. The
// pre-fetch guards (tenant id, stale timestamp) live in falWebhook.test.mjs.
const { verifyWebhookSignature, _resetJwksCache } = await import('../packages/adapters/fal.js');

const enc = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
const OURS = { expectedUserId: 'fal-user' };

async function makeKey() {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    return { privateKey: pair.privateKey, jwk: { kty: 'OKP', crv: 'Ed25519', x: jwk.x } };
}
function stubJwks(keys) {
    globalThis.fetch = async () => new Response(JSON.stringify({ keys: keys.map((k) => k.jwk) }), { headers: { 'content-type': 'application/json' } });
}
async function signed(key, body, over = {}) {
    const headers = {
        requestId: 'req-1',
        userId: 'fal-user',
        timestamp: String(Math.floor(Date.now() / 1000)),
        ...over,
    };
    const bodyHash = hex(await crypto.subtle.digest('SHA-256', body));
    const msg = enc.encode(`${headers.requestId}\n${headers.userId}\n${headers.timestamp}\n${bodyHash}`);
    headers.signature = hex(await crypto.subtle.sign({ name: 'Ed25519' }, key.privateKey, msg));
    return headers;
}

const key = await makeKey();
const body = enc.encode('{"request_id":"req-1","status":"OK"}');
test.beforeEach(() => _resetJwksCache());

test('valid signature for our tenant verifies', async () => {
    stubJwks([key]);
    assert.equal(await verifyWebhookSignature(body, await signed(key, body), OURS), true);
});

test('tampered body fails', async () => {
    stubJwks([key]);
    const h = await signed(key, body);
    assert.equal(await verifyWebhookSignature(enc.encode('{"status":"OK","x":1}'), h, OURS), false);
});

test('different key fails', async () => {
    stubJwks([key]);
    const other = await makeKey();
    assert.equal(await verifyWebhookSignature(body, await signed(other, body), OURS), false);
});

test('valid signature for another tenant fails', async () => {
    stubJwks([key]);
    assert.equal(await verifyWebhookSignature(body, await signed(key, body, { userId: 'someone-else' }), OURS), false);
});

test('missing header / non-hex / short signature fail', async () => {
    stubJwks([key]);
    const h = await signed(key, body);
    assert.equal(await verifyWebhookSignature(body, { ...h, requestId: '' }, OURS), false);
    assert.equal(await verifyWebhookSignature(body, { ...h, signature: 'zz' }, OURS), false);
    assert.equal(await verifyWebhookSignature(body, { ...h, signature: h.signature.slice(0, 10) }, OURS), false);
    assert.equal(await verifyWebhookSignature(body, null, OURS), false);
});

test('JWKS unreachable fails closed', async () => {
    globalThis.fetch = async () => new Response('nope', { status: 500 });
    assert.equal(await verifyWebhookSignature(body, await signed(key, body), OURS), false);
});
