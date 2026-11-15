import test from 'node:test';
import assert from 'node:assert/strict';
import { probeConnection, PROBE_URL } from '../lib/connectionProbe.mjs';

test('any HTTP answer counts as connected, even a 503', async () => {
  let seen;
  const ok = await probeConnection(async (url, init) => { seen = { url, init }; return { ok: false, status: 503 }; });
  assert.equal(ok, true);
  assert.equal(seen.url, PROBE_URL);
  assert.equal(seen.init.cache, 'no-store');
  assert.equal(seen.init.credentials, 'omit');
});

test('a network error counts as offline', async () => {
  assert.equal(await probeConnection(async () => { throw new TypeError('Failed to fetch'); }), false);
});

test('a request that never answers times out as offline', async () => {
  const hang = (_url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  assert.equal(await probeConnection(hang, 20), false);
});
