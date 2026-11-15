import test from 'node:test';
import assert from 'node:assert/strict';
import { make, legacy, v2, freeze } from './musicBeatFixtures.mjs';
import { audioDoc, audioRegion, soundAsset } from './musicBeatAudioFixtures.mjs';
import { validateBeat, migrateBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import { eventsAtStep } from '../app/veyrnox/_lib/music/beat/beatEvents.mjs';
test('v3 validates and migrations keep drum events and leave inputs untouched', () => {
  assert.equal(make().version, 3);
  for (const source of [legacy(), v2()]) {
    const before = structuredClone(source), next = migrateBeat(freeze(source));
    assert.equal(next.version, 3); assert.equal(validateBeat(next).ok, true); assert.deepEqual(source, before);
    const equivalent = source.version === 1 ? { ...v2(), view: 'pattern', steps: source.steps, patterns: source.patterns } : source;
    for (let step = 0; step < 64; step++) assert.deepEqual(eventsAtStep(next, step), eventsAtStep(equivalent, step));
  }
  const doc = audioDoc(); assert.deepEqual(validateBeat(doc), { ok: true, doc }); assert.equal(migrateBeat(doc), doc);
});
const invalid = {
  '65 assets': (d) => { const a = d.assets.a1; for (let i = 2; i <= 65; i++) d.assets[`a${i}`] = a; },
  'bad asset id': (d) => { d.assets.bad = d.assets.a1; },
  'missing metadata': (d) => { delete d.assets.a1.sourceChannels; },
  'source channel count': (d) => { d.assets.a1.sourceChannels = 6; },
  'zero duration': (d) => { d.assets.a1.durationSec = 0; },
  'too long': (d) => { d.assets.a1.durationSec = 601; },
  'encoded bound': (d) => { d.assets.a1.encodedBytes = 120000001; },
  'fractional bytes': (d) => { d.assets.a1.encodedBytes = 1.1; },
  'asset name': (d) => { d.assets.a1.name = 'x'.repeat(81); },
  'URL ref': (d) => { d.assets.a1.ref = 'https://audio'; },
  'mutable song ref': (d) => { d.assets.a1.source = 'song'; d.assets.a1.ref = { songId: d.id, versionId: d.id }; },
  'missing asset': (d) => { audioRegion(d).assetId = 'a9'; },
  'phase at duration': (d) => { audioRegion(d).phaseSec = 3; },
  'negative phase': (d) => { audioRegion(d).phaseSec = -0.01; },
  'both phases': (d) => { audioRegion(d).phaseTicks = 0; },
  'wrong phase': (d) => { delete audioRegion(d).phaseSec; audioRegion(d).phaseTicks = 0; },
  'high gain': (d) => { audioRegion(d).gainDb = 6.01; },
  'low gain': (d) => { audioRegion(d).gainDb = -24.01; },
  'reverse type': (d) => { audioRegion(d).reverse = 1; },
  'long fade': (d) => { audioRegion(d).fadeIn = { startSec: 0, endSec: 11 }; },
  'invalid fade anchor': (d) => { audioRegion(d).fadeOut = { startBeforeEndSec: 0, endBeforeEndSec: 1 }; },
  'legacy offset': (d) => { audioRegion(d).offsetSec = 0; },
  'kit on audio': (d) => { d.tracks[1].kit = '808'; },
  'kind mismatch': (d) => { d.tracks[0].regions = [audioRegion(d)]; d.tracks[1].regions = []; },
  'unknown kind': (d) => { d.tracks[1].kind = 'midi'; },
};
for (const [name, change] of Object.entries(invalid)) test(`v3 rejects ${name} without repairing`, () => {
  const doc = audioDoc(); change(doc); const snapshot = structuredClone(doc);
  assert.equal(validateBeat(doc).ok, false); assert.throws(() => migrateBeat(doc)); assert.deepEqual(doc, snapshot);
});
test('sound phase is integer ticks within the musical loop, and metadata follows tempo', () => {
  const doc = audioDoc(soundAsset()); assert.equal(validateBeat(doc).ok, true);
  for (const phase of [-1, 0.5, 3840, NaN]) { const bad = structuredClone(doc); audioRegion(bad).phaseTicks = phase; assert.equal(validateBeat(bad).ok, false); }
  doc.assets.a1.durationSec += 1; assert.equal(validateBeat(doc).ok, false);
});
test('v3 inherits all arrangement limits', () => {
  for (const change of [
    (d) => { d.tracks = Array.from({ length: 17 }, (_, i) => ({ ...d.tracks[0], id: `t${i}`, regions: [] })); },
    (d) => { d.tracks[1].regions = Array.from({ length: 401 }, (_, i) => ({ ...audioRegion(d), id: `x${i}`, start: i * 240, length: 240 })); },
    (d) => { audioRegion(d).length = 513 * 3840; },
    (d) => { audioRegion(d).length = 601 * 960; },
    (d) => { audioRegion(d).start = 1; },
    (d) => { audioRegion(d).length = 0; },
  ]) { const doc = audioDoc(); change(doc); assert.equal(validateBeat(doc).ok, false); }
});
