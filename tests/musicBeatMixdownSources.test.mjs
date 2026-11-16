import test from 'node:test';
import assert from 'node:assert/strict';
import { mixdownSources } from '../app/veyrnox/_lib/music/beat/beatMixdownSources.mjs';
import { addAudioRegion } from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import { audioDoc, takeAsset, soundAsset } from './musicBeatAudioFixtures.mjs';
const song = n => ({ source: 'song', name: 'Song', durationSec: 2, bpm: null, sourceChannels: 2, encodedBytes: 100,
  ref: { songId: `e40439d1-646a-4c11-9c12-69fa3a8512${String(n).padStart(2, '0')}`, versionId: `e40439d1-646a-4c11-9c12-69fa3a8513${String(n).padStart(2, '0')}`, jobId: 'e40439d1-646a-4c11-9c12-69fa3a851234' } });
test('only audible overlapping assets contribute distinct versions and takes', () => {
  let doc = audioDoc(song(1)); doc = addAudioRegion(doc, song(1), 't2', 3840, 0);
  doc = addAudioRegion(doc, takeAsset(), null, 0, 0);
  assert.equal(mixdownSources(doc).songs.length, 1); assert.equal(mixdownSources(doc).hasTakes, true);
  doc.tracks[2].mute = true; assert.equal(mixdownSources(doc).hasTakes, false);
  doc.tracks[0].solo = true; assert.deepEqual(mixdownSources(doc), { songs: [], hasTakes: false });
  doc.tracks[0].solo = false; doc.cycle = { on: true, start: 7680, end: 11520 };
  assert.deepEqual(mixdownSources(doc, { range: 'cycle' }), { songs: [], hasTakes: false });
  assert.equal(mixdownSources(audioDoc(soundAsset())).hasTakes, false);
});
test('more than 16 distinct song versions is refused', () => {
  let doc = audioDoc(song(1));
  for (let n = 2; n <= 17; n++) doc = addAudioRegion(doc, song(n), 't2', (n - 1) * 3840, 0);
  assert.throws(() => mixdownSources(doc), /more than 16 song versions/);
});
test('a cycle wholly inside the silent part of a fade does not declare its source', () => {
  const doc = audioDoc(takeAsset());
  const region = doc.tracks[1].regions[0];
  region.length = 7680; region.fadeIn = { startSec: 4, endSec: 6 };
  doc.cycle = { on: true, start: 0, end: 3840 };
  assert.equal(mixdownSources(doc, { range: 'cycle' }).hasTakes, false);
  doc.cycle = { on: true, start: 3840, end: 7680 };
  assert.equal(mixdownSources(doc, { range: 'cycle' }).hasTakes, true);
});
