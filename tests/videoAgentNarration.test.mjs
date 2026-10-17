import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { normaliseNarration, MAX_NARRATION_LENGTH } from '../lib/montageNarration.js';
import { videoAgentBalanceState } from '../app/veyrnox/_lib/authenticatedMedia.js';
const require = createRequire(import.meta.url), SCRIPT = 'This is a private quality assurance test.';
const text = node => Array.isArray(node) ? node.map(text).join(' ') : node && typeof node === 'object' ? text(node.props?.children) : typeof node === 'string' ? node : '';
function find(node, predicate) {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!node || typeof node !== 'object') return null;
  return predicate(node) ? node : find(node.props?.children, predicate);
}
function harness() {
  const values = [1000, false], refs = [], calls = [];
  let stateIndex = 0, refIndex = 0;
  class GatewayError extends Error {}
  const imports = {
    react: { useState(initial) { const at = stateIndex++; if (!(at in values)) values[at] = initial; return [values[at], value => { values[at] = typeof value === 'function' ? value(values[at]) : value; }]; }, useRef(initial) { const at = refIndex++; return refs[at] ||= { current: initial }; }, useEffect() {}, useCallback: value => value },
    '../../_lib/gateway': { GatewayError, gatewayFetch(path, options) { let resolve; const promise = new Promise(done => { resolve = done; }); calls.push({ path, body: JSON.parse(options.body), resolve }); return promise; }, notifyBalanceChanged() {} },
    '../../../../lib/montageNarration.js': { normaliseNarration, MAX_NARRATION_LENGTH },
    '../../_lib/useStudioJobs': { useStudioJobs: () => ({ jobs: [], generating: false, startJobs() {} }) },
    '../../_lib/authenticatedMedia': { videoAgentBalanceState },
    '../../_lib/jobHistory': { pushJobHistory() {} },
  };
  const output = { exports: {} }, source = readFileSync(new URL('../app/veyrnox/app/video-agent/page.js', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', code)(id => imports[id] || (id === 'react/jsx-runtime' ? require(id) : new Proxy({}, { get: () => () => null })), output, output.exports);
  const render = () => { stateIndex = 0; refIndex = 0; return output.exports.default(); };
  const field = id => find(render(), node => node.type === 'textarea' && node.props.id === id);
  const button = name => find(render(), node => node.type === 'button' && text(node).startsWith(name)) || null;
  render();
  return { render, field, button, calls, edit(id, value) { const target = field(id); assert.ok(target, `field ${id} exists`); target.props.onChange({ target: { value } }); }, respond(at = calls.length - 1) { const call = calls[at]; call.resolve({ plan_id: 'synthetic-ticket', idempotency_key: 'synthetic-key', credits: 165, expires_at: Date.now() / 1000 + 600, narration_text: call.body.narration_text, plan: { summary: 'Synthetic plan', narration_supported: true } }); } };
}
test('exact narration is optional, bounded and visibly included in the approval snapshot', async () => {
  const page = harness();
  assert.equal(page.field('narration-text')?.props.maxLength, 300);
  page.edit('brief', 'Synthetic blue sphere'); page.edit('narration-text', `  ${SCRIPT}  `);
  const pending = page.button('Make a plan').props.onClick();
  assert.equal(page.calls[0].body.narration_text, SCRIPT); page.respond(); await pending;
  assert.ok(text(page.render()).includes(SCRIPT));
  const approve = page.button('Approve and make it').props.onClick();
  assert.equal(page.calls[1].body.inputs.narration_text, SCRIPT);
  page.calls[1].resolve({ job_id: 'synthetic-job', balance_after: 835 }); await approve;
});
test('editing narration invalidates the ticket and late plan responses cannot restore an obsolete approval', async () => {
  const page = harness(); page.edit('brief', 'Synthetic blue sphere'); page.edit('narration-text', SCRIPT);
  const first = page.button('Make a plan').props.onClick();
  page.edit('narration-text', 'New exact words.'); page.respond(); await first;
  assert.equal(page.button('Approve and make it'), null);
  const second = page.button('Make a plan').props.onClick(); page.respond(); await second;
  const oldApprove = page.button('Approve and make it'); assert.ok(oldApprove);
  page.edit('narration-text', 'Changed again.');
  assert.equal(page.button('Approve and make it'), null);
  await oldApprove.props.onClick();
  assert.equal(page.calls.filter(call => call.path === '/generations').length, 0);
});
test('control characters block planning, and the native brief default omits narration', async () => {
  const page = harness(); page.edit('brief', 'Synthetic blue sphere'); page.edit('narration-text', 'two\nlines');
  assert.equal(page.button('Make a plan').props.disabled, true);
  page.edit('narration-text', ''); const pending = page.button('Make a plan').props.onClick();
  assert.equal(Object.hasOwn(page.calls[0].body, 'narration_text'), false); page.respond(); await pending;
  assert.ok(page.button('Approve and make it'));
});
