import test from 'node:test';
import assert from 'node:assert/strict';
import { createBeatEngine } from '../app/veyrnox/_lib/music/beat/beatEngine.js';
import { renderBeat, renderSong } from '../app/veyrnox/_lib/music/beat/beatMixdown.js';
import { createBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import { stepTime, loopSeconds } from '../app/veyrnox/_lib/music/beat/beatTime.mjs';
import { renderStarterSound } from '../app/veyrnox/_lib/music/beat/beatSoundRenderer.mjs';
import { createWebSoundRenderer } from '../app/veyrnox/_lib/music/beat/beatSoundWeb.mjs';
import { soundDuration } from '../app/veyrnox/_lib/music/beat/beatSounds.mjs';
import { seededRandom } from '../app/veyrnox/_lib/music/beat/beatSeed.mjs';
class Param {
  value = 1; calls = [];
  setValueAtTime(value, time) { this.calls.push(['set', value, time]); }
  setTargetAtTime(value, time, constant) { this.calls.push(['target', value, time, constant]); }
  cancelScheduledValues(time) { this.calls.push(['cancel', time]); }
  linearRampToValueAtTime(value, time) { this.calls.push(['linear', value, time]); }
  exponentialRampToValueAtTime(value, time) { this.calls.push(['exponential', value, time]); }
}
class Node {
  constructor(type) { this.type = type; this.gain = new Param(); this.pan = new Param(); this.frequency = new Param(); this.outputs = []; }
  connect(node) { this.outputs.push(node); return node; }
  disconnect() { this.disconnected = true; }
  start(at) { this.started = at; }
  stop(at) { this.stopped = at; }
}
class Context {
  static instances = [];
  currentTime = 1; sampleRate = 44100; nodes = []; destination = new Node('destination');
  constructor(channels, length, rate) { this.options = { channels, length, rate }; this.sampleRate = rate || 44100; Context.instances.push(this); }
  node(type) { const node = new Node(type); this.nodes.push(node); return node; }
  createStereoPanner() { return this.node('panner'); }
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

const soundTrace = (context) => ({
  options: context.options,
  noise: Array.from(context.buffers[0].getChannelData(0).subarray(0, 8)),
  nodes: context.nodes.map(node => ({
    type: node.type,
    gain: { value: node.gain.value, calls: node.gain.calls },
    frequency: { value: node.frequency.value, calls: node.frequency.calls },
    started: node.started,
    stopped: node.stopped,
    outputs: node.outputs.map(output => output.type),
  })),
});
class SoundContext extends Context {
  buffers = [];
  createBuffer(channels, length, sampleRate = this.sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    const buffer = { numberOfChannels: channels, length, sampleRate, getChannelData: channel => data[channel] };
    this.buffers.push(buffer); return buffer;
  }
  startRendering() { return Promise.resolve(this.createBuffer(this.options.channels, this.options.length, this.sampleRate)); }
}

test('shared Starter Sound renderer preserves the web tonal graph, exact 48 kHz factory contract and seeded noise', async () => {
  const bpm = 120, seed = 9182, neutral = [];
  await renderStarterSound('sub-one', bpm, (channels, frames, rate) => {
    const context = new SoundContext(channels, frames, rate); neutral.push(context); return context;
  }, seededRandom(seed));
  assert.deepEqual(neutral[0].options, { channels: 2, length: Math.round(soundDuration('sub-one', bpm) * 48000), rate: 48000 });
  assert.equal(neutral[0].nodes[0].type, 'gain'); assert.equal(neutral[0].nodes[0].gain.value, 0.65);

  const web = [], webFactoryCalls = [];
  const renderSound = createWebSoundRenderer((...args) => {
    webFactoryCalls.push(args);
    const [channels, frames] = args;
    const context = new SoundContext(channels, frames, 48000); web.push(context); return context;
  });
  await renderSound('sub-one', bpm, seededRandom(seed));
  assert.deepEqual(webFactoryCalls, [[2, Math.round(soundDuration('sub-one', bpm) * 48000)]]);
  assert.deepEqual(soundTrace(web[0]), soundTrace(neutral[0]));
  const other = [];
  await renderStarterSound('sub-one', bpm, (channels, frames, rate) => {
    const context = new SoundContext(channels, frames, rate); other.push(context); return context;
  }, seededRandom(seed + 1));
  assert.notDeepEqual(Array.from(web[0].buffers[0].getChannelData(0).subarray(0, 8)),
    Array.from(other[0].buffers[0].getChannelData(0).subarray(0, 8)));
});

test('shared Starter Sound renderer preserves the production FX sweep and refuses unknown sounds before allocation', async () => {
  const bpm = 96, contexts = [], factory = (channels, frames, rate) => {
    const context = new SoundContext(channels, frames, rate); contexts.push(context); return context;
  };
  await renderStarterSound('sweep', bpm, factory, seededRandom(7));
  const context = contexts[0], sweep = context.nodes.find(node => node.frequency.calls.some(call => call[1] === 150));
  assert.ok(sweep); assert.equal(sweep.type, 'lowpass');
  assert.deepEqual(sweep.frequency.calls, [['set', 150, 0], ['exponential', 8000, soundDuration('sweep', bpm)]]);
  const before = contexts.length;
  await assert.rejects(() => renderStarterSound('missing', bpm, factory), /Starter sound is unavailable/);
  assert.equal(contexts.length, before);
});
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

test('live track routing explicitly duplicates mono before panning and smooths mix changes', async (t) => {
  const previous = globalThis.window; globalThis.window = { AudioContext: Context };
  t.after(() => { globalThis.window = previous; });
  const engine = createBeatEngine(), run = engine.startRun();
  const channel = engine.trackChannel(run, 't1');
  assert.equal(channel.input.channelCount, 2);
  assert.equal(channel.input.channelCountMode, 'explicit');
  assert.equal(channel.input.channelInterpretation, 'speakers');
  assert.equal(channel.input.outputs[0], channel.panner);
  assert.equal(channel.panner.outputs[0], run.bus);
  assert.equal(engine.trackChannel(run, 't1'), channel);
  engine.setTrackMix(run, 't1', 0.25, -1);
  assert.deepEqual(channel.input.gain.calls.at(-1), ['target', 0.25, 1, 0.01]);
  assert.deepEqual(channel.panner.pan.calls.at(-1), ['target', -1, 1, 0.01]);
  engine.setTrackMix(run, 't1', 0.25, -1); assert.equal(channel.input.gain.calls.length, 1);
  const nextRun = engine.startRun();
  const fresh = engine.setTrackMix(nextRun, 't1', 0.4, 1);
  assert.equal(fresh.gain.value, 0.4); assert.equal(fresh.outputs[0].pan.value, 1);
  assert.equal(fresh.gain.calls.length, 0); // Initial mix is exact, later slider changes are smoothed.
  assert.notEqual(engine.trackChannel(nextRun, 't1'), channel);
  await engine.close();
});
test('song mixdown uses stereo, exact cycle frames, global swing, explicit track routing and rejects oversized ranges', async (t) => {
  const previous = globalThis.window; globalThis.window = { OfflineAudioContext: Context };
  t.after(() => { globalThis.window = previous; });
  const doc = createBeat({ id: 'e40439d1-646a-4c11-9c12-69fa3a851234', now: 0 });
  doc.tempo.bpm = 120; doc.swing = 0.5; doc.metronome = true;
  doc.patterns.A.rows = { kick: [[1, 100]] };
  doc.cycle = { on: true, start: 240, end: 17 * 240 };
  doc.tracks[0].gain = 0.5; doc.tracks[0].pan = 1;
  const result = await renderSong(doc, { range: 'cycle' }), context = Context.instances.at(-1);
  assert.deepEqual(context.options, { channels: 2, length: (2 + 1.5) * 48000, rate: 48000 });
  assert.equal(result.channels.length, 2);
  assert.equal(result.channels[0].length, context.options.length);
  const starts = context.nodes.filter((n) => n.type === 'oscillator').map((n) => n.started);
  assert.deepEqual(starts, [0.03125]);
  const trackInput = context.nodes.find((n) => n.channelCountMode === 'explicit');
  assert.equal(trackInput.channelCount, 2); assert.equal(trackInput.channelInterpretation, 'speakers');
  assert.equal(trackInput.gain.value, 0.5); assert.equal(trackInput.outputs[0].pan.value, 1);
  doc.tempo.bpm = 40; doc.cycle.end = 102 * 3840;
  const before = Context.instances.length;
  await assert.rejects(() => renderSong(doc, { range: 'cycle' }), { name: 'RangeError' });
  assert.equal(Context.instances.length, before);
});
