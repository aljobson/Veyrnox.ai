import test from 'node:test';
import assert from 'node:assert/strict';
import { audioDoc, audioRegion, takeAsset } from './musicBeatAudioFixtures.mjs';
import { audioSegments, envelopeGain } from '../app/veyrnox/_lib/music/beat/beatAudioSegments.mjs';
import { playAudioSegment } from '../app/veyrnox/_lib/music/beat/beatAudioGraph.js';
import { createScheduler } from '../app/veyrnox/_lib/music/beat/beatScheduler.mjs';
import { sequenceFor } from '../app/veyrnox/_lib/music/beat/beatSequence.mjs';
class Param {
  value = 1; events = [];
  setValueAtTime(value, time) { this.events.push({ value, time }); }
  linearRampToValueAtTime(value, time) { this.events.push({ value, time }); }
  at(time) {
    let prev = this.events[0]; if (!prev) return this.value;
    for (const next of this.events.slice(1)) { if (next.time >= time) return next.time === prev.time ? next.value : prev.value + (next.value - prev.value) * (time - prev.time) / (next.time - prev.time); prev = next; }
    return prev.value;
  }
}
class Node { gain = new Param(); connect(node) { this.output = node; return node; } disconnect() {} start(...args) { this.args = args; } }
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
test('shared graph schedules start offset/duration and the exact multiplied envelope under slicing', () => {
  const doc = audioDoc(takeAsset(3)), r = audioRegion(doc); r.length = 8 * 960; r.gainDb = -3;
  r.fadeIn = { startSec: -1, endSec: 5 }; r.fadeOut = { startBeforeEndSec: 5, endBeforeEndSec: -1 };
  for (const segment of audioSegments(doc, 1.2, 7.1)) {
    const gains = [], context = { createBufferSource: () => new Node(), createGain: () => { const n = new Node(); gains.push(n); return n; } };
    const { source } = playAudioSegment(context, {}, {}, segment, r, 60, segment.songTimeSec + 10);
    assert.deepEqual(source.args, [segment.songTimeSec + 10, segment.offsetSec, segment.durationSec]);
    for (let at = segment.songTimeSec; at <= segment.songTimeSec + segment.durationSec; at += 0.03)
      close(gains.reduce((n, node) => n * node.gain.at(at + 10), 1), envelopeGain(r, at, 60));
  }
});
test('scheduler audio cursor covers many tiny cycles once, including a mid-region locator', () => {
  const doc = audioDoc(); doc.tempo.bpm = 240; doc.cycle = { on: true, start: 240, end: 480 };
  let now = 10, callback; const scheduled = [];
  const scheduler = createScheduler({ clock: () => now, setTimer: (fn) => { callback = fn; }, clearTimer: () => {}, isHidden: () => true,
    getSequence: () => sequenceFor(doc, 240), onStep: () => {}, onEvent: () => {}, onAudio: (s, at) => scheduled.push({ s, at }) });
  scheduler.start(10);
  assert.equal(scheduled.length, 24); close(scheduled[0].s.offsetSec, 0.0625);
  now += 0.1; callback();
  const before = scheduled.length; scheduler.refill(); assert.equal(scheduled.length, before);
  for (let i = 1; i < scheduled.length; i++) close(scheduled[i].at, scheduled[i - 1].at + scheduled[i - 1].s.durationSec);
  scheduler.stop();
});
