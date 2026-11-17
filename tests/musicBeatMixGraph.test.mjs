import test from 'node:test';
import assert from 'node:assert/strict';
import { make } from './musicBeatFixtures.mjs';
import { FakeContext } from './musicBeatMixFixtures.mjs';
import { buildMaster, buildTrackStrip, stripSignature } from '../app/veyrnox/_lib/music/beat/beatMixGraph.js';
import { canonicalImpulse, roomImpulse, resampleImpulse, EFFECT_UNAVAILABLE } from '../app/veyrnox/_lib/music/beat/beatEffects.js';
import { beatOutput, connectTrackChannel } from '../app/veyrnox/_lib/music/beat/beatOutput.js';
import { DEFAULT_MASTER, mixTailSeconds } from '../app/veyrnox/_lib/music/beat/beatMixRules.mjs';
import { addEffect, setEffectBypass, setSend, setEffectParam } from '../app/veyrnox/_lib/music/beat/beatMixOps.mjs';
import { exportSize } from '../app/veyrnox/_lib/music/beat/beatSequence.mjs';
import { chunkPlan } from '../app/veyrnox/_lib/music/beat/beatExport.mjs';
import { midiDoc } from './musicBeatMidiFixtures.mjs';
import { renderSong, renderBeat } from '../app/veyrnox/_lib/music/beat/beatMixdown.js';
function topology(context) { return context.nodes.map(n => ({ type: n.type, gain: n.gain.value, pan: n.pan.value, to: n.connections.map(dest => dest === context.destination ? 'destination' : context.nodes.indexOf(dest)) })); }
test('absent mixer fields preserve exact master/track node calls and topology', () => {
  const doc = make(), old = new FakeContext(), current = new FakeContext();
  const destination = beatOutput(old); connectTrackChannel(old, destination, doc.tracks[0].gain, doc.tracks[0].pan);
  const master = buildMaster(current, doc); buildTrackStrip(current, master, doc.tracks[0], { doc, automationActive: true });
  assert.deepEqual(topology(current), topology(old)); assert.equal(master.sends, null);
});
test('ordered inserts skip bypass, separate mute from automation, and connect post-pan sends only when positive', () => {
  let doc = setSend(setEffectBypass(addEffect(addEffect(make(), 't1', 'eq'), 't1', 'compressor'), 't1', 'f2', true), 't1', 'reverb', 0.2);
  doc.master = structuredClone(DEFAULT_MASTER); doc.tracks[0].automation = { gain: [[0, 0.8, 0]], pan: [[0, -0.5, 0]] };
  const c = new FakeContext(), master = buildMaster(c, doc), strip = buildTrackStrip(c, master, doc.tracks[0], { doc, automationActive: true });
  assert.equal(strip.chain.length, 1); assert.equal(strip.chain[0].nodes.length, 3); assert.equal(master.sends.delay, undefined);
  assert.ok(strip.panner.connections.includes(strip.sends.reverb)); assert.equal(strip.sends.reverb.connections[0], master.sends.reverb);
  strip.schedule({ fromSec: 0, toSec: 1, contextTime: 0 }); doc.tracks[0].mute = true; strip.update(doc.tracks[0], doc, 0.2);
  assert.equal(strip.input.gain.events.at(-1).value, 0); assert.equal(strip.fader.gain.at(0.5), 0.8); assert.equal(strip.panner.pan.at(0.5), -0.5);
  assert.equal(master.output.threshold.value, -1); assert.equal(master.output.ratio.value, 20);
  const pattern = buildTrackStrip(c, master, doc.tracks[0], { doc, automationActive: false }); pattern.schedule({ fromSec: 0, toSec: 1, contextTime: 0 });
  assert.equal(pattern.fader.gain.value, doc.tracks[0].gain); assert.equal(pattern.panner.pan.value, doc.tracks[0].pan);
});
test('continuous params keep signature and use target smoothing once; structural changes rebuild', () => {
  const doc = addEffect(make(), 't1', 'reverb'), signature = stripSignature(doc.tracks[0], doc);
  const continuous = setEffectParam(doc, 't1', 'f1', 'mix', 0.4); assert.equal(stripSignature(continuous.tracks[0], continuous), signature);
  const structural = setEffectParam(doc, 't1', 'f1', 'size', 4); assert.notEqual(stripSignature(structural.tracks[0], structural), signature);
  assert.notEqual(stripSignature(setSend(doc, 't1', 'delay', 0.1).tracks[0], doc), signature);
  const c = new FakeContext(), master = buildMaster(c, continuous), strip = buildTrackStrip(c, master, continuous.tracks[0], { doc: continuous });
  continuous.tracks[0].gain = 0.4; strip.update(continuous.tracks[0], continuous, 1); strip.update(continuous.tracks[0], continuous, 2);
  assert.deepEqual(strip.fader.gain.events, [{ type: 'target', value: 0.4, time: 1, constant: 0.01 }]);
});
test('seeded impulses match canonical 48 kHz and deterministic 44.1 kHz resampling across contexts; cache is per context', () => {
  const a = new FakeContext(), b = new FakeContext(2, 1, 44100), c = new FakeContext(2, 1, 44100);
  for (const size of [0.8, 1.6, 2.8, 4]) {
    const impulse = roomImpulse(a, size); assert.equal(roomImpulse(a, size), impulse);
    for (let ch = 0; ch < 2; ch++) {
      assert.deepEqual(impulse.getChannelData(ch), canonicalImpulse(size)[ch]);
      assert.deepEqual(roomImpulse(b, size).getChannelData(ch), resampleImpulse(canonicalImpulse(size)[ch], 44100));
      assert.deepEqual(roomImpulse(b, size).getChannelData(ch), roomImpulse(c, size).getChannelData(ch));
    }
  }
});
test('bounded tails affect export frames and reconstruction, with whole render fallback', () => {
  const old = make(); assert.equal(mixTailSeconds(old), 1.5); assert.equal(exportSize(old).frames, Math.ceil((exportSize(old).seconds + 1.5) * 44100));
  let doc = addEffect(old, 't1', 'reverb'); assert.equal(mixTailSeconds(doc), 1.6);
  doc = setEffectParam(doc, 't1', 'f1', 'size', 4); doc = setSend(doc, 't1', 'reverb', 1); assert.equal(mixTailSeconds(doc), 5.6);
  doc = addEffect(addEffect(doc, 't1', 'delay'), 't1', 'reverb'); doc.tracks[0].fx[1].params = { time: 1, feedback: 0.8, mix: 1 }; assert.equal(mixTailSeconds(doc), 10);
  doc.tracks[0].fx.forEach(f => { f.bypass = true; }); assert.equal(mixTailSeconds(doc), 1.6);
  doc.tracks[0].fx[1].bypass = false; doc.tracks[0].fx[1].params.feedback = 0; assert.equal(mixTailSeconds(doc), 2.6);
  const long = make(); long.tracks[0].regions[0].length = 240 * 960;
  const baseline = chunkPlan(long); long.master = structuredClone(DEFAULT_MASTER);
  assert.ok(chunkPlan(long)[1].originSec <= baseline[1].originSec - 1.5);
  long.patterns.A.rows = {}; assert.equal(chunkPlan(long)[1].originSec, 56.5);
  const midi = midiDoc(); midi.clips.c1.lengthTicks = 64 * 3840; midi.tracks[1].regions[0].length = 120 * 1920;
  midi.clips.c1.notes = [[32 * 1920, 29 * 1920, 48, 100]];
  assert.ok(chunkPlan(midi)); midi.tracks[1].fx = [{ id: 'f1', type: 'delay', bypass: false, params: { time: 1, feedback: 0.8, mix: 1 } }];
  assert.equal(chunkPlan(midi), null);
  // A voice that ended before the boundary can still feed an effect tail there.
  midi.clips.c1.notes = [[35 * 1920, 20 * 1920, 48, 100]];
  assert.equal(chunkPlan(midi), null);
});
test('unsupported inserts skip with a live error, and both exports refuse instead of differing', async t => {
  const doc = addEffect(make(), 't1', 'reverb'), c = new FakeContext(); c.createConvolver = undefined;
  const errors = [], master = buildMaster(c, doc), strip = buildTrackStrip(c, master, doc.tracks[0], { doc, onError: e => errors.push(e) });
  assert.deepEqual(errors, [EFFECT_UNAVAILABLE]); assert.equal(strip.chain.length, 0);
  class Unsupported extends FakeContext { createConvolver = undefined; }
  const previous = globalThis.window; globalThis.window = { OfflineAudioContext: Unsupported }; t.after(() => { globalThis.window = previous; });
  await assert.rejects(renderSong(doc, { buffers: new Map() }), { message: EFFECT_UNAVAILABLE });
  await assert.rejects(renderBeat(doc, 1, 't1'), { message: EFFECT_UNAVAILABLE });
});
