import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url), ts = require('typescript');
const USER = '00000000-0000-4000-8000-000000000001';
const JOB = '00000000-0000-4000-8000-000000000020';
const EMAIL = 'synthetic-feature-qa@example.invalid';
const compile = (path, dependency) => {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const compiled = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', code)(dependency, compiled, compiled.exports);
  return compiled.exports;
};
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : !tree || typeof tree !== 'object' ? [] : [tree, ...nodes(tree.props?.children)];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function harness(kind, search = '', gateway) {
  const slots = [], pending = [], requests = []; let cursor = 0, changed = false, tree, currentSearch = search;
  const state = value => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = typeof value === 'function' ? value() : value;
    return [slots[index], value => { const next = typeof value === 'function' ? value(slots[index]) : value; changed ||= next !== slots[index]; slots[index] = next; }];
  };
  const hooks = {
    Suspense: 'suspense', useState: state,
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useCallback(callback, deps) { const index = cursor++; if (!slots[index] || deps.some((value, i) => value !== slots[index].deps[i])) slots[index] = { deps, callback }; return slots[index].callback; },
    useEffect(effect, deps) { const index = cursor++; if (!slots[index] || deps.some((value, i) => value !== slots[index].deps[i])) pending.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: effect() }; }); },
  };
  const fetch = async (path, init = {}) => {
    requests.push({ path, method: init.method || 'GET' });
    if (gateway) { const result = await gateway(path, init); if (result !== undefined) return result; }
    if (path.startsWith('/admin/users/lookup')) return { user: { id: USER, email: EMAIL }, jobs: [] };
    if (path.startsWith('/admin/users/ledger')) return { balance: { balance: 10, free_balance: 0, subscription_balance: 0 }, entries: [], actions: [] };
    return { violations: [] };
  };
  const page = compile(`app/veyrnox/app/admin/${kind}/page.js`, id => {
    if (id === 'react') return hooks;
    if (id === 'react/jsx-runtime') return require(id);
    if (id === 'next/navigation') return { useSearchParams: () => new URLSearchParams(currentSearch) };
    if (id === 'next/link') return 'a';
    if (id.endsWith('/adminUserHandoff')) return compile('app/veyrnox/_lib/adminUserHandoff.js', () => assert.fail('pure helper must have no imports'));
    return new Proxy({}, { get: (_, key) => key === 'gatewayFetch' ? fetch : String(key) });
  });
  const wrapper = nodes(page.default()).find(node => typeof node.type === 'function' && ['AccountHandoff', 'ViolationsHandoff'].includes(node.type.name));
  let activeKey;
  const render = () => {
    do {
      changed = false; cursor = 0;
      const child = wrapper.type(wrapper.props);
      if (activeKey !== child.key) {
        for (const slot of slots) slot?.cleanup?.();
        slots.length = 0; pending.length = 0; activeKey = child.key;
      }
      tree = child.type(child.props);
      while (pending.length) pending.shift()();
    } while (changed);
    return tree;
  };
  render();
  const find = () => nodes(render()).find(node => node.type === 'form' && node.props['aria-label'] === 'Find a user');
  const input = () => nodes(find()).find(node => node.type === 'input');
  const clear = () => {
    const button = nodes(find()).find(node => node.props?.children === 'Clear'); assert.ok(button, 'nonempty query can be cleared before lookup'); button.props.onClick(); render();
  };
  return { requests, render, find, input, clear,
    change(value) { input().props.onChange({ target: { value } }); render(); },
    navigate(value) { currentSearch = value; render(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
    lookup() { return nodes(render()).find(node => ['Standing', 'UserCard'].includes(node.type?.name))?.props.user; },
  };
}

for (const kind of ['users', 'violations']) {
  test(`${kind} prefills a validated report or appeal handoff without lookup or mutations`, () => {
    const page = harness(kind, `user=${USER}`);
    assert.equal(page.input().props.value, USER);
    assert.equal(page.requests.some(row => row.path.startsWith('/admin/users/lookup')), false);
    assert.equal(page.requests.every(row => row.method === 'GET'), true);
    page.clear(); assert.equal(page.input().props.value, ''); assert.equal(page.lookup(), undefined);
  });
  test(`${kind} updates a client-navigation handoff but never overwrites a clear on rerender`, () => {
    const page = harness(kind, `user=${USER}`); page.clear(); page.render(); assert.equal(page.input().props.value, '');
    page.navigate(`user=${encodeURIComponent(EMAIL)}`); assert.equal(page.input().props.value, EMAIL);
    page.navigate('user=bad&user=also-bad'); assert.equal(page.input().props.value, '');
  });
  test(`${kind} manual UUID fallback is read-only and malformed queries never trigger lookup`, async () => {
    for (const query of ['', 'user=', 'user=%3Cscript%3E', 'user=a%0Ab@example.invalid', `user=${USER}&user=${USER}`, `user=${'a'.repeat(255)}`, 'user=not-an-account']) {
      const page = harness(kind, query); assert.equal(page.input().props.value, ''); assert.equal(page.requests.some(row => row.path.startsWith('/admin/users/lookup')), false);
    }
    const page = harness(kind, `user=${JOB}`, path => {
      if (path === `/admin/users/lookup?user_id=${JOB}`) return Promise.reject({ code: 'user_not_found' });
    });
    await page.find().props.onSubmit({ preventDefault() {} });
    assert.ok(page.requests.some(row => row.path === `/admin/users/lookup?job_id=${JOB}`));
    assert.equal(page.requests.every(row => row.method === 'GET'), true);
  });
  test(`${kind} clear invalidates a late lookup without exposing old account actions`, async () => {
    const gate = deferred();
    const page = harness(kind, `user=${USER}`, path => path.startsWith('/admin/users/lookup') ? gate.promise : undefined);
    const lookup = page.find().props.onSubmit({ preventDefault() {} });
    page.clear(); gate.resolve({ user: { id: USER, email: EMAIL }, jobs: [] }); await lookup;
    assert.equal(page.lookup(), undefined); assert.equal(page.input().props.value, '');
    assert.equal(page.requests.some(row => /ledger\?|violations\?/.test(row.path)), false);
  });
  test(`${kind} navigation invalidates late success and late error`, async () => {
    for (const rejected of [false, true]) {
      const gate = deferred();
      const page = harness(kind, `user=${USER}`, path => path.startsWith('/admin/users/lookup') ? gate.promise.then(data => { if (rejected) throw { code: 'not_admin' }; return data; }) : undefined);
      const lookup = page.find().props.onSubmit({ preventDefault() {} });
      page.navigate(`user=${encodeURIComponent(EMAIL)}`); gate.resolve({ user: { id: USER, email: EMAIL }, jobs: [] }); await lookup;
      assert.equal(page.lookup(), undefined); assert.equal(page.input().props.value, EMAIL);
      assert.equal(nodes(page.render()).some(node => node.props?.role === 'alert'), false);
    }
  });
  test(`${kind} preserves manual lookup and protected access refusals`, async () => {
    for (const code of ['mfa_required', 'not_admin']) {
      const page = harness(kind, `user=${USER}`, path => path.startsWith('/admin/users/lookup') ? Promise.reject({ code }) : undefined);
      await page.find().props.onSubmit({ preventDefault() {} });
      assert.equal(page.lookup(), undefined); assert.ok(nodes(page.render()).some(node => node.props?.role === 'alert'));
      assert.equal(page.requests.every(row => row.method === 'GET'), true);
    }
  });
  test(`${kind} clear invalidates a late scoped ledger or violations read`, async () => {
    const gate = deferred(); let started = false;
    const page = harness(kind, `user=${USER}`, path => {
      if (path.startsWith('/admin/users/ledger?') || path.startsWith('/admin/violations?')) { started = true; return gate.promise; }
    });
    const lookup = page.find().props.onSubmit({ preventDefault() {} });
    while (!started) await new Promise(resolve => setImmediate(resolve));
    assert.equal(page.lookup().id, USER); page.clear();
    gate.resolve({ balance: { balance: 999 }, entries: [{ id: 'old' }], actions: [], violations: [{ id: 'old' }] }); await lookup;
    assert.equal(page.lookup(), undefined);
    assert.equal(nodes(page.render()).some(node => node.type?.name === 'Entries'), false);
    const record = nodes(page.render()).find(node => node.type?.name === 'Record');
    if (record) assert.deepEqual(record.props.rows, []);
  });
  test(`${kind} input edit and account-boundary unmount invalidate pending lookup`, async () => {
    for (const unmount of [false, true]) {
      const gate = deferred();
      const page = harness(kind, `user=${USER}`, path => path.startsWith('/admin/users/lookup') ? gate.promise : undefined);
      const lookup = page.find().props.onSubmit({ preventDefault() {} });
      if (unmount) page.unmount(); else page.change(EMAIL);
      gate.resolve({ user: { id: USER, email: EMAIL }, jobs: [] }); await lookup;
      assert.equal(page.lookup(), undefined);
      assert.equal(page.requests.some(row => /ledger\?|violations\?/.test(row.path)), false);
    }
  });
  test(`${kind} old action completion cannot revive cleared, edited, navigated or unmounted account data`, async () => {
    for (const invalidate of ['clear', 'edit', 'navigate', 'unmount']) {
      const page = harness(kind, `user=${USER}`);
      await page.find().props.onSubmit({ preventDefault() {} });
      const oldDone = nodes(page.render()).find(node => node.type?.name === (kind === 'users' ? 'GrantForm' : 'UserCard')).props.onDone;
      if (invalidate === 'clear') page.clear();
      else if (invalidate === 'edit') page.change(EMAIL);
      else if (invalidate === 'navigate') page.navigate(`user=${encodeURIComponent(EMAIL)}`);
      else page.unmount();
      const before = page.requests.length;
      await oldDone();
      assert.equal(page.requests.length, before, `stale completion after ${invalidate} must not start any new read`);
      if (invalidate !== 'unmount') assert.equal(nodes(page.render()).some(node => node.type?.name === 'Entries'), false);
    }
  });
  test(`${kind} old completion cannot refresh a newer lookup of the same user, but repeated current refresh remains valid`, async () => {
    const page = harness(kind, `user=${USER}`);
    await page.find().props.onSubmit({ preventDefault() {} });
    const oldDone = nodes(page.render()).find(node => node.type?.name === (kind === 'users' ? 'GrantForm' : 'UserCard')).props.onDone;
    page.clear(); page.change(USER);
    await page.find().props.onSubmit({ preventDefault() {} });
    const currentDone = nodes(page.render()).find(node => node.type?.name === (kind === 'users' ? 'GrantForm' : 'UserCard')).props.onDone;
    const before = page.requests.length;
    await oldDone(); assert.equal(page.requests.length, before);
    await currentDone(); const first = page.requests.length; assert.ok(first > before);
    await currentDone(); assert.ok(page.requests.length > first, 'a valid callback must not invalidate its own selected context');
  });
  test(`${kind} old action completion cannot issue a read against a second selected user`, async () => {
    const other = '00000000-0000-4000-8000-000000000099';
    const page = harness(kind, `user=${USER}`, path => path === `/admin/users/lookup?user_id=${other}` ? { user: { id: other, email: 'second-synthetic@example.invalid' }, jobs: [] } : undefined);
    await page.find().props.onSubmit({ preventDefault() {} });
    const oldDone = nodes(page.render()).find(node => node.type?.name === (kind === 'users' ? 'GrantForm' : 'UserCard')).props.onDone;
    page.change(other); await page.find().props.onSubmit({ preventDefault() {} });
    assert.equal(page.lookup().id, other);
    const before = page.requests.length; await oldDone(); assert.equal(page.requests.length, before);
    assert.equal(page.lookup().id, other);
  });
}

test('handoff validator is bounded, rejects ambiguity and preserves supported email and UUID inputs', async () => {
  const { adminUserHandoff } = await import('../app/veyrnox/_lib/adminUserHandoff.js');
  assert.equal(adminUserHandoff(null), '');
  assert.equal(adminUserHandoff(new URLSearchParams('user=one&user=two')), '');
  assert.equal(adminUserHandoff(new URLSearchParams({ user: 'a'.repeat(255) })), '');
  for (const value of [USER, JOB, EMAIL, 'Qa+case@example.invalid', ' A@example.invalid ']) assert.equal(adminUserHandoff(new URLSearchParams({ user: value })), value.trim());
  for (const value of ['<x>@example.invalid', 'a@example.invalid\u007f', 'a\u0000@example.invalid', `${'a'.repeat(65)}@example.invalid`, `a@${'b'.repeat(191)}`, 'javascript:alert(1)', '00000000-0000-0000-0000-000000000000']) assert.equal(adminUserHandoff(new URLSearchParams({ user: value })), '');
});

test('violations account standing and jobs have unique sibling reconciliation keys', async () => {
  const page = harness('violations', `user=${USER}`);
  await page.find().props.onSubmit({ preventDefault() {} });
  const children = nodes(page.render()).filter(node => ['UserCard', 'Jobs'].includes(node.type?.name));
  assert.equal(children.length, 2);
  assert.equal(new Set(children.map(node => node.key)).size, 2, 'same-user standing and jobs must not share a sibling key');
});
