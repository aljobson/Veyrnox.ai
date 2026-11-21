import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apiErrorDetails } from '../app/lib/apiErrorDetails.js';

// Same injection harness as gatewayMfaRecovery.test.mjs, with a fetch that stays open until released.
const source = readFileSync(new URL('../app/veyrnox/_lib/gateway.js', import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '').replace(/^export /gm, '');

function load({ session = { access_token: 't', user: { id: 'alice' } } } = {}) {
  const requests = []; const gates = [];
  const events = new EventTarget();
  const stubs = {
    window: events,
    getFreshAccessToken: async () => session?.access_token,
    getSession: () => session, clearSession() {}, getSelectedSocialBrand: () => null,
    setSelectedSocialBrand() {}, assertSocialBrandSnapshot() {},
    captureOperationalError() {}, normaliseGatewayPath: p => p, apiErrorDetails, waitForStepUp: async () => {},
    fetch: (url, init) => new Promise(resolve => { requests.push({ url, init }); gates.push(() => resolve(Response.json({ n: requests.length, list: [1] }))); }),
  };
  const g = new Function(...Object.keys(stubs), source + '\nreturn { gatewayFetch };')(...Object.values(stubs));
  const settle = async () => { await new Promise(r => setTimeout(r, 5)); };
  return { ...g, requests, release: async (i = 0) => { await settle(); gates[i](); await settle(); }, events, settle, session };
}

test('two identical plain reads in flight make one request and each gets its own copy', async () => {
  const g = load();
  const a = g.gatewayFetch('/account'); const b = g.gatewayFetch('/account');
  await g.release();
  const [x, y] = await Promise.all([a, b]);
  assert.equal(g.requests.length, 1);
  assert.deepEqual(x, y);
  x.list.push(2);
  assert.deepEqual(y.list, [1], 'a caller changing its body must not change the other');
});

test('different paths, writes, and reads with options are not shared', async () => {
  const g = load();
  const calls = [g.gatewayFetch('/account'), g.gatewayFetch('/balance'),
    g.gatewayFetch('/account', { signal: new AbortController().signal }), g.gatewayFetch('/account', { method: 'PUT', body: '{}' })];
  await g.settle();
  assert.equal(g.requests.length, 4);
  for (let i = 0; i < 4; i++) await g.release(i);
  await Promise.all(calls);
});

test('a read made after the first finished is a new request', async () => {
  const g = load();
  const first = g.gatewayFetch('/account'); await g.release(0); await first;
  const second = g.gatewayFetch('/account'); await g.release(1); await second;
  assert.equal(g.requests.length, 2);
});

test('a balance-changed event stops later reads joining a request that began before it', async () => {
  const g = load();
  const before = g.gatewayFetch('/balance'); await g.settle();
  g.events.dispatchEvent(new Event('veyrnox:balance-changed'));
  const after = g.gatewayFetch('/balance'); await g.settle();
  assert.equal(g.requests.length, 2);
  await g.release(0); await g.release(1); await Promise.all([before, after]);
});

test('another account never joins a read', async () => {
  const g = load();
  const a = g.gatewayFetch('/account'); a.catch(() => {}); await g.settle();
  g.session.user = { id: 'bob' };
  const b = g.gatewayFetch('/account'); b.catch(() => {}); await g.settle();
  assert.equal(g.requests.length, 2);
  await g.release(0); await g.release(1);
  await Promise.allSettled([a, b]);
});
