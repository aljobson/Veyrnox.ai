import test from 'node:test';
import assert from 'node:assert/strict';
import { audioDoc, audioRegion, takeAsset } from './musicBeatAudioFixtures.mjs';
import { audioSegments, envelopeGain, songWindowToContext, reverseOffset } from '../app/veyrnox/_lib/music/beat/beatAudioSegments.mjs';
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
test('half-open audio pieces clip mid-region starts and every whole-asset seam', () => {
  const doc = audioDoc(takeAsset(3)); const r = audioRegion(doc); r.length = 8 * 960; r.phaseSec = 1;
  const parts = audioSegments(doc, 1, 7);
  assert.deepEqual(parts.map((s) => [s.songTimeSec, s.offsetSec, s.durationSec]), [[1, 2, 1], [2, 0, 3], [5, 0, 2]]);
  assert.ok(parts.every((s) => !s.isRegionStart && !s.isRegionEnd));
  assert.deepEqual(audioSegments(doc, 8, 9), []);
});
test('fades remain absolute at scheduler slices, locator starts, and loop seams', () => {
  const doc = audioDoc(takeAsset(2)), r = audioRegion(doc); r.length = 8 * 960;
  r.fadeIn = { startSec: 0, endSec: 3 }; r.fadeOut = { startBeforeEndSec: 3, endBeforeEndSec: 0 }; r.gainDb = -3;
  const slices = audioSegments(doc, 1, 7);
  for (const s of slices) { close(s.gain, envelopeGain(r, s.songTimeSec, 60)); close(s.endGain, envelopeGain(r, s.songTimeSec + s.durationSec, 60)); }
  assert.ok(slices[1].gain > 0); close(audioSegments(doc, 0, 8)[0].gain, 0);
  close(audioSegments(doc, 0, 8).at(-1).endGain, 0);
});
// Compare a normalized piecewise function, rather than expecting identical slicing.
function normalize(parts) {
  const out = [];
  for (const s of parts) {
    const last = out.at(-1);
    if (last && Math.abs(last.songTimeSec + last.durationSec - s.songTimeSec) < 1e-7
      && Math.abs(last.offsetSec + last.durationSec - s.offsetSec) < 1e-7) {
      close(last.endGain, s.gain); last.durationSec += s.durationSec; last.endGain = s.endGain;
    } else out.push({ ...s });
  }
  return out;
}
test('random disjoint partitions equal whole-range time, phase, duration and envelope for forward and reverse', () => {
  let seed = 512; const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (const reverse of [false, true]) for (let trial = 0; trial < 40; trial++) {
    const doc = audioDoc(takeAsset(2.75)), r = audioRegion(doc); r.length = 30 * 960; r.phaseSec = random() * 2.75; r.reverse = reverse;
    r.fadeIn = { startSec: -1, endSec: 4 }; r.fadeOut = { startBeforeEndSec: 4, endBeforeEndSec: -1 };
    const start = trial % 2 ? random() * 3 : 0;
    const boundaries = [start, ...Array.from({ length: 35 }, () => start + random() * (30 - start)), 30].sort((a, b) => a - b);
    const split = normalize(boundaries.slice(0, -1).flatMap((at, i) => audioSegments(doc, at, boundaries[i + 1])));
    const whole = normalize(audioSegments(doc, start, 30)); assert.equal(split.length, whole.length);
    split.forEach((s, i) => { for (const key of ['songTimeSec', 'offsetSec', 'durationSec', 'gain', 'endGain']) close(s[key], whole[i][key]); assert.equal(s.reverse, reverse); });
  }
  assert.equal(reverseOffset(1.25), 1.25);
});
test('audio shares mute and solo with drums', () => {
  const doc = audioDoc(); doc.tracks[0].solo = true; assert.equal(audioSegments(doc, 0, 3).length, 0);
  doc.tracks[1].solo = true; assert.equal(audioSegments(doc, 0, 3).length, 1);
  doc.tracks[1].mute = true; assert.equal(audioSegments(doc, 0, 3).length, 0);
});
test('cycle mapping is half open, monotonic, and covers many wraps in a hidden lookahead', () => {
  for (const [startSec, from, to, cycle] of [[0, 0, 1.5, { start: 0, end: 0.0625 }], [1.99, 0, 7, { start: 1, end: 2 }], [0, 0.5, 30, { start: 1, end: 3 }]]) {
    const parts = songWindowToContext(from, to, { startSec, contextStart: 10, cycle });
    close(parts.reduce((n, p) => n + p.toSec - p.fromSec, 0), to - from);
    parts.forEach((p, i) => { assert.ok(p.toSec <= cycle.end + 1e-9); if (i) close(p.contextTime, parts[i - 1].contextTime + parts[i - 1].toSec - parts[i - 1].fromSec); });
  }
  assert.equal(songWindowToContext(0, 1.5, { cycle: { start: 0, end: 0.0625 } }).length, 24);
});
