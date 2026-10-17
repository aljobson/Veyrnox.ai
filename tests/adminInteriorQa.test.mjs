import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
function compile(file, dependency) {
  const compiled = { exports: {} };
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', code)(dependency, compiled, compiled.exports);
  return compiled.exports;
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  if (typeof tree.type === 'function') return nodes(tree.type(tree.props));
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join('');
  return tree && typeof tree === 'object' ? text(tree.props?.children) : typeof tree === 'string' ? tree : '';
}

test('Cinema administrators can discover the publication queue without a bookmarked URL', () => {
  const hooks = { useState: value => [value, () => {}], useRef: value => ({ current: value }), useCallback: value => value, useEffect() {} };
  const page = compile('app/veyrnox/app/admin/cinema/page.js', id => {
    if (id === 'react') return hooks;
    if (id === 'react/jsx-runtime') return require(id);
    if (id === 'next/link') return 'a';
    return new Proxy({}, { get: (_, key) => key === 'gatewayFetch' ? () => assert.fail('Navigation rendering must not issue requests') : String(key) });
  });
  const link = nodes(page.default()).find(node => node.type === 'a' && node.props.href === '/app/admin/cinema/submissions');
  assert.ok(link, 'publication queue must have a visible navigation link');
  assert.match(text(link), /publication queue/i);
});

function accessFixtureModule() {
  return compile('e2e/fixtures/access-product.mjs', id => {
    assert.equal(id, './authenticated-product.mjs');
    return { SYNTHETIC_USER: { id: 'synthetic', email: 'synthetic@example.invalid' }, installProductFixtures: async (_page, options) => options };
  });
}
function adminPages(directory = new URL('../app/veyrnox/app/admin/', import.meta.url), suffix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? adminPages(new URL(`${entry.name}/`, directory), `${suffix}/${entry.name}`)
    : entry.name === 'page.js' ? [suffix] : []);
}
test('every actual admin interior has an explicit authorized and denied browser fixture', () => {
  assert.deepEqual(accessFixtureModule().ADMIN_PAGES.map(([suffix]) => suffix).sort(), adminPages().sort());
});
test('Security browser fixtures provide the real safe projection and preserve denial without writes', async () => {
  const access = accessFixtureModule();
  const fixture = await access.installAccessFixtures({});
  const request = { url: new URL('http://localhost:3100/api/v1/admin/security?limit=100'), origin: 'http://localhost:3100', method: 'GET', json: async (body, status = 200) => ({ body, status }) };
  assert.deepEqual(await fixture.routes(request), { body: { alerts: [], open_by_severity: {}, recent_events: [] }, status: 200 });
  const denied = await access.installAccessFixtures({}, { scenario: { adminError: 'mfa_required' } });
  assert.deepEqual(await denied.routes(request), { body: { error: 'mfa_required' }, status: 403 });
  assert.equal(await fixture.routes({ ...request, method: 'POST', body: { alert_id: 'not-real', status: 'resolved' } }), false, 'the generic read fixture must never accept admin writes');
});

test('populated admin fixture handles only exact loopback reads and never implicitly accepts decisions', async () => {
  const admin = compile('e2e/fixtures/admin-product.mjs', id => {
    if (id === './access-product.mjs') return { ACTION_ID: 'synthetic-action', TITLE_ID: 'synthetic-title', installAccessFixtures: async (_page, options) => options };
    assert.equal(id, './authenticated-product.mjs');
    return { SYNTHETIC_USER: { id: 'synthetic-user', email: 'synthetic@example.invalid' } };
  });
  const fixture = await admin.installAdminFixtures({});
  const request = { url: new URL('http://localhost:3100/api/v1/admin/security?limit=100'), origin: 'http://localhost:3100', method: 'GET', scenario: {}, json: async body => body };
  const active = await fixture.routes(request);
  assert.equal(active.alerts.length, 2);
  assert.notEqual(active.alerts[0].id, active.alerts[1].id);
  assert.equal(active.alerts[0].entity, active.alerts[1].entity);
  assert.equal(active.alerts[0].rule_id, active.alerts[1].rule_id);
  const resolved = await fixture.routes({ ...request, url: new URL(`${request.url}&status=resolved`) });
  assert.deepEqual(resolved.alerts.map(row => row.status), ['resolved']);
  for (const overrides of [
    { method: 'POST', body: { alert_id: admin.ADMIN_IDS.alert, status: 'resolved' } },
    { url: new URL('https://provider.invalid/api/v1/admin/security') },
    { url: new URL('http://localhost:3100/api/v1/admin/unknown') },
    { scenario: { adminError: 'mfa_required' } },
    { scenario: { adminFailures: 1 } },
  ]) assert.equal(await fixture.routes({ ...request, ...overrides }), false);
});
