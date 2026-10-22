import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The gateway is plain JS: inject auth/fetch dependencies without a browser or JSX loader.
const source = readFileSync(new URL('../app/veyrnox/_lib/gateway.js', import.meta.url), 'utf8').replace(/^import .*;$/gm, '').replace(/^export /gm, '');
function load(response, session = { access_token: 'test', user: { id: 'alice' } }) {
  let calls = 0;
  const stubs = {
    getFreshAccessToken: async () => session?.access_token,
    getSession: () => session, clearSession() {}, getSelectedSocialBrand: () => null,
    setSelectedSocialBrand() {}, assertSocialBrandSnapshot() {}, captureOperationalError() {}, normaliseGatewayPath: p => p,
    apiErrorDetails: () => ({ code: 'other', message: 'other' }),
    fetch: async () => { calls++; return response; },
  };
  const gateway = new Function(...Object.keys(stubs), source + '\nreturn { gatewayFetch, GatewayError };')(...Object.values(stubs));
  return { ...gateway, calls: () => calls };
}
test('plain, unknown, non-JSON and oversized 429 bodies retain throttle semantics', async () => {
  for (const text of ['', 'not json', JSON.stringify({ error: 'LIMIT_REACHED' }), JSON.stringify({ error: { code: 'RATE_LIMITED' } }), JSON.stringify({ error: { code: 'LIMIT_REACHED' }, padding: 'x'.repeat(4096) })]) {
    const { gatewayFetch, GatewayError } = load(new Response(text, { status: 429, headers: { 'retry-after': '23' } }));
    await assert.rejects(gatewayFetch('/film-studio'), err => err instanceof GatewayError && err.status === 429 && err.code === 'rate_limited' && err.retryAfter === 23);
  }
});
test('only bounded LIMIT_REACHED maps to limit_reached with the original retryAfter', async () => {
  const { gatewayFetch } = load(new Response(JSON.stringify({ error: { code: 'LIMIT_REACHED' } }), { status: 429, headers: { 'retry-after': '60' } }));
  await assert.rejects(gatewayFetch('/film-studio'), err => err.code === 'limit_reached' && err.status === 429 && err.retryAfter === 60);
});
test('signed-out gateway never sends a request', async () => {
  const gateway = load(null, null);
  await assert.rejects(gateway.gatewayFetch('/film-studio'), err => err.status === 401); assert.equal(gateway.calls(), 0);
});
