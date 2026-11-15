import test from 'node:test';
import assert from 'node:assert/strict';
import { audioDoc, audioRegion, takeAsset, soundAsset } from './musicBeatAudioFixtures.mjs';
import * as ops from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import { audioSegments, envelopeGain, tickSeconds } from '../app/veyrnox/_lib/music/beat/beatAudioSegments.mjs';
import { createHistory, record, undo } from '../app/veyrnox/_lib/music/beat/beatHistory.mjs';
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function sameRetained(before, after, excluded = []) {
  for (let at = 0.01; at < 12; at += 0.07) {
    if (excluded.some(([a, b]) => at >= a && at < b)) continue;
    const original = audioSegments(before, at, at + 0.001)[0], kept = audioSegments(after, at, at + 0.001)[0];
    if (!kept) continue;
    assert.ok(original); close(original.offsetSec, kept.offsetSec); close(original.gain, kept.gain); close(original.endGain, kept.endGain);
  }
}
test('add, move, loop extend, copy and cross-kind refusal', () => {
  const doc = audioDoc(), r = audioRegion(doc);
  const moved = ops.moveRegion(doc, r.id, 4 * 3840, 't2'); assert.equal(audioRegion(moved).start, 4 * 3840);
  const longer = ops.resizeRegion(doc, r.id, 12 * 960); assert.equal(audioSegments(longer, 0, 12).length, 4);
  const copied = ops.copyRegion(doc, r.id, 8 * 3840, 't2'); assert.equal(copied.tracks[1].regions.length, 2);
  assert.match(ops.tryOp(doc, (d) => ops.moveRegion(d, r.id, 0, 't1')).refused, /same kind/);
  assert.match(ops.tryOp(doc, (d) => ops.copyRegion(d, 'r1', 0, 't2')).refused, /same kind/);
  assert.match(ops.tryOp(doc, (d) => ops.addRegion(d, 't2', 0, 'A')).refused, /same kind/);
});
test('splits, trim-start, end trim and overlap survivors retain phase and anchored fades', () => {
  for (const reverse of [false, true]) for (const at of [960, 4 * 960, 10 * 960]) {
    let doc = audioDoc(takeAsset(2.5)); const r = audioRegion(doc); r.length = 12 * 960; r.phaseSec = 1; r.reverse = reverse;
    r.fadeIn = { startSec: 0, endSec: 3 }; r.fadeOut = { startBeforeEndSec: 3, endBeforeEndSec: 0 };
    sameRetained(doc, ops.splitRegion(doc, r.id, at));
    const trimmed = ops.trimRegionStart(doc, r.id, at); sameRetained(doc, trimmed);
    close(audioRegion(trimmed).phaseSec, (1 + at / 960) % 2.5);
    sameRetained(doc, ops.resizeRegion(doc, r.id, at));
    const added = ops.addAudioRegion(doc, takeAsset(1), 't2', at);
    sameRetained(doc, added, [[at / 960, at / 960 + 1]]);
  }
});
test('sound phase survives tempo changes, fades clamp, undo restores assets and anchors', () => {
  let doc = audioDoc(soundAsset()); const id = audioRegion(doc).id;
  doc = ops.trimRegionStart(doc, id, 960); doc = ops.setAudioRegion(doc, id, { fadeIn: { startSec: 0, endSec: 2 }, fadeOut: { startBeforeEndSec: 1, endBeforeEndSec: 0 } });
  const changed = ops.setTempo(doc, 120);
  assert.equal(audioRegion(changed).phaseTicks, 960); close(changed.assets.a1.durationSec, 2);
  close(audioSegments(changed, 0.5, 0.6)[0].offsetSec, 0.5);
  const r = audioRegion(changed); assert.ok(r.fadeIn.endSec + r.fadeOut.startBeforeEndSec <= tickSeconds(r.length, 120) + 1e-9);
  const restored = undo(record(createHistory(doc), changed)).present;
  assert.deepEqual(restored.assets, doc.assets); assert.deepEqual(restored.tracks, doc.tracks); assert.equal(restored.tempo.bpm, 60);
});
test('pruning is part of deletion, overwrite and track removal; undo restores assets', () => {
  const doc = audioDoc(), r = audioRegion(doc);
  for (const next of [ops.deleteRegion(doc, r.id), ops.removeTrack(doc, 't2')]) {
    assert.deepEqual(next.assets, {}); const restored = undo(record(createHistory(doc), next)).present;
    assert.deepEqual(restored.assets, doc.assets); assert.deepEqual(restored.tracks, doc.tracks);
  }
  const replaced = ops.addAudioRegion(doc, { ...takeAsset(), ref: 'different' }, 't2', 0);
  assert.equal(Object.keys(replaced.assets).length, 1); assert.equal(Object.values(replaced.assets)[0].ref, 'different');
});
test('matching song tempo is one op and refuses the 600 second limit', () => {
  const doc = audioDoc(); audioRegion(doc).length = 150 * 3840; // 600 s at 60 BPM
  assert.match(ops.tryOp(doc, (d) => ops.setTempo(d, 40)).refused, /600 seconds/);
  const changed = ops.setTempo(doc, 120); assert.equal(changed.tempo.bpm, 120);
  assert.equal(undo(record(createHistory(doc), changed)).present.tempo.bpm, 60);
});
test('partial fade anchors encode the same envelope over both sides of a cut', () => {
  const doc = audioDoc(); const r = audioRegion(doc); r.length = 8 * 960;
  r.fadeIn = { startSec: 0, endSec: 3 }; r.fadeOut = { startBeforeEndSec: 3, endBeforeEndSec: 0 };
  for (const cut of [1, 6]) {
    const split = ops.splitRegion(doc, r.id, cut * 960);
    for (const part of split.tracks[1].regions) for (let t = 0; t < part.length / 960; t += 0.11)
      close(envelopeGain(part, t, 60), envelopeGain(r, t + part.start / 960, 60));
  }
});

test('gain and reverse edits leave partial fade anchors untouched', () => {
  let doc = audioDoc(); const id = audioRegion(doc).id;
  audioRegion(doc).fadeIn = { startSec: 0, endSec: 3 };
  doc = ops.splitRegion(doc, id, 960);
  const left = audioRegion(doc);
  const edited = ops.setAudioRegion(doc, left.id, { gainDb: -3, reverse: true });
  assert.deepEqual(audioRegion(edited).fadeIn, left.fadeIn);
  assert.equal(audioRegion(edited).reverse, true);
});
