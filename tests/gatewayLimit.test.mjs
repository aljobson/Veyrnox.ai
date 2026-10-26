import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apiErrorDetails } from '../app/lib/apiErrorDetails.js';

// The gateway is plain JS: inject auth/fetch dependencies without a browser or JSX loader.
const source = readFileSync(new URL('../app/veyrnox/_lib/gateway.js', import.meta.url), 'utf8').replace(/^import .*;$/gm, '').replace(/^export /gm, '');
function load(response, session = { access_token: 'test', user: { id: 'alice' } }) {
  let calls = 0;
  const telemetry = [], requests = [];
  const stubs = {
    getFreshAccessToken: async () => session?.access_token,
    getSession: () => session, clearSession() {}, getSelectedSocialBrand: () => null,
    setSelectedSocialBrand() {}, assertSocialBrandSnapshot() {}, captureOperationalError: (...args) => telemetry.push(args), normaliseGatewayPath: p => p,
    apiErrorDetails,
    fetch: async (...args) => { calls++; requests.push(args); return response; },
  };
  const gateway = new Function(...Object.keys(stubs), source + '\nreturn { gatewayFetch, GatewayError };')(...Object.values(stubs));
  return { ...gateway, calls: () => calls, telemetry, requests };
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

test('uploads preserve budget and admission refusals instead of generic rate mapping', async () => {
  for (const [status, error] of [[429, 'upload_budget_exceeded'], [429, 'too_many_pending_uploads'], [503, 'upload_admission_unavailable']]) {
    const { gatewayFetch } = load(Response.json({ error }, { status }));
    await assert.rejects(gatewayFetch('/uploads', { method: 'POST', preserveUploadErrors: true }), e => e.code === error && e.body.error === error && e.status === status);
  }
});

test('ordinary uploads retain the exact default gateway errors, retry headers and telemetry', async () => {
  for (const [status, body] of [
    [429, { error: 'upload_budget_exceeded' }], [429, { error: { code: 'LIMIT_REACHED' } }],
    [503, { error: 'service_unavailable' }], [503, { error: 'upload_admission_unavailable' }],
    [500, { error: 'internal' }], [502, { error: { code: 'upstream', message: 'Unavailable' } }],
    [400, { error: 123 }], [403, { error: 'forbidden' }], [401, { error: 'unauthenticated' }],
  ]) {
    const observe = async (path, init) => {
      const g = load(Response.json(body, { status, headers: { 'retry-after': '23' } }));
      let result;
      try { await g.gatewayFetch(path, init); } catch (error) {
        result = JSON.stringify({ name: error.name, message: error.message, ...error });
      }
      return { result, telemetry: g.telemetry.map(([event, data]) => [event, { ...data, route: '/uploads' }]) };
    };
    const expected = await observe('/ordinary', { method: 'POST' });
    assert.deepEqual(await observe('/uploads', { method: 'POST' }), expected);
    assert.deepEqual(await observe('/uploads', { method: 'POST', preserveUploadErrors: false }), expected);
    if (status >= 500 && body.error !== 'service_unavailable') assert.equal(expected.telemetry[0][0], 'gateway_server_error');
    if (body.error === 'service_unavailable') assert.equal(JSON.parse(expected.result).retryAfter, 23);
  }
});

test('upload opt-in cannot leak a non-string code or become a fetch option', async () => {
  for (const error of [{ code: 'nested' }, 123, null, '']) {
    const g = load(Response.json({ error }, { status: 503 }));
    await assert.rejects(g.gatewayFetch('/uploads', { preserveUploadErrors: true }), e => e.code === 'upload_failed');
    assert.equal(Object.hasOwn(g.requests[0][1], 'preserveUploadErrors'), false);
  }
  const g = load(Response.json({ error: 'upload_budget_exceeded' }, { status: 429 }));
  await assert.rejects(g.gatewayFetch('/other', { preserveUploadErrors: true }), e => e.code === 'rate_limited');
});
