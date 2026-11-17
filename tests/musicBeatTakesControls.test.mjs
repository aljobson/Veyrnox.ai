import test from 'node:test';
import { englishBeatImports } from './helpers/musicBeatI18n.mjs';
import * as shortcuts from '../app/veyrnox/_lib/music/beat/beatShortcuts.mjs';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as takeOps from '../app/veyrnox/_lib/music/beat/beatTakeOps.mjs';
import { createBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import { addAudioTrack } from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
const require = createRequire(import.meta.url);
function hooks() {
  const slots = [], cleanups = []; let offset = 0, effects = [];
  const memo = (make, deps) => {
    const n = offset++, old = slots[n];
    if (!old || !deps || deps.some((d, i) => d !== old.deps[i])) slots[n] = { deps, value: make() };
    return slots[n].value;
  };
  return {
    react: {
      useState(value) { const n = offset++; if (!(n in slots)) slots[n] = value; return [slots[n], value => { slots[n] = value; }]; },
      useRef: value => memo(() => ({ current: value }), []), useMemo: memo,
      useEffect: (effect, deps) => memo(() => { effects.push(effect); }, deps),
    },
    render(component, props) { offset = 0; const tree = component(props); for (const effect of effects) cleanups.push(effect()); effects = []; return tree; },
    cleanup() { cleanups.forEach(fn => fn?.()); },
  };
}
function load(name, state, extra = {}) {
  const source = readFileSync(new URL(`../app/veyrnox/_components/music/beat/${name}.${name.startsWith('use') ? 'js' : 'jsx'}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const compiled = { exports: {} }, stubs = { ...englishBeatImports, '../../../_lib/music/beat/beatShortcuts.mjs': shortcuts, react: state.react, './beatStyles': {},
    './BeatTakeWaveform': { __esModule: true, default: () => null }, '../../../_lib/music/beat/beatTakeOps.mjs': takeOps, ...extra };
  new Function('require', 'module', 'exports', code)(id => stubs[id] || require(id), compiled, compiled.exports);
  return compiled.exports.default || compiled.exports[name];
}
function* elements(node) {
  if (Array.isArray(node)) { for (const child of node) yield* elements(child); }
  else if (node?.props) { yield node; yield* elements(node.props.children); }
}
test('actual lane keyboard handlers move relative to an off-snap start, extend, clamp, assign and clear', () => {
  const state = hooks(), Lanes = load('BeatTakeLanes', state);
  const asset = ref => ({ source: 'take', ref, name: ref, durationSec: 5, bpm: null, sourceChannels: 1, encodedBytes: 0 });
  let doc = addAudioTrack(createBeat({ id: crypto.randomUUID(), now: 1 }));
  doc = takeOps.commitRecording(doc, { trackId: 't2', start: 240, length: 3840, takes: [{ asset: asset('first') }, { asset: asset('second') }] });
  const id = doc.tracks[1].takeGroups[0].id;
  doc = takeOps.useWholeTake(doc, 't2', id, 0);
  const render = () => state.render(Lanes, { doc, track: doc.tracks[1], group: doc.tracks[1].takeGroups[0], snap: 960, zoom: 100, edit(change) { doc = change(doc); } });
  const lane = () => [...elements(render())].filter(e => e.props.role === 'application')[1];
  const press = (key, shiftKey = false) => lane().props.onKeyDown({ key, shiftKey, preventDefault() {}, stopPropagation() {} });
  lane().props.onFocus(); press('ArrowRight'); press('ArrowRight', true); press('Enter');
  assert.deepEqual(doc.tracks[1].takeGroups[0].comp, [[240, 0], [1200, 1], [3120, 0]]);
  for (let i = 0; i < 8; i++) press('ArrowRight');
  press('Enter');
  assert.deepEqual(doc.tracks[1].takeGroups[0].comp.at(-1), [3840, 1]);
  for (let i = 0; i < 8; i++) press('ArrowLeft');
  press('Enter'); assert.deepEqual(doc.tracks[1].takeGroups[0].comp[0], [240, 1]);
  press('Escape');
  assert.equal([...elements(lane())].some(e => e.props.className?.includes('border-2')), false);
});
test('record input uses the actual BeatMeter: reduced-motion bar hidden and value only exposed while focused', t => {
  let animate, preference;
  const motion = { matches: true, addEventListener(type, fn) { preference = fn; }, removeEventListener() {} };
  for (const name of ['matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    if (!old) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value() {} });
    t.after(() => { if (old) Object.defineProperty(globalThis, name, old); else delete globalThis[name]; });
  }
  t.mock.method(globalThis, 'matchMedia', () => motion);
  t.mock.method(globalThis, 'requestAnimationFrame', fn => { animate = fn; return 1; });
  t.mock.method(globalThis, 'cancelAnimationFrame', () => {});
  const meterState = hooks(), Meter = load('BeatMeter', meterState), panelState = hooks();
  const Panel = load('BeatRecordPanel', panelState, {
    './BeatMeter': { __esModule: true, default: Meter }, 'next/dynamic': { __esModule: true, default: () => () => null },
    '../../../_lib/music/beat/beatLatency.mjs': { readLatency: () => null },
  });
  let reads = 0, disconnected = false;
  const analyser = { getFloatTimeDomainData(samples) { reads++; samples.fill(0.5); }, disconnect() { disconnected = true; } };
  const capture = { context: { createAnalyser: () => analyser }, analyser: { connect() {}, disconnect() {} } };
  const panel = panelState.render(Panel, { recorder: { capture: { current: capture }, recovery: [], devices: [] }, playback: {} });
  const meter = [...elements(panel)].find(e => e.type === Meter); assert.ok(meter);
  const render = () => meterState.render(Meter, meter.props);
  render(); animate(40); let tree = render();
  assert.equal(tree.props['aria-valuenow'], undefined);
  assert.equal([...elements(tree)].some(e => e.props.className?.includes('h-2')), false);
  tree.props.onFocus(); tree = render(); assert.equal(tree.props['aria-valuenow'], -6);
  animate(80); assert.equal(reads, 1); animate(300); assert.equal(reads, 2);
  tree.props.onBlur(); assert.equal(render().props['aria-valuenow'], undefined);
  motion.matches = false; preference(); assert.ok([...elements(render())].some(e => e.props.className?.includes('h-2')));
  meterState.cleanup(); assert.equal(disconnected, true);
});
test('capture URL is a real static file outside every configured rewrite and redirect', async () => {
  const { default: config } = await import('../next.config.mjs');
  const { pathToRegexp } = require('next/dist/compiled/path-to-regexp');
  const url = '/audio-worklets/beat-capture-worklet.js';
  const rewrites = await config.rewrites();
  for (const route of [...await config.redirects(), ...Object.values(rewrites).flat()]) assert.equal(pathToRegexp(route.source).test(url), false, route.source);
  assert.ok(existsSync(new URL(`../public${url}`, import.meta.url)));
  assert.equal(existsSync(new URL('../public/music', import.meta.url)), false);
  const capture = readFileSync(new URL('../app/veyrnox/_lib/music/beat/beatCapture.js', import.meta.url), 'utf8');
  assert.ok(capture.includes(`addModule('${url}')`));
});

test('pending take actions remain visible while disarmed; calibration is disabled during playback/finalization', async () => {
  const state = hooks(), Panel = load('BeatRecordPanel', state, {
    './BeatMeter': { __esModule: true, default: () => null }, 'next/dynamic': { __esModule: true, default: () => () => null },
    '../../../_lib/music/beat/beatLatency.mjs': { readLatency: () => null },
  });
  let retried = 0, discarded = 0;
  const recorder = { capture: { current: null }, error: 'Could not save recorded audio', recovery: [], devices: [], hasPending: () => true,
    retry: () => retried++, discard: () => discarded++ };
  let tree = state.render(Panel, { recorder, playback: {} });
  const control = label => [...elements(tree)].find(e => e.type === 'button' && e.props.children === label);
  control('Try again').props.onClick(); control('Discard these takes').props.onClick(); assert.equal(retried, 1); assert.equal(discarded, 1);
  recorder.capture.current = { context: {}, analyser: {} };
  for (const disabled of [true, false]) {
    recorder.calibrationDisabled = disabled; tree = state.render(Panel, { recorder, playback: {} });
    assert.equal(control('Calibrate').props.disabled, disabled);
  }
});

test('recorder clears ended idle inputs, retains errors across disarm and clears session after retry/discard', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else delete globalThis.window; });
  let ended, closed = 0, options, pending = false, recoveryReads = 0;
  const reconciled = [];
  const state = hooks();
  const hook = load('useBeatAudioRecording', state, {
    '../../../_lib/music/beat/beatCapture.js': { openBeatCapture: async (context, id, callbacks) => { ended = callbacks.onEnded; return { context, deviceId: id, close() { closed++; } }; } },
    '../../../_lib/music/beat/beatLatency.mjs': { readLatency: () => null },
    '../../../_lib/music/beat/beatTakeStore.js': { reconcileBeatTakes: async saved => { reconciled.push(saved); if (++recoveryReads === 1) throw Error('read failed'); }, pendingBeatTakes: () => [{ id: 'recoverable' }] },
    '../../../_lib/music/beat/beatAudioSegments.mjs': { tickSeconds: () => 0 },
    '../../../_lib/music/beat/beatAudioRecordingSession.js': { createAudioRecording: o => { options = o; return {
      get error() { return pending ? 'disk failed' : ''; }, finishing: true,
      retry: async () => { pending = false; o.onSettled(); o.onState({ status: 'armed', error: '' }); },
      discard: async () => { pending = false; o.onSettled(); o.onState({ status: 'armed', error: '' }); },
    }; } },
  });
  const current = { current: { id: 'beat', tracks: [{ id: 't2' }], tempo: { bpm: 120 } } };
  const announce = () => {}, stop = async () => {}, audio = () => ({ instance: { context: {} }, resumed: Promise.resolve() });
  let playing = false;
  const render = () => state.render(() => hook(current, () => {}, announce, audio, stop, playing));
  render(); await new Promise(resolve => setImmediate(resolve));
  assert.match(render().error, /Couldn't read takes on this device — Retry/);
  const opened = current.current; current.current = { ...opened, title: 'Unsaved edit' };
  await render().retry(); assert.equal(render().error, ''); assert.equal(render().recovery.length, 1); assert.equal(reconciled.at(-1), opened);
  await render().arm('t2'); let recorder = render(); assert.equal(recorder.armedId, 't2');
  ended(); recorder = render(); assert.equal(recorder.armed(), null); assert.equal(recorder.capture.current, null);
  assert.equal(recorder.armedId, null); assert.match(recorder.error, /Microphone disconnected — Arm again/); assert.equal(closed, 1);
  // REVIEW-003: choosing another input after the failure re-arms the same track with that input.
  await recorder.selectDevice('default'); recorder = render(); assert.equal(recorder.armedId, 't2'); assert.equal(recorder.capture.current.deviceId, 'default');
  ended(); recorder = render();
  await recorder.arm('t2'); recorder = render(); assert.equal(recorder.calibrationDisabled, false);
  playing = true; assert.equal(render().calibrationDisabled, true); playing = false;
  for (const action of ['retry', 'discard']) {
    recorder = render(); recorder.begin({}, 0, false); assert.equal(render().calibrationDisabled, true);
    options.onState({ status: 'finishing' }); assert.equal(render().calibrationDisabled, true);
    pending = true; options.onState({ status: 'error', error: 'disk failed' });
    await render().arm(null); recorder = render(); assert.equal(recorder.armedId, null); assert.equal(recorder.hasPending(), true); assert.equal(recorder.error, 'disk failed');
    await recorder.arm('t2'); assert.equal(render().error, 'disk failed');
    await render()[action](); recorder = render(); assert.equal(recorder.hasPending(), false); assert.equal(recorder.error, '');
  }
  state.cleanup();
});

test('My beats only finalizes a plain left-click, preserving browser modified-click behavior', async () => {
  const source = readFileSync(new URL('../app/veyrnox/_components/music/beat/BeatEditor.jsx', import.meta.url), 'utf8');
  const handler = /const back = <Link data-beat-live onClick=\{(async e => .*?)\} className/.exec(source)[1];
  const events = [], playback = { finishRecording: async () => events.push('finish') }, project = { flushLatest: async () => events.push('save') }, router = { push: () => events.push('navigate') };
  const click = new Function('playback', 'project', 'router', `return (${handler});`)(playback, project, router);
  for (const patch of [{ button: 1 }, { button: 2 }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }]) {
    await click({ button: 0, preventDefault() { events.push('prevent'); }, ...patch }); assert.deepEqual(events, []);
  }
  await click({ button: 0, preventDefault() { events.push('prevent'); } }); assert.deepEqual(events, ['prevent', 'finish', 'save', 'navigate']);
});

test('unsaved version restore does not reconcile takes; normal playback can run with pending audio', () => {
  const restore = readFileSync(new URL('../app/veyrnox/_components/music/beat/BeatVersionsPanel.jsx', import.meta.url), 'utf8');
  assert.equal(restore.includes('reconcileBeatTakes'), false);
  const playback = readFileSync(new URL('../app/veyrnox/_components/music/beat/useBeatPlayback.js', import.meta.url), 'utf8');
  const condition = /if \((audioRecorderRef.current\?\.locked\(\).*?)\) \{ announce/.exec(playback)[1];
  const blocked = new Function('audioRecorderRef', 'record', `return ${condition};`);
  const ref = { current: { locked: () => false, hasPending: () => true } };
  assert.equal(blocked(ref, { current: false }), false); assert.equal(blocked(ref, { current: true }), true);
});
