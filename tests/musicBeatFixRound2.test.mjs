import test from 'node:test';
import assert from 'node:assert/strict';
import { audioDoc, audioRegion, soundAsset } from './musicBeatAudioFixtures.mjs';
import { addTrack } from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import { patternTrack, eventsAtStep, recordTarget } from '../app/veyrnox/_lib/music/beat/beatEvents.mjs';
import { sequenceFor } from '../app/veyrnox/_lib/music/beat/beatSequence.mjs';
import { drumLoopLabel } from '../app/veyrnox/_lib/music/beat/beatPlaybackAudio.mjs';
import { trackSummary } from '../app/veyrnox/_lib/music/beat/beatTrackSummary.mjs';

test('pattern playback and recording resolve an audio selection to the first drum kit', () => {
  const doc = addTrack(audioDoc(), 'lofi');
  doc.tracks[0].kit = 'acoustic'; doc.view = 'pattern';
  const audioId = doc.tracks[1].id;
  assert.equal(patternTrack(doc, audioId).kit, 'acoustic');
  assert.equal(sequenceFor(doc, 0, audioId).editTrackId, doc.tracks[0].id);
  assert.deepEqual(eventsAtStep(doc, 0, { editTrackId: audioId }), eventsAtStep(doc, 0, { editTrackId: doc.tracks[0].id }));
  assert.ok(eventsAtStep(doc, 0, { editTrackId: audioId }).length > 0);
  assert.deepEqual(recordTarget(doc, 17, audioId), { pattern: doc.currentPattern, step: 1 });
  assert.equal(patternTrack(doc, doc.tracks[2].id).kit, 'lofi');
  doc.view = 'song'; assert.equal(recordTarget(doc, 0, audioId), null);
  doc.view = 'pattern'; doc.tracks = [doc.tracks[1]];
  assert.deepEqual(eventsAtStep(doc, 0), []); assert.equal(recordTarget(doc, 0), null);
});

test('drum loop labels use once, twice, plurals and partial-loop wording', () => {
  for (const [length, expected] of [[240, 'partial loop'], [3840, 'looped once'], [7680, 'looped twice'], [11520, 'looped 3 times'], [4080, 'looped once and a partial loop']]) {
    assert.equal(drumLoopLabel({ length }, 16), expected);
  }
});

test('beat summaries describe audio-only, mixed and legacy drum tracks', () => {
  assert.equal(trackSummary([{ kind: 'audio' }]), '1 audio track');
  assert.equal(trackSummary([{ kind: 'drums' }]), 'Drums');
  assert.equal(trackSummary([{ kind: 'audio' }, { kit: '808' }]), '2 tracks · 1 audio');
  assert.equal(trackSummary([{ kind: 'audio' }, { kind: 'audio' }]), '2 tracks · 2 audio');
  assert.equal(trackSummary([{ kit: '808' }, { kit: 'lofi' }]), '2 drum tracks');
  assert.ok(trackSummary([{ kit: '808' }]).length > 0);
});

import { createScheduler } from '../app/veyrnox/_lib/music/beat/beatScheduler.mjs';
import { audioSegments } from '../app/veyrnox/_lib/music/beat/beatAudioSegments.mjs';
function schedule(doc, locator = 0, elapsed = 2, hidden = false) {
  let now = 0;
  const pieces = [];
  const scheduler = createScheduler({ clock: () => now, isHidden: () => hidden, setTimer: () => {}, clearTimer: () => {},
    getSequence: () => sequenceFor(doc, locator), onStep: () => {}, onEvent: () => {},
    onAudio: (segment, time) => pieces.push({ ...segment, time }) });
  scheduler.start(0);
  for (let pass = 1; pass <= Math.round(elapsed / 0.025); pass++) { now = pass * 0.025; scheduler.refill(); }
  scheduler.stop();
  return pieces;
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
test('a four-bar bass region schedules one whole source in two seconds of passes, not polling slices', () => {
  const doc = audioDoc(soundAsset()); doc.view = 'song'; audioRegion(doc).length = 4 * 3840;
  const pieces = schedule(doc);
  assert.equal(pieces.length, 1); near(pieces[0].durationSec, 4);
  const repeats = schedule(doc, 0, 10);
  assert.deepEqual(repeats.map((s) => s.time), [0, 4, 8]);
  assert.ok(repeats.every((s) => s.durationSec === 4));
});
test('mid-region starts and cycle wraps schedule offsets and cut only at natural ends', () => {
  for (const reverse of [false, true]) {
    const doc = audioDoc(soundAsset()); doc.view = 'song'; const region = audioRegion(doc);
    region.length = 4 * 3840; region.reverse = reverse; region.phaseTicks = 480;
    region.fadeIn = { startSec: 0, endSec: 2 };
    const pieces = schedule(doc, 960, 6);
    const expected = audioSegments(doc, 1, 9);
    assert.equal(pieces.length, 2);
    for (let i = 0; i < pieces.length; i++) {
      for (const key of ['offsetSec', 'durationSec', 'gain', 'endGain']) near(pieces[i][key], expected[i][key]);
    }
    doc.cycle = { on: true, start: 960, end: 2400 };
    const wrapped = schedule(doc, 1920, 4);
    near(wrapped[0].offsetSec, 2.5); near(wrapped[0].durationSec, 0.5);
    for (const piece of wrapped.slice(1)) { near(piece.offsetSec, 1.5); near(piece.durationSec, 1.5); }
    for (let i = 1; i < wrapped.length; i++) near(wrapped[i].time, wrapped[i - 1].time + wrapped[i - 1].durationSec);
  }
});
