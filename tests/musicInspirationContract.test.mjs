import assert from 'node:assert/strict';
import test from 'node:test';
import {
  issueMusicInspirationReceipt, parseMusicInspirationRequest, parseMusicInspirationResult,
  sha256Hex, verifyMusicInspirationReceipt,
} from '../lib/musicInspiration.js';

const AUTH = '11111111-1111-4111-8111-111111111111';
const ANALYSIS = '22222222-2222-4222-8222-222222222222';
const request = { kind: 'audio', key: `${AUTH}/song.mp3`, rights_confirmed: true, idempotency_key: 'aaaaaaaa' };

test('audio and image inspiration requests are exact and rights-bound', () => {
  assert.equal(parseMusicInspirationRequest(request).ok, true);
  assert.deepEqual(parseMusicInspirationRequest({ ...request, kind: 'image' }), { ok: true, kind: 'image', key: request.key, idempotencyKey: 'aaaaaaaa' });
  for (const value of [{ ...request, extra: true }, { ...request, kind: 'video_frames' }, { ...request, rights_confirmed: false },
    { ...request, idempotency_key: 'short' }]) assert.equal(parseMusicInspirationRequest(value).ok, false);
});

test('provider result is strict and bounded', () => {
  assert.deepEqual(parseMusicInspirationResult({ safe: true, brief: 'Warm analog pulse', tags: ['analog', 'midtempo'] }),
    { ok: true, safe: true, brief: 'Warm analog pulse', tags: ['analog', 'midtempo'] });
  for (const value of [{ safe: true, brief: 'x', tags: [], extra: true }, { safe: 'yes', brief: 'x', tags: [] },
    { safe: true, brief: '', tags: [] }, { safe: true, brief: 'x', tags: ['same', 'same'] },
    { safe: true, brief: 'x'.repeat(501), tags: [] }]) assert.equal(parseMusicInspirationResult(value).ok, false);
});

test('receipt is owner-bound, constant-time verified and expires without renewal', async () => {
  const secret = 'receipt-secret-that-is-at-least-32-bytes';
  const fields = { authId: AUTH, analysisId: ANALYSIS, requestDigest: 'r'.repeat(64), contentDigest: 'c'.repeat(64),
    resultDigest: 'o'.repeat(64), issuedAt: 100, expiresAt: 200 };
  const token = await issueMusicInspirationReceipt(fields, secret);
  assert.equal((await verifyMusicInspirationReceipt(token, AUTH, secret, 150))?.aid, ANALYSIS);
  assert.equal(await verifyMusicInspirationReceipt(token, '33333333-3333-4333-8333-333333333333', secret, 150), null);
  assert.equal(await verifyMusicInspirationReceipt(token, AUTH, secret, 201), null);
  assert.equal(await verifyMusicInspirationReceipt(`${token}x`, AUTH, secret, 150), null);
  assert.equal(await sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
