import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/auth/mobile/route.js';

const call = (query) => GET(new Request(`https://veyrnox.test/auth/mobile${query}`));

test('the mobile bridge forwards a sign-in code to the app and nothing else', () => {
  const res = call('?code=abc123_DEF-456&next=https://evil.test&state=x');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'ai.veyrnox.app://auth/callback?code=abc123_DEF-456');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
});

test('the mobile bridge forwards a short error word', () => {
  assert.equal(call('?error=access_denied').headers.get('location'), 'ai.veyrnox.app://auth/callback?error=access_denied');
});

test('the mobile bridge refuses odd input with a fixed error', () => {
  for (const query of ['', '?code=x', '?code=a b c d e f g h', '?code=%0d%0aSet-Cookie:x1234', '?error=<script>', `?code=${'a'.repeat(600)}`]) {
    const res = call(query);
    assert.equal(res.status, 302, query);
    assert.equal(res.headers.get('location'), 'ai.veyrnox.app://auth/callback?error=invalid_request', query);
  }
});
