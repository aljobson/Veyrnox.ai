import test from 'node:test';
import assert from 'node:assert/strict';

// authClient.js runs at import (mfaStepUpWait imports it); give it the globals it reads,
// like authClientRefresh.test.mjs. waitForStepUp takes injected deps, so these defaults
// are never called — the import just has to load cleanly.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://abcdefgh.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { waitForStepUp, StepUpWaitError } = await import('../app/lib/mfaStepUpWait.js');

function harness({ aal = 'aal1', user = 'A' } = {}) {
  const listeners = new Set();
  const state = { aal, user };
  const deps = {
    getAal: () => state.aal,
    getStoredUserId: () => state.user,
    onSessionChange: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
  };
  return { deps, state, fire: () => { for (const cb of [...listeners]) cb(); }, open: () => listeners.size };
}
const rejectsWith = (code) => (err) => err instanceof StepUpWaitError && err.code === code;

test('resolves immediately at aal2 without subscribing', async () => {
  const h = harness({ aal: 'aal2' });
  await waitForStepUp({ ...h.deps, timeoutMs: 10_000 });
  assert.equal(h.open(), 0);
});

test('rejects immediately when already signed out, without subscribing', async () => {
  const h = harness({ user: null });
  await assert.rejects(waitForStepUp({ ...h.deps, timeoutMs: 10_000 }), rejectsWith('mfa_abandoned'));
  assert.equal(h.open(), 0);
});

test('resolves when the session reaches aal2, then unsubscribes', async () => {
  const h = harness();
  const p = waitForStepUp({ ...h.deps, timeoutMs: 10_000 });
  assert.equal(h.open(), 1);
  h.state.aal = 'aal2'; h.fire();
  await p;
  assert.equal(h.open(), 0);
});

test('a same-account aal1 churn fire (cross-tab hydration / token refresh) keeps waiting, not abandons', async () => {
  const h = harness();
  const p = waitForStepUp({ ...h.deps, timeoutMs: 10_000 });
  h.fire();                 // still aal1, same stored user — must NOT reject
  assert.equal(h.open(), 1);
  h.state.aal = 'aal2'; h.fire();
  await p;
  assert.equal(h.open(), 0);
});

test('rejects as abandoned on real sign-out (stored id gone)', async () => {
  const h = harness();
  const p = waitForStepUp({ ...h.deps, timeoutMs: 10_000 });
  h.state.user = null; h.fire();
  await assert.rejects(p, rejectsWith('mfa_abandoned'));
  assert.equal(h.open(), 0);
});

test('rejects as abandoned when a different account takes over the tab', async () => {
  const h = harness();
  const p = waitForStepUp({ ...h.deps, timeoutMs: 10_000 });
  h.state.user = 'B'; h.fire();
  await assert.rejects(p, rejectsWith('mfa_abandoned'));
  assert.equal(h.open(), 0);
});

test('rejects as timeout when aal2 never arrives, then unsubscribes', async () => {
  const h = harness();
  await assert.rejects(waitForStepUp({ ...h.deps, timeoutMs: 5 }), rejectsWith('mfa_timeout'));
  assert.equal(h.open(), 0);
});

test('rejects immediately when the caller already aborted, without subscribing', async () => {
  const h = harness();
  const c = new AbortController(); c.abort();
  await assert.rejects(waitForStepUp({ ...h.deps, signal: c.signal, timeoutMs: 10_000 }), rejectsWith('mfa_aborted'));
  assert.equal(h.open(), 0);
});

test('an abort mid-wait rejects and releases the listener and timer at once', async () => {
  const h = harness();
  const c = new AbortController();
  const p = waitForStepUp({ ...h.deps, signal: c.signal, timeoutMs: 10_000 });
  assert.equal(h.open(), 1);
  c.abort();
  await assert.rejects(p, rejectsWith('mfa_aborted'));
  assert.equal(h.open(), 0);
});
