import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
const { GET } = await import('../app/api/catalog/route.js');
test('/api/catalog?template_swap_row=1 with the swap switch off answers an empty row, anonymously and without touching storage', async t => {
  for (const key of ['TEMPLATE_SWAP_CLIP_ENABLED', 'MULTI_REFERENCE_ENABLED', 'APP_RUNTIME_FLAGS']) delete process.env[key];
  t.mock.method(globalThis, 'fetch', async () => assert.fail('no network while the switch is off'));
  const response = await GET({ url: 'https://site.test/api/catalog?template_swap_row=1', get headers() { assert.fail('identity read'); } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [] });
  assert.equal(response.headers.get('cache-control'), 'public, max-age=30, s-maxage=60');
});
