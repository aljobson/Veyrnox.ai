import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

Object.assign(process.env, {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service',
  PUBLIC_HOST: 'https://veyrnox.test',
});

const { POST } = await import('../app/api/v1/generations/route.js');
const AUTH = '11111111-1111-4111-8111-111111111111';

test('Music-only models cannot bypass the durable Music generation endpoint', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => assert.fail('Music refusal must happen before any database, debit or provider call'));

  for (const modelId of ['ace-step', 'ace-step-1.5']) {
    const response = await POST(new Request('https://veyrnox.test/api/v1/generations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-veyrnox-auth-id': AUTH },
      body: JSON.stringify({
        model_id: modelId,
        idempotency_key: `music-generic-${modelId}`,
        inputs: { prompt: 'A stadium anthem' },
      }),
    }));

    assert.deepEqual([response.status, await response.json()], [409, { error: 'music_generation_required' }], modelId);
  }

  assert.equal(fetch.mock.callCount(), 0);
});
