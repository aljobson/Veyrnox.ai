import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { videoAgentBalanceState } from '../app/veyrnox/_lib/authenticatedMedia.js';

const require = createRequire(import.meta.url);
const plan = { plan_id: 'synthetic-plan', idempotency_key: 'synthetic-plan-key', credits: 165, expires_at: Date.now() / 1000 + 600, brief: 'Synthetic brief', aspect: '9:16', plan: { summary: 'Synthetic shot' } };
function events() {
  const listeners = new Map();
  return {
    visibilityState: 'visible',
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    dispatch(type) { for (const callback of listeners.get(type) || []) callback(); },
    count() { return [...listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0); },
  };
}
function harness() {
  const values = [], refs = [], callbacks = [], effects = [], reads = [];
  let stateIndex = 0, refIndex = 0, callbackIndex = 0, firstRender = true;
  const fakeReact = {
    useState(initial) {
      const index = stateIndex++;
      if (!(index in values)) values[index] = index === 4 ? plan : initial;
      return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next; }];
    },
    useRef(initial) { const index = refIndex++; if (!refs[index]) refs[index] = { current: initial }; return refs[index]; },
    useCallback(callback) { const index = callbackIndex++; if (!callbacks[index]) callbacks[index] = callback; return callbacks[index]; },
    useEffect(callback) { if (firstRender) effects.push(callback); },
  };
  const stubs = {
    react: fakeReact,
    '../../_lib/gateway': { GatewayError: class extends Error {}, gatewayFetch: (path, options = {}) => {
      assert.equal(path, '/balance', 'revalidation must not submit or plan a generation');
      assert.equal(options.method, undefined, 'balance refresh remains a read-only GET');
      let resolve, reject;
      const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
      reads.push({ resolve, reject });
      return promise;
    } },
    '../../_lib/useStudioJobs': { useStudioJobs: () => ({ jobs: [], generating: false }) },
    '../../_lib/authenticatedMedia': { videoAgentBalanceState },
  };
  const source = readFileSync(new URL('../app/veyrnox/app/video-agent/page.js', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const output = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => stubs[id] || (id === 'react/jsx-runtime' ? require(id) : new Proxy({}, { get: () => () => null })), output, output.exports);
  const windowEvents = events(), documentEvents = events();
  const previous = Object.fromEntries(['window', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowEvents });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentEvents });
  function render() { stateIndex = 0; refIndex = 0; callbackIndex = 0; return output.exports.default(); }
  render(); firstRender = false;
  const cleanup = effects[0]();
  return {
    reads, windowEvents, documentEvents, render, cleanup,
    balance: () => values[0], loading: () => values[1],
    restore() { cleanup(); for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } },
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function find(node, predicate) {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== 'object') return null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join(' ');
  return !node || typeof node === 'boolean' ? '' : typeof node === 'object' ? text(node.props?.children) : String(node);
}
const approve = tree => find(tree, node => node.type === 'button' && text(node).startsWith('Approve and make it'));

test('Video Agent refreshes on focus and visible return, blocking approval until the fresh balance arrives', async () => {
  const page = harness();
  try {
    page.reads[0].resolve({ balance: 800 }); await tick();
    assert.equal(approve(page.render()).props.disabled, false);
    page.windowEvents.dispatch('focus');
    assert.equal(page.reads.length, 2);
    assert.equal(page.loading(), true);
    assert.equal(approve(page.render()).props.disabled, true);
    page.reads[1].resolve({ balance: 552 }); await tick();
    assert.equal(page.balance(), 552);
    page.documentEvents.visibilityState = 'hidden'; page.documentEvents.dispatch('visibilitychange');
    assert.equal(page.reads.length, 2, 'background visibility changes do not start balance reads');
    page.documentEvents.visibilityState = 'visible'; page.documentEvents.dispatch('visibilitychange');
    assert.equal(page.reads.length, 3);
    page.reads[2].resolve({ balance: 100 }); await tick();
    assert.equal(page.balance(), 100);
    assert.equal(approve(page.render()).props.disabled, true, 'a newly insufficient balance cannot approve');
  } finally { page.restore(); }
});

test('an older overlapping balance response cannot overwrite a newer insufficient balance', async () => {
  const page = harness();
  try {
    page.windowEvents.dispatch('focus');
    assert.equal(page.reads.length, 2);
    page.reads[1].resolve({ balance: 100 }); await tick();
    page.reads[0].resolve({ balance: 800 }); await tick();
    assert.equal(page.balance(), 100);
    assert.equal(page.loading(), false);
    assert.equal(approve(page.render()).props.disabled, true);
  } finally { page.restore(); }
});

test('latest refresh failure fails closed and cleanup removes events and ignores unresolved reads', async () => {
  const page = harness();
  try {
    page.reads[0].resolve({ balance: 800 }); await tick();
    page.windowEvents.dispatch('veyrnox:balance-changed');
    page.reads[1].reject(new Error('Synthetic unavailable')); await tick();
    assert.equal(page.balance(), null);
    assert.equal(approve(page.render()).props.disabled, true);
    page.windowEvents.dispatch('focus');
    assert.equal(page.reads.length, 3);
    page.cleanup();
    assert.equal(page.windowEvents.count() + page.documentEvents.count(), 0);
    page.windowEvents.dispatch('focus'); page.documentEvents.dispatch('visibilitychange');
    assert.equal(page.reads.length, 3);
    page.reads[2].resolve({ balance: 900 }); await tick();
    assert.equal(page.balance(), null, 'unmounted requests cannot publish stale balance state');
  } finally { page.restore(); }
});
