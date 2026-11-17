import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import * as mix from '../app/veyrnox/_lib/music/beat/beatMixOps.mjs';
import * as rules from '../app/veyrnox/_lib/music/beat/beatMixRules.mjs';
import * as controls from '../app/veyrnox/_lib/music/beat/beatMixControls.mjs';
import * as ops from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import { recordingEditAllowed } from '../app/veyrnox/_lib/music/beat/beatRecordingPolicy.mjs';
import { PRESETS } from '../lib/musicInstruments.js';
import { make } from './musicBeatFixtures.mjs';
const require = createRequire(import.meta.url);
const stubs = {
  './beatStyles': { input: '', button: '' },
  '../../../_lib/music/beat/beatMixOps.mjs': mix,
  '../../../_lib/music/beat/beatOps.mjs': ops,
  '../../../_lib/music/beat/beatMixRules.mjs': rules,
  '../../../_lib/music/beat/beatMixControls.mjs': controls,
  '../../../_lib/music/beat/beatMidiOps.mjs': { addMidiRegion() { assert.fail('not part of this interaction'); } },
  '../../../../../lib/musicInstruments.js': { PRESETS },
  './BeatMeter': { __esModule: true, default: () => null },
};
function load(name) {
  const source = readFileSync(new URL(`../app/veyrnox/_components/music/beat/${name}.jsx`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  const compiled = { exports: {} };
  new Function('require', 'module', 'exports', code)(id => stubs[id] || require(id), compiled, compiled.exports);
  stubs[`./${name}`] = compiled.exports; return compiled.exports;
}
load('BeatMixControl');
const { default: Rack } = load('BeatEffectRack'), { default: Channel } = load('BeatChannelStrip');
const { default: Master } = load('BeatMasterStrip'), { default: Header } = load('BeatTrackHeader');
function* elements(node) {
  if (Array.isArray(node)) { for (const child of node) yield* elements(child); }
  else if (node?.props) { yield node; yield* elements(node.props.children); }
}
const find = (tree, label) => [...elements(tree)].find(e => e.props.label === label || e.props['aria-label'] === label);
function recorder(initial) {
  let doc = initial, last;
  return { get doc() { return doc; }, get last() { return last; }, edit(change, options) {
    last = options; if (recordingEditAllowed(true, options)) doc = change(doc);
  } };
}
test('actual mixer handlers permit continuous edits during recording and refuse structural changes', () => {
  let doc = mix.addEffect(make(), 't1', 'eq'); doc = mix.setSend(doc, 't1', 'reverb', 0.2); doc = mix.setMaster(doc, { gain: 0.8 });
  const state = recorder(doc);
  let tree = Rack({ track: state.doc.tracks[0], edit: state.edit });
  const low = find(tree, 'EQ 1 low (dB)'); assert.equal(low.props.liveMix, true); low.props.onChange(4);
  assert.equal(state.last.liveMix, true); assert.equal(state.doc.tracks[0].fx[0].params.low, 4);
  tree = Rack({ track: state.doc.tracks[0], edit: state.edit }); find(tree, 'Bypass EQ 1').props.onClick();
  assert.equal(state.last.liveMix, false); assert.equal(state.doc.tracks[0].fx[0].bypass, false);
  tree = Channel({ doc: state.doc, track: state.doc.tracks[0], edit: state.edit, recording: true });
  const send = find(tree, 'Drums reverb send'); assert.equal(send.props.liveMix, true); send.props.onChange(0.5);
  assert.equal(state.last.liveMix, true); assert.equal(state.doc.tracks[0].sends.reverb, 0.5);
  send.props.onChange(0); assert.equal(state.last.liveMix, false); assert.equal(state.doc.tracks[0].sends.reverb, 0.5);
  tree = Master({ doc: state.doc, edit: state.edit });
  for (const [label, value] of [['Master gain', 0.4], ['Delay time (seconds)', 0.2], ['Delay feedback', 0.5]]) {
    const control = find(tree, label); assert.equal(control.props.liveMix, true); control.props.onChange(value); assert.equal(state.last.liveMix, true);
  }
  assert.equal(state.doc.master.gain, 0.4); assert.deepEqual(state.doc.master.delay, { time: 0.2, feedback: 0.5 });
  find(tree, 'Reverb size').props.onChange(4); assert.equal(state.last.liveMix, false); assert.equal(state.doc.master.reverb.size, 1.6);
  [...elements(tree)].find(e => e.type === 'button' && e.props.children === 'Limiter').props.onClick();
  assert.equal(state.last.liveMix, false); assert.equal(state.doc.master.limiter, true);
});
test('rendered header and mixer independently disable automated lanes during song playback or recording', () => {
  for (const lane of ['gain', 'pan']) for (const [view, recording, disabled] of [['song', false, true], ['pattern', true, true], ['pattern', false, false]]) {
    const doc = mix.addAutomationPoint(make(), 't1', lane, 0, 0.5); doc.view = view; const track = doc.tracks[0];
    const props = { doc, track, mode: view, recording, edit() {}, onSelect() {}, last: false };
    for (const component of [Header, Channel]) {
      const html = renderToStaticMarkup(createElement(component, props));
      for (const param of ['gain', 'pan']) {
        const inputs = html.match(new RegExp(`<input[^>]*aria-label="Drums ${param}"[^>]*>`, 'g'));
        assert.ok(inputs?.length);
        for (const input of inputs) {
          assert.equal(/disabled=""/.test(input), param === lane && disabled);
          assert.equal(/aria-describedby=/.test(input), param === lane && disabled);
        }
      }
      if (disabled) assert.ok(html.includes(controls.automationControl(track, lane, view, recording).message));
      else assert.doesNotMatch(html, /is automated/);
    }
  }
});
