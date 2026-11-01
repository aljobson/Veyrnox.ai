import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apiErrorDetails } from '../app/lib/apiErrorDetails.js';

// Same injection harness as gatewayLimit.test.mjs: strip imports/exports and supply deps,
// here including a scripted fetch queue and an injectable waitForStepUp (ADR-0308 MFA-02).
const source = readFileSync(new URL('../app/veyrnox/_lib/gateway.js', import.meta.url), 'utf8')
  .replace(/^import .*;$/gm, '').replace(/^export /gm, '');

function load({ responses, waitForStepUp, session = { access_token: 'aal1-token', user: { id: 'alice' } } }) {
  const requests = [];
  let waited = 0;
  const stubs = {
    getFreshAccessToken: async () => session?.access_token,
    getSession: () => session, clearSession() {}, getSelectedSocialBrand: () => null,
    setSelectedSocialBrand() {}, assertSocialBrandSnapshot() {},
    captureOperationalError() {}, normaliseGatewayPath: p => p, apiErrorDetails,
    waitForStepUp: async (...a) => { waited++; return waitForStepUp(...a); },
    fetch: async (url, init) => { requests.push({ url, init }); return responses.shift(); },
  };
  const gateway = new Function(...Object.keys(stubs), source + '\nreturn { gatewayFetch, GatewayError };')(...Object.values(stubs));
  return { ...gateway, requests, waited: () => waited };
}
const mfa403 = () => Response.json({ error: 'mfa_required' }, { status: 403 });
const ok = (body) => Response.json(body, { status: 200 });

test('a GET refused mfa_required waits for step-up then retries once and returns data', async () => {
  const g = load({ responses: [mfa403(), ok({ jobs: [] })], waitForStepUp: async () => {} });
  assert.deepEqual(await g.gatewayFetch('/jobs'), { jobs: [] });
  assert.equal(g.requests.length, 2);
  assert.equal(g.waited(), 1);
  // The retry carries the Bearer (re-fetched token).
  assert.equal(g.requests[1].init.headers.Authorization, 'Bearer aal1-token');
});

test('an abandoned step-up (waitForStepUp rejects) throws mfa_required and does not retry', async () => {
  const g = load({ responses: [mfa403()], waitForStepUp: async () => { throw new Error('mfa_abandoned'); } });
  await assert.rejects(g.gatewayFetch('/jobs'), e => e.name === 'GatewayError' && e.status === 403 && e.code === 'mfa_required');
  assert.equal(g.requests.length, 1);
  assert.equal(g.waited(), 1);
});

test('mfa_required on the retry does not loop — exactly one wait and one retry', async () => {
  const g = load({ responses: [mfa403(), mfa403()], waitForStepUp: async () => {} });
  await assert.rejects(g.gatewayFetch('/jobs'), e => e.status === 403 && e.code === 'mfa_required');
  assert.equal(g.requests.length, 2);
  assert.equal(g.waited(), 1);
});

test('after step-up, a retry that finds a different account is refused, not delivered to the original caller', async () => {
  const session = { access_token: 'aal1-token', user: { id: 'alice' } };
  // The wait "completes" but the session has meanwhile hydrated a different account.
  const g = load({ responses: [mfa403(), ok({ jobs: ['mallory-data'] })], session,
    waitForStepUp: async () => { session.user = { id: 'mallory' }; } });
  await assert.rejects(g.gatewayFetch('/jobs'), e => e.status === 409 && e.code === 'account_changed');
});

test('an /admin GET refused mfa_required throws at once and never waits — the admin inline step-up drives it', async () => {
  const g = load({ responses: [mfa403()], waitForStepUp: async () => assert.fail('must not wait on an admin route') });
  await assert.rejects(g.gatewayFetch('/admin/security'), e => e.status === 403 && e.code === 'mfa_required');
  assert.equal(g.requests.length, 1);
  assert.equal(g.waited(), 0);
});

test('a non-mfa 403 throws as before and never waits', async () => {
  const g = load({ responses: [Response.json({ error: 'forbidden' }, { status: 403 })], waitForStepUp: async () => assert.fail('must not wait') });
  await assert.rejects(g.gatewayFetch('/jobs'), e => e.status === 403);
  assert.equal(g.requests.length, 1);
  assert.equal(g.waited(), 0);
});

test('a mutation (POST) refused mfa_required throws as before and never waits (no blind replay)', async () => {
  const g = load({ responses: [mfa403()], waitForStepUp: async () => assert.fail('must not wait on a mutation') });
  await assert.rejects(g.gatewayFetch('/jobs', { method: 'POST', body: '{}' }), e => e.status === 403 && e.code === 'mfa_required');
  assert.equal(g.requests.length, 1);
  assert.equal(g.waited(), 0);
});
