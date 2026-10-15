import test from 'node:test';
import assert from 'node:assert/strict';
import { authCallbackUrl, safeAuthReturnPath } from '../app/lib/authReturn.js';

test('auth returns preserve an internal OAuth consent request', () => {
  assert.equal(
    safeAuthReturnPath('/oauth/consent?authorization_id=request-123'),
    '/oauth/consent?authorization_id=request-123',
  );
  assert.equal(
    authCallbackUrl('/oauth/consent?authorization_id=request-123', 'https://veyrnox.test'),
    'https://veyrnox.test/auth/callback?next=%2Foauth%2Fconsent%3Fauthorization_id%3Drequest-123',
  );
});

test('auth returns cannot leave the Veyrnox origin', () => {
  for (const value of [null, '', 'https://evil.test', '//evil.test/path', '/\\evil.test/path']) {
    assert.equal(safeAuthReturnPath(value), null, String(value));
  }
});
