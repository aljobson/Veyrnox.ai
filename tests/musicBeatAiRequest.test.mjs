import { englishBeatImports } from './helpers/musicBeatI18n.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readPending, definitivelyRefused } from '../app/veyrnox/_lib/music/beat/beatAiPending.mjs';

// Run the production hook with deterministic React effects and gateway responses,
// following musicBeatCloudHooks; storage and submission logic remain real.
let activeRunner, gateway;
globalThis.beatAiHookFixture = {
  useI18n: englishBeatImports['../../../../../components/I18nProvider'].useI18n,
  useRef(value) { const r = activeRunner, i = r.cursor++; return r.slots[i] ||= { current: value }; },
  useState(value) {
    const r = activeRunner, i = r.cursor++;
    if (!(i in r.slots)) r.slots[i] = value;
    return [r.slots[i], next => { r.slots[i] = typeof next === 'function' ? next(r.slots[i]) : next; r.dirty = true; }];
  },
  useEffect(effect, deps) {
    const r = activeRunner, i = r.cursor++, old = r.slots[i];
    if (!old || deps.some((d, n) => d !== old.deps[n]))
      r.effects.push(() => { old?.cleanup?.(); r.slots[i] = { deps, cleanup: effect() }; });
  },
  useCallback(fn, deps) {
    const r = activeRunner, i = r.cursor++, old = r.slots[i];
    if (!old || deps.some((d, n) => d !== old.deps[n])) r.slots[i] = { deps, fn };
    return r.slots[i].fn;
  },
  gatewayFetch: (...args) => gateway(...args), notifyBalanceChanged: () => {},
  loadAiResults: () => assert.fail('No results expected in admission tests'),
};
const exportsByFile = {
  'beat:i18n': ['useI18n'],
  '/react/index.js': ['useRef', 'useState', 'useEffect', 'useCallback'],
  '/gateway.js': ['gatewayFetch', 'notifyBalanceChanged'],
  '/beatAiResults.js': ['loadAiResults'],
};
const hooks = registerHooks({ resolve(specifier, context, next) {
  return specifier.endsWith('/components/I18nProvider') ? { url: 'beat:i18n', shortCircuit: true } : next(specifier, context);
}, load(url, context, next) {
  for (const [suffix, names] of Object.entries(exportsByFile)) if (url.endsWith(suffix))
    return { format: 'module', shortCircuit: true, source: `export const { ${names.join(', ')} } = globalThis.beatAiHookFixture;` };
  return next(url, context);
} });
const { useBeatAiRequest } = await import('../app/veyrnox/_components/music/beat/useBeatAiRequest.js');
hooks.deregister();
const draft = { op: 'generate', source: null, prompt: 'Warm keys', submitPath: '/music/generations',
  placement: { afterTrackId: null, sourceTrackId: null, start: 0, length: 3840, phaseSec: 0, cycle: { start: 0, end: 3840 } } };
async function setup(t) {
  const priorWindow = globalThis.window, priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const data = new Map();
  globalThis.window = new EventTarget();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v) } });
  const beatId = crypto.randomUUID(), calls = [], announcements = [];
  let response = { status: 402, code: 'insufficient_balance' };
  gateway = async (path, init) => {
    calls.push({ path, ...init });
    if (path === '/music/generation-quotes') return { quote_id: crypto.randomUUID(), affordable: true, total_credits: 12 };
    if (path === '/music/generations') throw response;
    assert.fail(`Unexpected request ${path}`);
  };
  const options = { beatId, project: {}, announce: s => announcements.push(s), enabled: true };
  const r = { slots: [], effects: [], cursor: 0, dirty: true,
    render() {
      activeRunner = r; r.cursor = 0; r.dirty = false; r.output = useBeatAiRequest(options);
      for (const effect of r.effects.splice(0)) effect();
    },
  };
  async function settle() {
    for (let i = 0; i < 5; i++) { if (r.dirty) r.render(); await Promise.resolve(); }
  }
  t.after(() => {
    for (const slot of r.slots) slot?.cleanup?.();
    globalThis.window = priorWindow;
    if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage); else delete globalThis.localStorage;
  });
  await settle(); r.output.open({ op: 'generate', prompt: draft.prompt }); await settle();
  return { beatId, calls, announcements, settle, get request() { return r.output; }, refuse: e => { response = e; },
    price: async () => { await r.output.price('/music/generation-quotes', {}, draft); await settle(); },
    send: async () => { await r.output.send(); await settle(); },
  };
}

test('definitive refusal clears record and quote, keeps prompt, allows re-pricing even after eight refusals', async t => {
  const h = await setup(t);
  const codes = ['insufficient_balance', 'plan_unavailable', 'quote_expired', 'quote_already_used', 'quote_stale', 'source_held', 'prompt_blocked', 'idempotency_conflict'];
  for (const code of codes) {
    h.refuse({ status: 409, code }); await h.price();
    assert.ok(h.request.quote, `${code}: next quote can be priced`);
    await h.send();
    assert.deepEqual(readPending(h.beatId), []);
    assert.deepEqual(h.request.pending, []); assert.equal(h.request.record, null); assert.equal(h.request.quote, null);
    assert.equal(h.request.selection.prompt, draft.prompt);
    assert.ok(h.request.error); assert.equal(h.request.message, '');
  }
  await h.price(); assert.ok(h.request.quote); await h.send();
  assert.equal(h.calls.filter(c => c.path === '/music/generations').length, 9);
  assert.deepEqual(readPending(h.beatId), []);
});

test('unknown acknowledgement retains its key on rapid presses and retry', async t => {
  const h = await setup(t);
  for (const error of [{ code: 'network_error' }, { status: 500, code: 'gateway_error' },
    { status: 503, code: 'generation_acceptance_unknown' }, { status: 403, code: 'mfa_required' }, { status: 429, code: 'rate_limited', retryAfter: 60 }]) {
    h.refuse(error); await h.price();
    const before = h.calls.length;
    await Promise.all([h.request.send(), h.request.send()]); await h.settle();
    assert.equal(h.calls.length, before + 1);
    const [record] = readPending(h.beatId); assert.ok(record); assert.equal(h.request.record.key, record.key);
    await h.send();
    assert.equal(JSON.parse(h.calls.at(-1).body).idempotency_key, record.key);
    await h.request.discard(); await h.settle();
  }
});

test('resume and confirmed discard never POST, retire the record and enable the next quote', async t => {
  const h = await setup(t); h.refuse({ code: 'network_error' }); await h.price(); await h.send();
  const [record] = readPending(h.beatId), count = h.calls.length;
  h.request.close(); h.request.resume(record); await h.settle();
  assert.equal(h.calls.length, count);
  await h.request.discard(); await h.settle();
  assert.equal(h.calls.length, count); assert.deepEqual(readPending(h.beatId), []);
  assert.equal(h.request.record, null); assert.equal(h.request.quote, null);
  assert.equal(h.request.selection.prompt, draft.prompt);
  await h.price(); assert.ok(h.request.quote);
});

test('untyped failures and interrupted authentication preserve replay safety', () => {
  for (const error of [{ status: 400 }, { status: 400, code: 'gateway_error' }, { status: 401, code: 'unauthenticated' },
    { status: 409, code: 'account_changed' }, { status: 403, code: 'mfa_required' }, { status: 409, code: 'stem_acceptance_unknown' }])
    assert.equal(definitivelyRefused(error), false);
  assert.equal(definitivelyRefused({ status: 403, code: 'forbidden' }), true);
});

test('resuming an acknowledged request polls GET only; unknown acknowledgement never submits', async t => {
  const h = await setup(t); h.refuse({ code: 'network_error' }); await h.price(); await h.send();
  const [record] = readPending(h.beatId);
  const priorDocument = globalThis.document;
  globalThis.document = { hidden: false };
  t.after(() => { globalThis.document = priorDocument; });
  const calls = [];
  gateway = async (path, init) => { calls.push({ path, method: init?.method || 'GET' }); return { state: 'running' }; };
  h.request.close(); h.request.resume(record); await h.settle();
  assert.deepEqual(calls, []);
  const requestId = crypto.randomUUID();
  h.request.resume({ ...record, requestId, state: 'accepted' }); await h.settle();
  assert.deepEqual(calls, [{ path: `/music/generations/${requestId}`, method: 'GET' }]);
  assert.equal(calls.some(c => c.method === 'POST'), false);
});
