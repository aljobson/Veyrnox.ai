import test from 'node:test';
import assert from 'node:assert/strict';
import { startVoice, voiceEnvelopePlan, createVoicePool } from '../app/veyrnox/_lib/music/beat/beatVoices.js';
import { renderBeat, renderSong } from '../app/veyrnox/_lib/music/beat/beatMixdown.js';
import { audioMock } from './musicBeatVoiceFixtures.mjs';
import { midiDoc } from './musicBeatMidiFixtures.mjs';
test('gated voices hold indefinitely, release at the note end, stop in 10ms and resolve ended', async () => {
  for (const [id, preset, tail] of [['bass', 'sub', 0.9], ['synth', 'pad', 1.1], ['piano', 'organ', 0.08], ['wavetable', 'glass', 0.38]]) {
    const context = audioMock(), instrument = { engine: id === 'wavetable' ? 'wavetable' : 'voice', id, preset };
    const voice = startVoice(context, context.destination, {}, instrument, 60, 100, 1);
    assert.equal(voice.endTime, Infinity); assert.ok(voice.ended instanceof Promise);
    voice.release(3); assert.ok(Math.abs(voice.endTime - (3 + tail + (id === 'wavetable' ? 0.05 : 0.01))) < 1e-9);
    voice.stop(2); assert.equal(voice.endTime, 2.01);
    context.nodes.findLast((n) => n.kind === 'Oscillator').onended(); await voice.ended;
    assert.ok(context.nodes.slice(0, -2).every((n) => n.disconnected));
  }
});
test('natural voices damp early; drums ignore all releases; unmapped drums create no sounding source', () => {
  const context = audioMock();
  const guitar = startVoice(context, {}, {}, { engine: 'voice', id: 'guitar', preset: 'nylon' }, 60, 100, 1);
  assert.equal(guitar.endTime, 3.6); guitar.release(1.5); assert.ok(Math.abs(guitar.endTime - 1.63) < 1e-9);
  const drum = startVoice(context, {}, {}, { engine: 'voice', id: 'drums', preset: '808' }, 36, 100, 1), end = drum.endTime;
  drum.release(1.001); assert.equal(drum.endTime, end);
  const before = context.nodes.length; startVoice(context, {}, {}, { engine: 'voice', id: 'drums', preset: '808' }, 60, 100, 1);
  assert.equal(context.nodes.slice(before).filter((n) => n.start).length, 1); // silent cleanup sentinel only
});
test('pure timing plans include gated hold/release and natural damping', () => {
  assert.deepEqual(voiceEnvelopePlan('bass', 'sub', 1, 2), [['setValueAtTime', 0.0001, 1], ['exponentialRampToValueAtTime', 1, 1.006], ['setValueAtTime', 1, 2], ['exponentialRampToValueAtTime', 0.0001, 2.9]]);
  assert.deepEqual(voiceEnvelopePlan('guitar', 'nylon', 1, 1.5), [['setValueAtTime', 1, 1], ['setValueAtTime', 1, 1.5], ['linearRampToValueAtTime', 0, 1.62]]);
});
test('voice pool steals oldest first above 32 per track and retires elapsed voices', () => {
  const pool = createVoicePool(), stopped = [];
  const voice = (i, endTime = Infinity) => ({ endTime, ended: new Promise(() => {}), stop: (at) => stopped.push([i, at]) });
  for (let i = 0; i < 34; i++) pool.add('t1', voice(i), i);
  pool.add('t2', voice(99), 34); assert.deepEqual(stopped, [[0, 32], [1, 33]]);
  const quiet = createVoicePool(); for (let i = 0; i < 50; i++) quiet.add('t1', voice(i, i + 0.5), i);
  assert.equal(stopped.length, 2);
});
for (const cancelAndHold of [true, false]) test(`song export schedules the shared MIDI voice through stereo channels (cancelAndHold=${cancelAndHold})`, async () => {
  const old = globalThis.window, context = audioMock({ cancelAndHold });
  globalThis.window = { OfflineAudioContext: function () { return context; } };
  try {
    const doc = midiDoc([[960, 480, 48, 100]]); doc.tracks[0].regions = [];
    const rendered = await renderSong(doc, { buffers: new Map() });
    assert.equal(rendered.channels.length, 2);
    const bass = context.nodes.find((n) => n.kind === 'Oscillator' && n.frequency.value < 200 && n.frequency.value > 100);
    assert.equal(bass.startedAt, 0.5);
    assert.ok(bass.stops.some((at) => Math.abs(at - 1.66) < 1e-9));
  } finally { globalThis.window = old; }
});
test('missing cancelAndHoldAtTime preserves attack, sustain and release levels for release and stop', () => {
  const context = audioMock({ cancelAndHold: false });
  const voice = startVoice(context, {}, {}, { engine: 'voice', id: 'bass', preset: 'sub' }, 48, 100, 1);
  const gain = context.nodes[0].gain;
  assert.equal(gain.cancelAndHoldAtTime, undefined);
  voice.release(1.003);
  const held = gain.calls.find((c) => c[0] === 'setValueAtTime' && c[2] === 1.003);
  assert.ok(Math.abs(held[1] - 0.01) < 1e-9);
  assert.ok(gain.calls.some((c) => c[0] === 'exponentialRampToValueAtTime' && c[2] === 1.003));
  voice.stop(1.453);
  const stopped = gain.calls.find((c) => c[0] === 'setValueAtTime' && c[2] === 1.453);
  assert.ok(Math.abs(stopped[1] - 0.001) < 1e-9);
  assert.ok(gain.calls.some((c) => c[0] === 'cancelScheduledValues' && c[1] === 1.453));
  assert.equal(voice.endTime, 1.463);
  for (const [id, preset] of [['wavetable', 'glass'], ['piano', 'organ'], ['synth', 'pad'], ['guitar', 'nylon'], ['drums', '808']]) {
    const ctx = audioMock({ cancelAndHold: false });
    const v = startVoice(ctx, {}, {}, { engine: id === 'wavetable' ? 'wavetable' : 'voice', id, preset }, 36, 100, 1);
    v.release(2); v.stop(2.05);
    const value = ctx.nodes[0].gain.calls.findLast((c) => c[0] === 'setValueAtTime')[1];
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
    assert.ok(Math.abs(v.endTime - 2.06) < 1e-9);
  }
});
test('pattern export refuses a MIDI edit track before allocating audio', async () => {
  await assert.rejects(renderBeat(midiDoc(), 1, 't2'), /Use song export to export MIDI tracks/);
});
