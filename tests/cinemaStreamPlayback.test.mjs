import test from 'node:test';
import assert from 'node:assert/strict';
import { playbackConfig, signStreamPlayback, PLAYBACK_TTL_SECONDS } from '../lib/cinema/stream.js';

const uid = 'c'.repeat(32);
const keyId = 'd'.repeat(32);
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

test('playback config requires a key id, an RSA private JWK and a customer code', async () => {
  const { privateKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = btoa(JSON.stringify(await crypto.subtle.exportKey('jwk', privateKey)));
  const good = { CINEMA_STREAM_SIGNING_KEY_ID: keyId, CINEMA_STREAM_SIGNING_JWK: jwk, CINEMA_STREAM_CUSTOMER_CODE: 'abc123' };
  assert.equal(playbackConfig(good).customerCode, 'abc123');
  for (const patch of [{ CINEMA_STREAM_SIGNING_KEY_ID: '' }, { CINEMA_STREAM_SIGNING_KEY_ID: 'no spaces here' }, { CINEMA_STREAM_SIGNING_JWK: 'not-base64-json' },
    { CINEMA_STREAM_SIGNING_JWK: btoa('{"kty":"EC"}') }, { CINEMA_STREAM_SIGNING_JWK: btoa('{"kty":"RSA","n":"public-only"}') }, { CINEMA_STREAM_CUSTOMER_CODE: 'Bad/Code' }]) {
    assert.equal(playbackConfig({ ...good, ...patch }), null, JSON.stringify(patch));
  }
});

test('a token is RS256 over one video uid and never outlives fifteen minutes', async () => {
  const { privateKey, publicKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const cfg = { keyId, jwk: await crypto.subtle.exportKey('jwk', privateKey), customerCode: 'abc123' };
  const now = Math.floor(Date.now() / 1000);
  const exp = now + PLAYBACK_TTL_SECONDS;
  const token = await signStreamPlayback(uid, cfg, exp);
  const [h, p, s] = token.split('.');
  assert.deepEqual(JSON.parse(new TextDecoder().decode(fromB64url(h))), { alg: 'RS256', kid: keyId });
  const payload = JSON.parse(new TextDecoder().decode(fromB64url(p)));
  assert.equal(payload.sub, uid);
  assert.equal(payload.kid, keyId);
  assert.equal(payload.exp, exp);
  assert.ok(payload.exp - now <= 900);
  assert.ok(payload.nbf < now);
  assert.equal(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, fromB64url(s), new TextEncoder().encode(`${h}.${p}`)), true);
  assert.ok(!token.includes(cfg.jwk.d));
  await assert.rejects(signStreamPlayback('short', cfg, exp), /invalid_stream_uid/);
  await assert.rejects(signStreamPlayback(uid, cfg, 1.5), /invalid_expiry/);
});
