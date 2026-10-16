import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
function load(path, stubs = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', code)(id => stubs[id] || require(id), output, output.exports);
  return output.exports;
}

test('the inline editor launcher retains the same accessible toggle state and focus ref', () => {
  const { EditorHelperLauncher } = load('app/veyrnox/_components/editor/EditorHelperLauncher.js');
  const host = { nodeType: 1 }, launcherRef = { current: null }; let toggles = 0;
  for (const open of [false, true]) {
    const portal = EditorHelperLauncher({ host, open, launcherRef, onToggle: () => { toggles++; } });
    assert.equal(portal.containerInfo, host);
    const button = portal.children;
    assert.equal(button.type, 'button'); assert.equal(button.props.type, 'button');
    assert.equal(button.props['aria-label'], open ? 'Close Veyrnox helper' : 'Ask Veyrnox helper');
    assert.equal(button.props['aria-expanded'], open); assert.equal(button.props.ref, launcherRef);
    assert.equal(button.props.children, open ? 'Close Vey' : 'Ask Vey');
    assert.match(button.props.className, /min-h-11/); button.props.onClick();
  }
  assert.equal(toggles, 2);
  assert.equal(EditorHelperLauncher({ host: null, open: false }), null);
});

test('the editor advertises its portal host only after its own hydration and cancels unmounted readiness', () => {
  let ready = false, effect;
  const tasks = [];
  const fakeReact = {
    useState: initial => [ready || initial, next => { ready = next; }],
    useEffect: callback => { effect = callback; },
  };
  const { EditorHelperHost } = load('app/veyrnox/_components/editor/EditorHelperLauncher.js', { react: fakeReact });
  assert.equal(typeof EditorHelperHost, 'function');
  const previous = globalThis.queueMicrotask;
  globalThis.queueMicrotask = task => { tasks.push(task); };
  try {
    const initial = EditorHelperHost();
    assert.equal(initial.props['data-vey-editor-helper'], undefined);
    assert.equal(initial.props.children, false, 'SSR and first hydration must have no advertised portal target');
    const cleanup = effect();
    assert.equal(ready, false, 'readiness waits for the editor commit');
    tasks.shift()();
    const hydrated = EditorHelperHost();
    assert.equal(hydrated.props.children.type, 'div');
    assert.equal(hydrated.props.children.props['data-vey-editor-helper'], true);
    cleanup();
    ready = false;
    EditorHelperHost();
    const cancelled = effect();
    cancelled(); tasks.shift()();
    assert.equal(ready, false, 'a removed editor must not advertise a stale host');
  } finally { globalThis.queueMicrotask = previous; }
});

test('the workspace uses the hydration-owned host instead of advertising an SSR portal target', () => {
  const source = readFileSync(new URL('../app/veyrnox/_components/editor/MultitrackWorkspace.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ EditorHelperHost \} from '\.\/EditorHelperLauncher';/);
  assert.match(source, /<EditorHelperHost\s*\/>/);
  assert.doesNotMatch(source, /<div data-vey-editor-helper/);
});

test('real React server rendering leaves the editor slot undiscoverable by the shared portal', () => {
  const { EditorHelperHost } = load('app/veyrnox/_components/editor/EditorHelperLauncher.js');
  const html = renderToStaticMarkup(createElement(EditorHelperHost));
  assert.equal(html, '<div class="ml-auto shrink-0 sm:ml-0"></div>');
  assert.doesNotMatch(html, /data-vey-editor-helper/);
});

function hostHarness(pathname) {
  let state = null, effect, observer, connected = true, host = { nodeType: 1 }, frameId = 0;
  const frames = new Map();
  const fakeReact = { useState: initial => [initial, next => { state = typeof next === 'function' ? next(state) : next; }], useEffect: callback => { effect = callback; } };
  const { default: readEditorHost } = load('app/veyrnox/_lib/useEditorHelperHost.js', { react: fakeReact });
  const mocks = {
    document: { body: {}, querySelector: selector => { assert.equal(selector, '[data-vey-editor-helper]'); return host; } },
    MutationObserver: class { constructor(callback) { observer = callback; } observe(_, options) { assert.deepEqual(options, { childList: true, subtree: true }); } disconnect() { connected = false; } },
    requestAnimationFrame: callback => { const id = ++frameId; frames.set(id, callback); return id; }, cancelAnimationFrame: id => { frames.delete(id); },
  };
  const previous = Object.fromEntries(Object.keys(mocks).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(mocks)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const initial = readEditorHost(pathname), cleanup = effect();
  const flush = () => { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(); };
  return {
    initial, flush, read: () => state, host: () => host, replace: next => { host = next; observer(); }, pending: () => frames.size,
    cleanup: () => { cleanup(); assert.equal(connected, false); assert.equal(frames.size, 0); },
    restore: () => { for (const [key, descriptor] of Object.entries(previous)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } },
  };
}

test('the editor host hook hydrates, follows host replacement/removal and cleans up its observer and frame', () => {
  const harness = hostHarness('/app/editor');
  try {
    assert.equal(harness.initial, null); harness.flush(); assert.equal(harness.read(), harness.host());
    const replacement = { nodeType: 1 }; harness.replace(replacement); harness.flush(); assert.equal(harness.read(), replacement);
    harness.replace(null); harness.flush(); assert.equal(harness.read(), null);
    harness.replace(replacement); assert.equal(harness.pending(), 1); harness.cleanup();
  } finally { harness.restore(); }
});

test('the editor host hook leaves the ordinary floating helper available outside the editor route', () => {
  const harness = hostHarness('/app/create');
  try { harness.flush(); assert.equal(harness.read(), null); harness.cleanup(); }
  finally { harness.restore(); }
});
