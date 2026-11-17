import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FakeContext, Param } from './musicBeatMixFixtures.mjs';
import { make } from './musicBeatFixtures.mjs';
import { renderSong, renderBeat } from '../app/veyrnox/_lib/music/beat/beatMixdown.js';
import { addEffect } from '../app/veyrnox/_lib/music/beat/beatMixOps.mjs';
function digest(context) {
  const hash = value => createHash('sha256').update(value).digest('hex');
  return hash(JSON.stringify({ frames: context.length, channels: context.channels, sampleRate: context.sampleRate, nodes: context.nodes.map(n => ({
    type: n.type, connections: n.connections.map(d => d === context.destination ? -1 : context.nodes.indexOf(d)),
    channelCount: n.channelCount, channelCountMode: n.channelCountMode, channelInterpretation: n.channelInterpretation,
    params: Object.fromEntries(Object.entries(n).filter(([, p]) => p instanceof Param).map(([k, p]) => [k, { value: p.value, events: p.events }])),
    started: n.started, stopped: n.stopped,
    buffer: n.buffer ? Array.from({ length: n.buffer.numberOfChannels }, (_, ch) => hash(new Uint8Array(n.buffer.getChannelData(ch).buffer))) : null,
  })) }));
}

// Captured by running HEAD's pre-phase-8 renderers against this same tracing context.
const hashes = { song: '6cce605bdf1631e8221b300a02c56b1a55d1e09922a42770f282f085db834a2a',
  pattern: 'c89319e59c21af6c879ed1d55a867abf576d9b3f0dad83008bbccdaf1072e8bd' };
test('no-mixer song and pattern render calls, topology, parameters and seeded buffers match frozen legacy hashes', async t => {
  const previous = globalThis.window; globalThis.window = { OfflineAudioContext: FakeContext }; t.after(() => { globalThis.window = previous; });
  for (const mode of ['song', 'pattern']) {
    const doc = make(); doc.tempo.bpm = 120; doc.swing = 0.37; doc.tracks[0].gain = 0.65; doc.tracks[0].pan = -0.3;
    if (mode === 'song') await renderSong(doc, { buffers: new Map() }); else await renderBeat(doc, 1, 't1');
    assert.equal(digest(FakeContext.instances.at(-1)), hashes[mode]);
  }
});
test('pattern mixer uses manual strip gain/pan, ignores lanes and allocates the effect tail', async t => {
  const previous = globalThis.window; globalThis.window = { OfflineAudioContext: FakeContext }; t.after(() => { globalThis.window = previous; });
  const doc = addEffect(make(), 't1', 'reverb'); doc.tempo.bpm = 120; doc.tracks[0].gain = 0.35; doc.tracks[0].pan = -0.4;
  doc.tracks[0].automation = { gain: [[0, 0.9, 0]], pan: [[0, 1, 0]] };
  await renderBeat(doc, 1, 't1'); const context = FakeContext.instances.at(-1);
  assert.equal(context.length, Math.ceil((2 + 1.6) * 44100));
  const pan = context.nodes.find(n => n.type === 'panner'); assert.equal(pan.pan.value, -0.4); assert.equal(pan.pan.events.length, 0);
  assert.ok(context.nodes.some(n => n.gain.value === 0.35 && n.connections.includes(pan)));
});

test('add/remove EQ restores the legacy pattern renderer, tail and structure signature', async t => {
  const { removeEffect } = await import('../app/veyrnox/_lib/music/beat/beatMixOps.mjs');
  const { mixTailSeconds, hasMixer } = await import('../app/veyrnox/_lib/music/beat/beatMixRules.mjs');
  const { stripSignature } = await import('../app/veyrnox/_lib/music/beat/beatMixGraph.js');
  t.mock.method(Date, 'now', () => 0);
  const original = make(), restored = removeEffect(addEffect(original, 't1', 'eq'), 't1', 'f1');
  assert.deepEqual(restored, original); assert.equal(hasMixer(restored), false); assert.equal(mixTailSeconds(restored), 1.5);
  assert.equal(stripSignature(restored.tracks[0], restored), stripSignature(original.tracks[0], original));
  const previous = globalThis.window; globalThis.window = { OfflineAudioContext: FakeContext }; t.after(() => { globalThis.window = previous; });
  await renderBeat(original, 1, 't1'); const before = digest(FakeContext.instances.at(-1));
  await renderBeat(restored, 1, 't1'); assert.equal(digest(FakeContext.instances.at(-1)), before);
});
