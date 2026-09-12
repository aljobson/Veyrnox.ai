import test from 'node:test';
import assert from 'node:assert/strict';

const { verifyES256, validateClaims, readToken, _resetJwksCache } = await import('../lib/supabaseJwt.js');

const SUPABASE_URL = 'https://abcdefgh.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;

const enc = new TextEncoder();
function b64url(bytes) {
    const bin = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function makeKey(kid) {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    return { kid, privateKey: pair.privateKey, jwk: { kty: 'EC', crv: 'P-256', kid, x: jwk.x, y: jwk.y } };
}
async function sign(key, payload, header = { alg: 'ES256', kid: key.kid }) {
    const h = b64url(JSON.stringify(header));
    const p = b64url(JSON.stringify(payload));
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, key.privateKey, enc.encode(`${h}.${p}`));
    return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}
function stubJwks(keys) {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ keys: keys.map((k) => k.jwk) }), { headers: { 'content-type': 'application/json' } }); };
    return () => calls;
}
function claims(over = {}) {
    const now = Math.floor(Date.now() / 1000);
    return { iss: ISSUER, aud: 'authenticated', sub: 'user-1', exp: now + 3600, ...over };
}

const key = await makeKey('k1');
test.beforeEach(() => _resetJwksCache());

test('verifyES256: valid token returns payload', async () => {
    stubJwks([key]);
    const payload = await verifyES256(await sign(key, claims()), SUPABASE_URL);
    assert.equal(payload.sub, 'user-1');
});

test('verifyES256: signed by a different key → signature', async () => {
    stubJwks([key]);
    const other = await makeKey('k1');
    await assert.rejects(verifyES256(await sign(other, claims()), SUPABASE_URL), { reason: 'signature' });
});

test('verifyES256: tampered payload → signature', async () => {
    stubJwks([key]);
    const [h, , s] = (await sign(key, claims())).split('.');
    const forged = `${h}.${b64url(JSON.stringify(claims({ sub: 'admin' })))}.${s}`;
    await assert.rejects(verifyES256(forged, SUPABASE_URL), { reason: 'signature' });
});

test('verifyES256: HS256 header rejected → signature', async () => {
    stubJwks([key]);
    const t = await sign(key, claims(), { alg: 'HS256', kid: 'k1' });
    await assert.rejects(verifyES256(t, SUPABASE_URL), { reason: 'signature' });
});

test('verifyES256: rotated kid is picked up by a forced refresh', async () => {
    const k2 = await makeKey('k2');
    let served = [key];
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ keys: served.map((k) => k.jwk) })); };
    await verifyES256(await sign(key, claims()), SUPABASE_URL);
    served = [key, k2];
    assert.equal((await verifyES256(await sign(k2, claims()), SUPABASE_URL)).sub, 'user-1');
    assert.equal(calls, 2);
});

test('verifyES256: unknown kids refresh at most once per window', async () => {
    const calls = stubJwks([key]);
    const stranger = await makeKey('k9');
    const t = await sign(stranger, claims());
    await assert.rejects(verifyES256(t, SUPABASE_URL), { reason: 'signature' });
    await assert.rejects(verifyES256(t, SUPABASE_URL), { reason: 'signature' });
    await assert.rejects(verifyES256(t, SUPABASE_URL), { reason: 'signature' });
    assert.equal(calls(), 2, 'initial load + one throttled miss refresh');
});

test('verifyES256: JWKS outage with a warm cache keeps verifying', async () => {
    stubJwks([key]);
    await verifyES256(await sign(key, claims()), SUPABASE_URL);
    globalThis.fetch = async () => { throw new Error('ECONNRESET'); };
    const stranger = await makeKey('k9');
    // Forced refresh fails → old key map is kept → unknown kid is still a
    // credential problem, not an outage.
    await assert.rejects(verifyES256(await sign(stranger, claims()), SUPABASE_URL), { reason: 'signature' });
    assert.equal((await verifyES256(await sign(key, claims()), SUPABASE_URL)).sub, 'user-1');
});

test('verifyES256: JWKS outage with a cold cache → jwks (503 upstairs)', async () => {
    globalThis.fetch = async () => new Response('down', { status: 502 });
    await assert.rejects(verifyES256(await sign(key, claims()), SUPABASE_URL), { reason: 'jwks' });
    globalThis.fetch = async () => new Response(JSON.stringify({ keys: [] }));
    await assert.rejects(verifyES256(await sign(key, claims()), SUPABASE_URL), { reason: 'jwks' });
});

test('verifyES256: malformed inputs → malformed', async () => {
    stubJwks([key]);
    await assert.rejects(verifyES256('a.b', SUPABASE_URL), { reason: 'malformed' });
    await assert.rejects(verifyES256('!!.b.c', SUPABASE_URL), { reason: 'malformed' });
    await assert.rejects(verifyES256(null, SUPABASE_URL), { reason: 'malformed' });
});

test('validateClaims: happy path', () => {
    assert.equal(validateClaims(claims(), SUPABASE_URL), null);
    assert.equal(validateClaims(claims({ aud: ['authenticated', 'x'] }), SUPABASE_URL), null);
    assert.equal(validateClaims(claims({ is_anonymous: false }), SUPABASE_URL), null);
});

test('validateClaims: issuer / audience / expired / sub / anonymous', () => {
    const now = Math.floor(Date.now() / 1000);
    assert.equal(validateClaims(claims({ iss: 'https://evil.supabase.co/auth/v1' }), SUPABASE_URL), 'issuer');
    assert.equal(validateClaims(claims({ aud: 'anon' }), SUPABASE_URL), 'audience');
    assert.equal(validateClaims(claims({ exp: now - 10 }), SUPABASE_URL, now), 'expired');
    assert.equal(validateClaims(claims({ exp: now - 3 }), SUPABASE_URL, now), null, '5s skew tolerated');
    assert.equal(validateClaims(claims({ exp: 'soon' }), SUPABASE_URL), 'expired');
    assert.equal(validateClaims(claims({ sub: '' }), SUPABASE_URL), 'malformed');
    assert.equal(validateClaims(claims({ is_anonymous: true }), SUPABASE_URL), 'anonymous');
    assert.equal(validateClaims(null, SUPABASE_URL), 'malformed');
});

function req(headers) { return { headers: new Headers(headers) }; }

test('readToken: Bearer header only', () => {
    assert.equal(readToken(req({ authorization: 'Bearer abc' })), 'abc');
    assert.equal(readToken(req({ authorization: 'bearer   abc  ' })), 'abc');
    assert.equal(readToken(req({ authorization: 'Bearer ' })), null);
    assert.equal(readToken(req({ authorization: 'Basic abc' })), null);
    assert.equal(readToken(req({ cookie: 'sb-abcdefgh-auth-token=raw.tok.en' })), null, 'cookies are not a credential');
    assert.equal(readToken(req({})), null);
});
