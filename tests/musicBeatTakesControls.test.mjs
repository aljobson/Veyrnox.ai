import test from 'node:test';
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
    if (!old || deps.some((d, i) => d !== old.deps[i])) slots[n] = { deps, value: make() };
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
  const source = readFileSync(new URL(`../app/veyrnox/_components/music/beat/${name}.jsx`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const compiled = { exports: {} }, stubs = { react: state.react, './beatStyles': {},
    './BeatTakeWaveform': { __esModule: true, default: () => null }, '../../../_lib/music/beat/beatTakeOps.mjs': takeOps, ...extra };
  new Function('require', 'module', 'exports', code)(id => stubs[id] || require(id), compiled, compiled.exports);
  return compiled.exports.default;
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
