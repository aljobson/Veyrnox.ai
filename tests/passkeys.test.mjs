import test from 'node:test';
import assert from 'node:assert/strict';

// The module is browser code but its encoders are pure, so they import and run
// under node. Only `atob`/`btoa` are needed, and node has had both since 16.
const { fromB64url, decodeOptions, encodeCredential, signInBody } = await import('../app/lib/passkeys.js');

const bytes = (...n) => new Uint8Array(n);
const toB64url = (u8) => Buffer.from(u8).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

test('base64url decoding round-trips every padding length', () => {
    // 0, 1 and 2 bytes of padding — the case that breaks a naive atob() call.
    for (const len of [1, 2, 3, 4, 5, 32, 64]) {
        const original = Uint8Array.from({ length: len }, (_, i) => (i * 37) % 256);
        assert.deepEqual(fromB64url(toB64url(original)), original, `length ${len}`);
    }
});

test('base64url decoding handles the - and _ alphabet', () => {
    // 0xFB 0xFF encodes to "+/" in standard base64 and "-_" in base64url.
    assert.deepEqual(fromB64url('-_8'), bytes(251, 255));
});

test('decodeOptions turns exactly the WebAuthn buffer fields into bytes', () => {
    const decoded = decodeOptions({
        challenge: toB64url(bytes(1, 2, 3)),
        rp: { id: 'veyrnox.ai', name: 'Veyrnox' },
        user: { id: toB64url(bytes(9, 9)), name: 'a@b.c', displayName: 'A' },
        excludeCredentials: [{ id: toB64url(bytes(7)), type: 'public-key' }],
        timeout: 60000,
    });
    assert.ok(decoded.challenge instanceof Uint8Array);
    assert.deepEqual(decoded.challenge, bytes(1, 2, 3));
    assert.deepEqual(decoded.user.id, bytes(9, 9));
    assert.deepEqual(decoded.excludeCredentials[0].id, bytes(7));
    // Non-buffer fields must survive untouched, including the rp id that
    // every passkey is cryptographically bound to.
    assert.equal(decoded.rp.id, 'veyrnox.ai');
    assert.equal(decoded.user.name, 'a@b.c');
    assert.equal(decoded.timeout, 60000);
});

test('decodeOptions decodes allowCredentials on the sign-in ceremony', () => {
    const decoded = decodeOptions({
        challenge: toB64url(bytes(5)),
        allowCredentials: [{ id: toB64url(bytes(1, 2)), type: 'public-key' }],
    });
    assert.deepEqual(decoded.allowCredentials[0].id, bytes(1, 2));
});

test('decodeOptions tolerates a discoverable-credential ceremony with no lists', () => {
    const decoded = decodeOptions({ challenge: toB64url(bytes(1)) });
    assert.deepEqual(decoded.challenge, bytes(1));
    assert.equal(decoded.allowCredentials, undefined);
});

const credential = (response, extra = {}) => ({
    id: 'cred-id',
    rawId: bytes(1, 2, 3).buffer,
    type: 'public-key',
    getClientExtensionResults: () => ({}),
    response,
    ...extra,
});

test('a registration credential sends attestation and no signature', () => {
    const out = encodeCredential(credential({
        clientDataJSON: bytes(10).buffer,
        attestationObject: bytes(20).buffer,
    }));
    assert.equal(out.id, 'cred-id');
    assert.equal(out.rawId, toB64url(bytes(1, 2, 3)));
    assert.equal(out.response.attestationObject, toB64url(bytes(20)));
    // Sending authentication fields on a registration is how verification
    // fails with an error that names none of this.
    assert.equal(out.response.signature, undefined);
    assert.equal(out.response.authenticatorData, undefined);
});

test('an authentication credential sends signature and no attestation', () => {
    const out = encodeCredential(credential({
        clientDataJSON: bytes(10).buffer,
        authenticatorData: bytes(30).buffer,
        signature: bytes(40).buffer,
        userHandle: bytes(50).buffer,
    }));
    assert.equal(out.response.signature, toB64url(bytes(40)));
    assert.equal(out.response.authenticatorData, toB64url(bytes(30)));
    assert.equal(out.response.userHandle, toB64url(bytes(50)));
    assert.equal(out.response.attestationObject, undefined);
});

test('an absent userHandle is omitted rather than sent as null', () => {
    const out = encodeCredential(credential({
        clientDataJSON: bytes(10).buffer,
        authenticatorData: bytes(30).buffer,
        signature: bytes(40).buffer,
        userHandle: null,
    }));
    assert.ok(!('userHandle' in out.response));
});

test('authenticatorAttachment rides along only when the browser reports it', () => {
    const base = { clientDataJSON: bytes(1).buffer, attestationObject: bytes(2).buffer };
    assert.equal(encodeCredential(credential(base)).authenticatorAttachment, undefined);
    assert.equal(
        encodeCredential(credential(base, { authenticatorAttachment: 'platform' })).authenticatorAttachment,
        'platform',
    );
});

test('the sign-in challenge carries the Turnstile token GoTrue demands', () => {
    // Confirmed against the live project: this endpoint is captcha-gated
    // because it is a sign-in. Omitting the token fails with captcha_failed
    // before any WebAuthn prompt, which presents as a dead button.
    assert.deepEqual(signInBody('tok-123'), {
        gotrue_meta_security: { captcha_token: 'tok-123' },
    });
});

test('no token means no captcha envelope, for projects with it switched off', () => {
    assert.deepEqual(signInBody(undefined), {});
});
