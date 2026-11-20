import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { harness, find, button, elements } from './helpers/musicBeatComponentHarness.mjs';
import { v5BeatFixture } from './fixtures/musicBeatV5.mjs';
import { configureBeatWrites } from '../app/veyrnox/_lib/music/beat/beatCompatibility.mjs';
const base = new URL('../app/veyrnox/_components/music/beat/', import.meta.url);
async function stubsFor(name, extension = 'jsx') {
  const source = readFileSync(new URL(`${name}.${extension}`, base), 'utf8'), stubs = {};
  for (const [, path] of source.matchAll(/from '([^']+)'/g)) {
    if (path.endsWith('.mjs')) stubs[path] = await import(new URL(path, base));
    else if (path.startsWith('./')) stubs[path] = { __esModule: true, default: () => null };
  }
  return stubs;
}
async function editor(t) {
  const h = harness(), doc = v5BeatFixture(), pushed = [], warnings = [];
  const oldWindow = globalThis.window;
  globalThis.window = new EventTarget(); globalThis.window.confirm = message => { warnings.push(message); return false; };
  const project = { doc, current: { current: doc }, readOnly: true, dirty: true, persistent: true, conflict: 'changed',
    registerRecordingState() {}, registerFinalizer() {}, reload() {}, edit() { assert.fail('no edits'); },
    flushLatest: async () => { throw Object.assign(new Error('disabled'), { code: 'v5_write_disabled' }); } };
  const playback = { playhead: -1, finishRecording: async () => doc, isRecording: () => false,
    audioRecorder: { recovery: [], hasPending: () => false } };
  const { useRecordingLock } = h.load('useRecordingLock', await stubsFor('useRecordingLock', 'js'), 'js');
  const Editor = h.load('BeatEditor', { ...await stubsFor('BeatEditor'),
    'next/dynamic': { __esModule: true, default: () => () => null }, 'next/link': { __esModule: true, default: 'a' },
    'next/navigation': { useRouter: () => ({ push: path => pushed.push(path) }) },
    './useRecordingLock': { useRecordingLock }, './useBeatProject': { useBeatProject: () => project },
    './useBeatPlayback': { useBeatPlayback: () => playback }, './useBeatLoopLayers': { useBeatLoopLayers: () => ({}) },
    './useBeatAiRequest': { useBeatAiRequest: () => ({ pending: [] }) },
    './useBeatCloudSync': { useBeatCloudSync: () => ({ state: 'signed_out', media: [] }) },
  }).default;
  t.after(() => { h.close(); globalThis.window = oldWindow; configureBeatWrites(false); });
  h.render(() => Editor({ id: doc.id, cloud: true }));
  return { h, doc, project, pushed, warnings };
}
for (const leave of [false, true]) test(`dirty read-only My beats click ${leave ? 'leaves after warning' : 'can be cancelled'}`, async t => {
  const { h, project, pushed, warnings } = await editor(t);
  globalThis.window.confirm = message => { warnings.push(message); return leave; };
  let prevented = false;
  const back = find(h.tree, n => n.props.href === '/app/music/beats');
  await back.props.onClick({ button: 0, preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Unsaved changes will be lost if you leave this page/);
  assert.deepEqual(pushed, leave ? ['/app/music/beats'] : []); assert.equal(project.dirty, true);
});
// Minimal DOM surface for the actual lock effect: native disabled attributes and
// capture-phase listeners, using controls from the rendered production components.
function domControl(node) {
  const attrs = new Map(Object.entries(node.props).filter(([key, value]) => !key.startsWith('on') && value !== undefined && value !== false).map(([key, value]) => [key, value === true ? '' : String(value)]));
  return { node,
    get disabled() { return attrs.has('disabled'); }, set disabled(value) { if (value) attrs.set('disabled', ''); else attrs.delete('disabled'); },
    getAttribute: key => attrs.get(key) ?? null, setAttribute: (key, value) => attrs.set(key, value), removeAttribute: key => attrs.delete(key),
    closest(selector) { return attrs.has(selector.slice(1, -1)) ? this : null; },
  };
}
test('read-only lock permits Reload, navigation and playback while disabling editing controls', async t => {
  const { h, doc } = await editor(t), transport = harness(); t.after(() => transport.close());
  const Transport = transport.load('BeatTransport', await stubsFor('BeatTransport')).default;
  transport.render(() => Transport({ doc }));
  const controls = [...elements(h.tree), ...elements(transport.tree)].filter(n => ['button', 'a', 'input', 'select'].includes(n.type)).map(domControl);
  const listeners = new Map(), root = { querySelectorAll: () => controls, addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) };
  const previous = globalThis.MutationObserver;
  globalThis.MutationObserver = class { disconnect() {} observe() {} takeRecords() { return []; } };
  t.after(() => { globalThis.MutationObserver = previous; });
  h.tree.props.ref.current = root; h.effects();
  const byNode = node => controls.find(c => c.node === node);
  for (const node of [button(h.tree, 'Reload'), button(h.tree, 'Mixer'), find(h.tree, n => n.props.href === '/app/music/beats'), find(h.tree, n => n.props.href === '/app/account'), button(transport.tree, 'Play')]) {
    assert.ok(node); const control = byNode(node);
    assert.equal(control.disabled, false); assert.notEqual(control.getAttribute('aria-disabled'), 'true');
    listeners.get('click')({ target: control, preventDefault() { assert.fail('read action blocked'); }, stopPropagation() {} });
  }
  for (const node of [button(h.tree, 'Save as copy'), find(h.tree, n => n.type === 'input'), button(transport.tree, 'Cycle')]) {
    const control = byNode(node); assert.ok(control); assert.equal(control.disabled, true); assert.match(control.getAttribute('title'), /read-only/);
    let blocked = false; listeners.get('click')({ target: control, preventDefault() { blocked = true; }, stopPropagation() {} }); assert.equal(blocked, true);
  }
});
