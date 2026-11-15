import test from 'node:test';
import assert from 'node:assert/strict';
import { arrangementStructure, playbackAssets, lateAudioSegment, audioLoopLabel } from '../app/veyrnox/_lib/music/beat/beatPlaybackAudio.mjs';
import { audioSegments, envelopeGain } from '../app/veyrnox/_lib/music/beat/beatAudioSegments.mjs';
import { audioDoc, audioRegion, soundAsset, takeAsset } from './musicBeatAudioFixtures.mjs';
import { setTempo } from '../app/veyrnox/_lib/music/beat/beatOps.mjs';

test('gain, fades, reverse and track mix preserve the run; structural edits change it', () => {
  const doc = audioDoc(), signature = arrangementStructure(doc);
  const adjusted = structuredClone(doc), region = audioRegion(adjusted);
  Object.assign(region, { gainDb: -6, fadeIn: { startSec: 0, endSec: 1 }, fadeOut: { startBeforeEndSec: 1, endBeforeEndSec: 0 }, reverse: true });
  adjusted.tracks[1].mute = true; adjusted.tracks[0].solo = true;
  adjusted.tracks[1].gain = 0.5; adjusted.tracks[1].pan = -1;
  assert.equal(arrangementStructure(adjusted), signature);
  for (const change of [
    (d) => { audioRegion(d).start += 240; }, (d) => { audioRegion(d).length += 240; },
    (d) => { d.tracks[1].regions = []; }, (d) => { d.tracks[1].regions.push({ ...audioRegion(d), id: 'rnew', start: 5000 }); },
  ]) { const next = structuredClone(doc); change(next); assert.notEqual(arrangementStructure(next), signature); }
});

test('preload covers every track in the play range, both directions, and the full cycle after wrapping', () => {
  const doc = audioDoc(), region = audioRegion(doc);
  doc.view = 'song'; region.start = 960; region.length = 1920;
  doc.tracks[1].regions.push({ ...region, id: 'rsecond', start: 4000, reverse: true });
  assert.deepEqual(playbackAssets(doc, 0).map((item) => item.reverse), [false, true]);
  assert.deepEqual(playbackAssets(doc, 3500).map((item) => item.reverse), [true]);
  doc.cycle = { on: true, start: 0, end: 3840 };
  assert.deepEqual(playbackAssets(doc, 3000).map((item) => item.reverse), [false]);
  doc.tracks[0].solo = true; assert.equal(playbackAssets(doc, 0).length, 1);
  doc.tracks[0].solo = false; doc.tracks[1].mute = true; assert.equal(playbackAssets(doc, 0).length, 1);
  doc.tracks[1].mute = false; doc.view = 'pattern'; assert.deepEqual(playbackAssets(doc, 0), []);
});

test('late join advances asset and envelope offsets and discards expired slices, including reverse and new tempos', () => {
  for (const bpm of [60, 120]) for (const reverse of [false, true]) {
    const doc = setTempo(audioDoc(soundAsset()), bpm);
    const region = audioRegion(doc); region.phaseTicks = 480; region.reverse = reverse;
    region.fadeIn = { startSec: 0, endSec: 1 }; region.gainDb = -3;
    const segment = audioSegments(doc, 0.2, 0.8)[0];
    const late = lateAudioSegment(segment, 10, 10.25);
    const expected = audioSegments(doc, 0.45, 0.8)[0];
    for (const field of ['songTimeSec', 'offsetSec', 'regionTimeSec', 'durationSec']) assert.ok(Math.abs(late[field] - expected[field]) < 1e-9, field);
    assert.equal(late.reverse, reverse); assert.equal(late.isRegionStart, false);
    assert.equal(envelopeGain(region, late.regionTimeSec, bpm), envelopeGain(region, expected.regionTimeSec, bpm));
    assert.deepEqual(lateAudioSegment(segment, 10, 9), segment);
    assert.equal(lateAudioSegment(segment, 10, 11), null);
  }
});

test('audio region labels distinguish full and partial loops with correct plurals', () => {
  const asset = takeAsset(2), region = audioRegion(audioDoc(asset));
  for (const [seconds, expected] of [[1, 'partial loop'], [2, '1 full loop'], [3, '1 full loop and a partial loop'], [4, '2 full loops']]) {
    assert.equal(audioLoopLabel({ ...region, length: seconds * 960 }, asset, 60), expected);
  }
});
