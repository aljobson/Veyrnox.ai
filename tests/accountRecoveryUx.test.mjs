import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function component(path, mocks = {}) {
  const js = ts.transpileModule(read(path), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const output = { exports: {} };
  new Function('require', 'module', 'exports', js)((id) => mocks[id] ?? require(id), output, output.exports);
  return output.exports;
}

function mfaHarness(listFactors) {
  const values = [];
  const effects = [];
  let cursor = 0;
  const hooks = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = initial;
      return [values[index], (next) => { values[index] = typeof next === 'function' ? next(values[index]) : next; }];
    },
    useEffect(fn) { effects.push(fn); },
    useCallback(fn) { return fn; },
  };
  const { MfaPanel } = component('app/veyrnox/_components/MfaPanel.js', {
    react: hooks,
    '../../lib/authClient.js': { listFactors, getAal: () => 'aal1' },
  });
  return {
    render() { cursor = 0; return renderToStaticMarkup(MfaPanel()); },
    async load() { effects[0](); await new Promise((resolve) => setImmediate(resolve)); },
  };
}

test('MFA shows a neutral pending message until factors load, then offers enrollment', async () => {
  let complete;
  const harness = mfaHarness(() => new Promise((resolve) => { complete = resolve; }));
  const initial = harness.render();
  assert.match(initial, /Loading authenticator settings/);
  assert.doesNotMatch(initial, /unavailable|role="alert"|Set up an authenticator/);
  await harness.load();
  assert.match(harness.render(), /Loading authenticator settings/);
  complete([]);
  await new Promise((resolve) => setImmediate(resolve));
  const loaded = harness.render();
  assert.match(loaded, /Set up an authenticator app/);
  assert.doesNotMatch(loaded, /Loading authenticator settings|role="alert"/);
});

test('MFA reports a real load failure with a retry instead of offering enrollment', async () => {
  const harness = mfaHarness(async () => { throw new Error('private provider error'); });
  harness.render();
  await harness.load();
  const failed = harness.render();
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Could not read your authenticator settings/);
  assert.match(failed, /Retry/);
  assert.doesNotMatch(failed, /Loading authenticator settings|Set up an authenticator|private provider error/);
});

function libraryHtml({ hydrated, actor }) {
  const path = 'app/veyrnox/app/library/page.js';
  const mocks = {};
  for (const [, names, id] of read(path).matchAll(/import \{([^}]+)\} from '([^']+)'/g)) {
    mocks[id] = Object.fromEntries(names.split(',').map((name) => [name.trim(), () => null]));
  }
  mocks.react = {
    ...React, useState: (value) => [value, () => {}], useEffect: () => {},
    useCallback: (fn) => fn, useRef: (current) => ({ current }),
    useSyncExternalStore: (_, snapshot, server) => (hydrated ? snapshot() : server()),
  };
  mocks['next/link'] = { default: ({ children, ...props }) => React.createElement('a', props, children), __esModule: true };
  mocks['../../_components/Main'] = { Main: ({ children, ...props }) => React.createElement('main', props, children) };
  mocks['../../_components/LibraryAccessState'] = component('app/veyrnox/_components/LibraryAccessState.js', {
    './NavBar': { AppNav: () => null }, './Main': component('app/veyrnox/_components/Main.js'),
  });
  mocks['../../../lib/authClient.js'].getStoredUserId = () => actor;
  mocks['../../_lib/useCatalog'].useCatalog = () => ({ models: [] });
  mocks['../../_lib/useOlderLibraryJobs'].useOlderLibraryJobs = () => ({});
  mocks['../../_lib/libraryFilter'].filterRows = () => [];
  const { default: Library } = component(path, mocks);
  const previous = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => null } };
  try { return renderToStaticMarkup(Library()); }
  finally { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
}

test('Library shows a neutral hydration state before checking the account', () => {
  const html = libraryHtml({ hydrated: false, actor: 'signed-in-user' });
  assert.match(html, /Loading your library/);
  assert.doesNotMatch(html, /Sign in to view|Nothing here yet/);
});

test('Library directs signed-out visitors to sign in instead of claiming an empty account', () => {
  const html = libraryHtml({ hydrated: true, actor: null });
  assert.match(html, /Sign in to view your library/);
  assert.match(html, /Your generations are saved to your account/);
  assert.doesNotMatch(html, /Nothing here yet|Open the studio/);
  const source = read('app/veyrnox/_components/LibraryAccessState.js');
  assert.match(source, /veyrnox:auth-required/);
});

test('recovery offers a retry and safe navigation without showing raw error details', () => {
  const { default: Recovery } = component('components/ErrorRecovery.jsx', {
    '../app/veyrnox/_components/Main': component('app/veyrnox/_components/Main.js'),
  });
  let retried = false;
  const tree = Recovery({ retry: () => { retried = true; } });
  const html = renderToStaticMarkup(tree);
  assert.match(html, /Veyrnox.ai/);
  assert.match(html, /Try again/);
  assert.match(html, /href="\/app\/library"/);
  assert.match(html, /href="\/"/);
  assert.match(html, /id="main"/);
  const find = (node) => {
    if (!React.isValidElement(node)) return null;
    if (node.type === 'button') return node;
    return React.Children.toArray(node.props.children).map(find).find(Boolean);
  };
  find(tree).props.onClick();
  assert.equal(retried, true);
  assert.doesNotMatch(read('components/ErrorRecovery.jsx'), /error\.message|dangerouslySetInnerHTML/);
});

test('root, global and Veyrnox segments provide Next client recovery boundaries', () => {
  for (const path of ['app/error.js', 'app/global-error.js', 'app/veyrnox/error.js']) {
    const source = read(path);
    assert.match(source, /^'use client'/);
    assert.match(source, /retry/);
    assert.match(source, /<ErrorRecovery/);
  }
  const global = read('app/global-error.js');
  assert.match(global, /<html lang="en">/);
  assert.match(global, /<body/);
  assert.match(global, /<title>/);
});

test('root hydration restores token-free display metadata once across StrictMode effects', async () => {
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;
  const store = new Map([['veyrnox_supabase_session', JSON.stringify({ cookie_session: true, expires_at: 1, user: { id: 'restored-account' } })]]);
  globalThis.window = { location: { pathname: '/app/account' } };
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; return Response.json({ access_token: 'memory-only', expires_in: 3600, user: { id: 'restored-account' } }); };
  try {
    const auth = await import('../app/lib/authClient.js?root-hydration-test');
    assert.equal(auth.getSession(), null);
    const { default: SessionHydration } = component('components/SessionHydration.jsx', {
      react: { useEffect: (effect) => effect() }, '../app/lib/authClient.js': auth,
    });
    SessionHydration();
    SessionHydration();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests, 1);
    assert.equal(auth.getSession()?.user?.id, 'restored-account');
    assert.ok(!store.get('veyrnox_supabase_session').includes('memory-only'));
    assert.match(read('app/layout.js'), /<SessionHydration \/>/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previousStorage;
  }
});

test('root hydration leaves OAuth callback establishment to its own flow', () => {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { pathname: '/auth/callback' } };
  try {
    const { default: SessionHydration } = component('components/SessionHydration.jsx', {
      react: { useEffect: (effect) => effect() }, '../app/lib/authClient.js': { getFreshAccessToken: () => assert.fail('callback must own token establishment') },
    });
    assert.equal(SessionHydration(), null);
  } finally { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; }
});

test('anonymous StrictMode restoration makes one request and stays signed out', async () => {
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;
  globalThis.window = { location: { pathname: '/' } };
  globalThis.localStorage = { getItem: () => null, setItem: () => assert.fail('anonymous restore must not persist metadata'), removeItem: () => {} };
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; return Response.json({ error: 'no_session' }, { status: 401 }); };
  try {
    const auth = await import('../app/lib/authClient.js?root-anonymous-test');
    const { default: SessionHydration } = component('components/SessionHydration.jsx', {
      react: { useEffect: (effect) => effect() }, '../app/lib/authClient.js': auth,
    });
    SessionHydration();
    SessionHydration();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests, 1);
    assert.equal(auth.getSession(), null);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    if (previousStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previousStorage;
  }
});

test('account presentation uses stored identity while authenticated requests still obtain a fresh bearer', () => {
  assert.match(read('app/veyrnox/app/account/page.js'), /getStoredUserId/);
  assert.match(read('app/veyrnox/_components/AccountBoundary.js'), /getStoredUserId/);
  assert.match(read('app/veyrnox/_components/NavBar.js'), /setSession\(getStoredSession\(\)\)/);
  assert.match(read('app/veyrnox/_components/JobWatcher.js'), /getStoredUserId/);
  assert.match(read('app/veyrnox/_lib/gateway.js'), /getFreshAccessToken\(\)/);
});
