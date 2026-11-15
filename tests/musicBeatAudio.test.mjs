import test from 'node:test';
import assert from 'node:assert/strict';
import { createBeatEngine } from '../app/veyrnox/_lib/music/beat/beatEngine.js';
import { renderBeat } from '../app/veyrnox/_lib/music/beat/beatMixdown.js';
import { createBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import { stepTime, loopSeconds } from '../app/veyrnox/_lib/music/beat/beatTime.mjs';
class Param {
  value = 1; calls = [];
  setValueAtTime(value, time) { this.calls.push(['set', value, time]); }
  cancelScheduledValues(time) { this.calls.push(['cancel', time]); }
  linearRampToValueAtTime(value, time) { this.calls.push(['linear', value, time]); }
  exponentialRampToValueAtTime(value, time) { this.calls.push(['exponential', value, time]); }
}
class Node {
  constructor(type) { this.type = type; this.gain = new Param(); this.frequency = new Param(); this.outputs = []; }
  connect(node) { this.outputs.push(node); return node; }
  disconnect() { this.disconnected = true; }
  start(at) { this.started = at; }
  stop(at) { this.stopped = at; }
}
class Context {
  static instances = [];
  currentTime = 1; sampleRate = 44100; nodes = []; destination = new Node('destination');
  constructor(channels, length, rate) { this.options = { channels, length, rate }; Context.instances.push(this); }
  node(type) { const node = new Node(type); this.nodes.push(node); return node; }
  createGain() { return this.node('gain'); }
  createDynamicsCompressor() { return this.node('compressor'); }
  createOscillator() { return this.node('oscillator'); }
  createBufferSource() { return this.node('source'); }
  createBiquadFilter() { return this.node('filter'); }
  createBuffer(channels, length) { const data = new Float32Array(length); return { getChannelData: () => data }; }
  resume() { return Promise.resolve(); }
  close() { this.closed = true; return Promise.resolve(); }
  startRendering() { return Promise.resolve({ getChannelData: () => new Float32Array(this.options.length), sampleRate: this.sampleRate }); }
}
test('Stop fades and disconnects the old queue; fresh runs and auditions have independent destinations', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const previous = globalThis.window; globalThis.window = { AudioContext: Context };
  t.after(() => { globalThis.window = previous; });
  const engine = createBeatEngine();
  const run = engine.startRun();
  engine.playPad('kick', 100 / 127, 2, run.bus, '808');
  engine.click(2, true, run.bus);
  engine.playPad('kick', 100 / 127, 1, engine.master, '808');
  const oscillators = engine.context.nodes.filter((n) => n.type === 'oscillator');
  assert.deepEqual(oscillators.map((n) => n.started), [2, 2, 1]);
  assert.equal(oscillators[0].outputs[0].outputs[0], run.bus);
  assert.equal(oscillators[1].outputs[0].outputs[0], run.bus);
  assert.equal(oscillators[2].outputs[0].outputs[0], engine.master);
  engine.stopRun(run);
  assert.deepEqual(run.bus.gain.calls.at(-1), ['linear', 0, 1.01]);
  const next = engine.startRun(); assert.notEqual(next.id, run.id); assert.notEqual(next.bus, run.bus);
  t.mock.timers.tick(59); assert.equal(run.bus.disconnected, undefined);
  t.mock.timers.tick(1); assert.equal(run.bus.disconnected, true); assert.equal(next.bus.disconnected, undefined);
  await engine.close(); assert.equal(engine.context.closed, true);
});
test('WAV mixdown uses mono 44.1 kHz, shared drum voices, swung loop times, tail and no metronome', async (t) => {
  const previous = globalThis.window; globalThis.window = { OfflineAudioContext: Context };
  t.after(() => { globalThis.window = previous; });
  const doc = createBeat({ id: 'e40439d1-646a-4c11-9c12-69fa3a851234', now: 0 });
  doc.tempo.bpm = 120; doc.swing = 0.5; doc.metronome = true; doc.patterns.A.rows = { kick: [[1, 100]] };
  const result = await renderBeat(doc, 2);
  const context = Context.instances.at(-1);
  const length = loopSeconds(120, 16);
  assert.deepEqual(context.options, { channels: 1, length: Math.ceil((length * 2 + 1.5) * 44100), rate: 44100 });
  assert.equal(result.sampleRate, 44100); assert.equal(result.samples.length, context.options.length);
  const starts = context.nodes.filter((n) => n.type === 'oscillator').map((n) => n.started);
  assert.deepEqual(starts, [stepTime(1, 120, 0.5), length + stepTime(1, 120, 0.5)]);
});
