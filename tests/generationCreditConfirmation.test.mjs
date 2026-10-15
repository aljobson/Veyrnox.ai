import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

Object.assign(process.env, {
  SUPABASE_URL: 'https://db.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service',
  KIE_API_KEY: 'test-kie',
  KIE_WEBHOOK_HMAC_KEY: 'test-hmac',
  PUBLIC_HOST: 'https://veyrnox.test',
});

const { POST } = await import('../app/api/v1/generations/route.js');
const AUTH = '11111111-1111-4111-8111-111111111111';

function request(confirmedCredits) {
  return new Request('https://veyrnox.test/api/v1/generations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-veyrnox-auth-id': AUTH },
    body: JSON.stringify({
      model_id: 'flux-2-pro-1k-kie',
      idempotency_key: 'mcp-confirmation-test',
      confirmed_credits: confirmedCredits,
      inputs: { prompt: 'A copper robot reading under a tree' },
    }),
  });
}

test('an outdated MCP credit confirmation is rejected before user lookup or debit', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    if (path.endsWith('/rpc/check_generation_rate_limit')) return Response.json({ ok: true });
    if (path === '/rest/v1/model_catalog') return Response.json([{
      id: 'flux-2-pro-1k-kie', provider: 'kie', provider_endpoint: 'market:flux-2/pro-text-to-image',
      modality: 'text-to-image', credits_5s: 7, active: true, gated_flag: false,
    }]);
    assert.fail(`request escaped the confirmation gate: ${path}`);
  });

  const response = await POST(request(2));
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: 'credit_confirmation_mismatch',
    confirmed_credits: 2,
    expected_credits: 7,
  });
  assert.deepEqual(calls, ['/rest/v1/rpc/check_generation_rate_limit', '/rest/v1/model_catalog']);
});

test('a malformed credit confirmation is refused before the rate limiter', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => assert.fail('network must not run'));
  const response = await POST(request(-1));
  assert.deepEqual([response.status, await response.json()], [400, { error: 'confirmed_credits_invalid' }]);
  assert.equal(fetch.mock.callCount(), 0);
});
