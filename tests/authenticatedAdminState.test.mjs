import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
class GatewayError extends Error {
  constructor(status, code) { super('private backend detail'); this.status = status; this.code = code; }
}
const source = readFileSync(new URL('../app/veyrnox/app/admin/page.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
import { adminMetricsState } from '../app/veyrnox/_lib/adminMetricsState.js';
function harness(gatewayFetch) {
  let cursor = 0;
  let initial = true;
  const states = [];
  const effects = [];
  const hooks = {
    useState(value) { const index = cursor++; if (initial) states[index] = value; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
    useRef(value) { const index = cursor++; if (initial) states[index] = { current: value }; return states[index]; },
    useCallback: callback => callback,
    useEffect(callback) { if (initial) effects.push(callback); },
  };
  const stubs = { react: hooks, 'next/link': 'a', '../../_components/NavBar': { AppNav: 'nav' }, '../../_components/Main': { Main: 'main' }, '../../_components/Chip': { Chip: 'span' }, '../../_components/MfaPanel': { MfaPanel: 'mfa-panel' }, '../../_lib/gateway': { gatewayFetch, GatewayError } };
  const module = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', code)(id => {
    if (stubs[id]) return stubs[id];
    if (id === '../../_lib/adminMetricsState') {
      const helper = readFileSync(new URL('../app/veyrnox/_lib/adminMetricsState.js', import.meta.url), 'utf8');
      const output = { exports: {} };
      new Function('exports', ts.transpileModule(helper, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(output.exports);
      return output.exports;
    }
    return require(id);
  }, module, module.exports);
  const render = () => { cursor = 0; const tree = module.exports.default(); initial = false; return tree; };
  render();
  const cleanup = effects.map(callback => callback());
  return { render, cleanup: () => cleanup.forEach(callback => callback?.()) };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (tree && typeof tree === 'object') return text(tree.props?.children);
  return typeof tree === 'string' ? tree : '';
}
for (const [status, code, expected] of [[403, 'mfa_required', /verify.*authenticator/i], [403, 'access_required', /Cloudflare Access/i], [403, 'not_admin', /not an administrator/i], [403, 'unknown_private_code', /access could not be verified/i], [401, 'unauthenticated', /Sign in with an administrator/], [503, 'unavailable', /unavailable right now/]]) {
  test(`admin metrics distinguishes safe denial ${status}/${code}`, async () => {
    const app = harness(async () => { throw new GatewayError(status, code); });
    await tick();
    assert.match(text(app.render()), expected);
    assert.doesNotMatch(text(app.render()), /private backend detail|unknown_private_code/);
    assert.ok(nodes(app.render()).some(node => node.type === 'button' && text(node) === 'Retry metrics'));
  });
}
test('MFA verification reloads GET metrics without changing server gates', async () => {
  let calls = 0;
  const app = harness(async path => { assert.equal(path, '/admin/metrics'); calls++; throw new GatewayError(403, 'mfa_required'); });
  await tick();
  const panel = nodes(app.render()).find(node => node.type === 'mfa-panel');
  assert.equal(typeof panel.props.onVerified, 'function');
  await panel.props.onVerified();
  assert.equal(calls, 2);
});
test('retry clears previously loaded metrics and a late old request cannot replace newer denial', async () => {
  const pending = [];
  const app = harness(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  await tick();
  const retry = () => nodes(app.render()).find(node => node.type === 'button' && text(node) === 'Retry metrics');
  assert.ok(retry(), 'retry is available while initial read is pending');
  retry().props.onClick();
  pending[1].reject(new GatewayError(403, 'mfa_required'));
  await tick();
  pending[0].resolve({ generated_at: '2026-10-16T00:00:00Z', jobs_total: 7 });
  await tick();
  assert.match(text(app.render()), /verify.*authenticator/i);
  assert.doesNotMatch(text(app.render()), /By model/);
});
test('unmounted requests cannot update dashboard state', async () => {
  let resolve;
  const app = harness(() => new Promise(done => { resolve = done; }));
  await tick();
  app.cleanup();
  resolve({ generated_at: '2026-10-16T00:00:00Z' });
  await tick();
  assert.doesNotMatch(text(app.render()), /By model/);
});
test('only fixed typed error categories are accepted; missing and unexpected errors are unavailable', () => {
  for (const error of [null, undefined, new Error('private'), { status: 500 }]) assert.equal(adminMetricsState(error), 'error');
  assert.equal(adminMetricsState({ status: 403 }), 'unverified');
  for (const [status, code, state] of [[401, '', 'unauthenticated'], [403, 'mfa_required', 'mfa'], [403, 'access_required', 'access'], [403, 'not_admin', 'forbidden']]) assert.equal(adminMetricsState({ status, code }), state);
});
test('a successful read renders real metrics and hides retry; read never adds a write method', async () => {
  const app = harness(async (...args) => { assert.deepEqual(args, ['/admin/metrics']); return { generated_at: '2026-10-16T00:00:00Z' }; });
  await tick();
  assert.ok(nodes(app.render()).some(node => typeof node.type === 'function' && node.type.name === 'Kpis'));
  assert.ok(!nodes(app.render()).some(node => node.type === 'button' && text(node) === 'Retry metrics'));
});
test('late rejected request cannot hide a newer successful response', async () => {
  const pending = [];
  const app = harness(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  await tick();
  nodes(app.render()).find(node => node.type === 'mfa-panel').props.onVerified();
  pending[1].resolve({ generated_at: '2026-10-16T00:00:00Z' });
  await tick();
  pending[0].reject(new GatewayError(403, 'not_admin'));
  await tick();
  assert.doesNotMatch(text(app.render()), /not an administrator/);
  assert.ok(nodes(app.render()).some(node => typeof node.type === 'function' && node.type.name === 'Kpis'));
});
test('unexpected thrown error cannot leak backend text', async () => {
  const app = harness(async () => { throw new Error('private backend detail'); });
  await tick();
  assert.match(text(app.render()), /unavailable right now/);
  assert.doesNotMatch(text(app.render()), /private backend detail/);
});
