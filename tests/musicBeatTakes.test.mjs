import test from 'node:test';
import assert from 'node:assert/strict';
import { createBeat, validateBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import * as ops from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import * as takes from '../app/veyrnox/_lib/music/beat/beatTakeOps.mjs';
import { audioSegments, audioPieces, audioFragment, envelopeGain, tickSeconds } from '../app/veyrnox/_lib/music/beat/beatAudioSegments.mjs';
import { arrangementStructure } from '../app/veyrnox/_lib/music/beat/beatPlaybackAudio.mjs';
const base = () => ops.addAudioTrack(ops.setTempo(createBeat({ id: crypto.randomUUID(), now: 1 }), 120));
const asset = (n, durationSec = 8) => ({ source: 'take', ref: `take-${n}`, name: `Take ${n}`, durationSec, sourceChannels: 1, encodedBytes: 0, bpm: null });
const recorded = (count = 3) => takes.commitRecording(base(), { trackId: 't2', start: 0, length: 15360, takes: Array.from({ length: count }, (_, i) => ({ asset: asset(i) })) });
const track = d => d.tracks.find(t => t.id === 't2');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
test('v4 groups retain unused lanes; default comp uses newest and appends identical ranges', () => {
  let d = recorded(); const g = track(d).takeGroups[0];
  assert.equal(validateBeat(d).ok, true); assert.equal(Object.keys(d.assets).length, 3);
  assert.deepEqual(g.comp, [[0, 2]]); assert.equal(track(d).regions[0].assetId, g.lanes[2]);
  d = takes.commitRecording(d, { trackId: 't2', start: 0, length: 15360, takes: [{ asset: asset(4) }] });
  assert.equal(track(d).takeGroups.length, 1); assert.equal(track(d).takeGroups[0].lanes.length, 4);
  assert.equal(track(d).takeGroups[0].id, g.id);
});
test('validator rejects malformed, overlapping, out-of-range and legacy take groups', () => {
  const mutations = [g => g.lanes.push(g.lanes[0]), g => g.comp = [[240, 0]], g => g.comp.push([0, 1]), g => g.comp = [[0, 4]], g => g.xfadeMs = 30, g => g.length = 241, g => g.start = 512 * 3840];
  for (const change of mutations) { const d = recorded(); change(track(d).takeGroups[0]); assert.equal(validateBeat(d).ok, false); }
  let d = recorded(); track(d).takeGroups.push({ ...track(d).takeGroups[0], id: 'g2' }); assert.equal(validateBeat(d).ok, false);
  d = recorded(); d.tracks[0].takeGroups = track(d).takeGroups; assert.equal(validateBeat(d).ok, false);
  d = recorded(); d.version = 3; delete d.clips; assert.equal(validateBeat(d).ok, false);
});
test('comp materializes forward crossfade with identical playback/export envelopes and no wrapping', () => {
  let d = recorded(2); const id = track(d).takeGroups[0].id;
  d = takes.setComp(d, 't2', id, 0, 7680, 0);
  const [a, b] = track(d).regions; assert.equal(a.tailSec, 0.01); assert.equal(b.fadeIn.endSec, 0.01);
  const pieces = audioPieces(d, 0, 8), segments = audioSegments(d, 0, 8);
  assert.deepEqual(pieces, segments);
  for (let i = 0; i <= 10; i++) {
    const time = 4 + i / 1000;
    const sounding = audioSegments(d, time, time + 0.000001);
    const ga = sounding.find(s => s.regionId === a.id)?.gain || 0;
    const gb = sounding.find(s => s.regionId === b.id)?.gain || 0;
    close(ga, 1 - i / 10); close(gb, i / 10); close(ga + gb, 1);
    for (const segment of sounding) assert.ok(segment.offsetSec + segment.durationSec <= 8 + 1e-9);
  }
  const signature = arrangementStructure(d);
  d = takes.setCrossfade(d, 't2', id, 50); assert.notEqual(arrangementStructure(d), signature);
  const rescheduled = audioSegments(d, 4.005, 4.006); close(rescheduled[0].gain, 0.9); close(rescheduled[1].gain, 0.1);
  d = takes.setCrossfade(d, 't2', id, 0); assert.ok(track(d).regions.every(r => !r.tailSec && !r.fadeIn && !r.fadeOut));
});
test('partial lane audio is truncated on the grid and the remainder is silent', () => {
  const d = takes.commitRecording(base(), { trackId: 't2', start: 0, length: 15360, takes: [{ asset: asset(1, 1.1) }] });
  assert.equal(track(d).regions[0].length, 1920);
  assert.deepEqual(audioSegments(d, 1, 8), []);
});
test('fragment keeps the outgoing tail only when retaining the original end; ordinary envelope is preserved', () => {
  let d = recorded(2); d = takes.setComp(d, 't2', track(d).takeGroups[0].id, 0, 7680, 0);
  const r = track(d).regions[0], a = d.assets[r.assetId];
  for (const [start, length, tail] of [[0, 3840, false], [3840, 3840, true], [0, 7440, false]]) {
    const fragment = audioFragment(r, start, length, a, 120);
    assert.equal(!!fragment.tailSec, tail); assert.equal(!!fragment.fadeOut, tail);
  }
  const split = ops.splitRegion(d, r.id, 3840); assert.equal(track(split).regions[0].tailSec, undefined); assert.equal(track(split).regions[1].tailSec, 0.01);
  assert.equal(track(ops.trimRegionStart(d, r.id, 240)).regions[0].tailSec, 0.01);
  assert.equal(track(ops.resizeRegion(d, r.id, 3840)).regions[0].tailSec, undefined);
  const replaced = takes.commitRecording(d, { trackId: 't2', start: 3840, length: 3840, takes: [{ asset: asset(9, 2) }] });
  assert.equal(track(replaced).regions[0].tailSec, undefined);
  const ordinary = { ...r, start: 0, length: 15360, fadeIn: null, fadeOut: { startBeforeEndSec: 3, endBeforeEndSec: 0 } }; delete ordinary.tailSec;
  close(envelopeGain(audioFragment(ordinary, 0, 11520, a, 120), 6, 120), 2 / 3);
});
test('all generic region edits flatten affected group, including track membership', () => {
  const mutations = [
    (d, r) => ops.setAudioRegion(d, r.id, { gainDb: -3 }),
    (d, r) => ops.setAudioRegion(d, r.id, { fadeIn: { startSec: 0, endSec: 0.1 } }),
    (d, r) => ops.setAudioRegion(d, r.id, { reverse: true }),
    (d, r) => ops.moveRegion(d, r.id, 240, 't2'),
    (d, r) => ops.resizeRegion(d, r.id, r.length - 240),
    (d, r) => ops.trimRegionStart(d, r.id, 240),
    (d, r) => ops.splitRegion(d, r.id, 3840),
    (d, r) => ops.deleteRegion(d, r.id),
    (d, r) => ops.moveRegion(ops.addAudioTrack(d), r.id, 0, 't3'),
  ];
  for (const change of mutations) { const d = recorded(), next = change(d, track(d).regions[0]); assert.equal(track(next).takeGroups, undefined); assert.equal(validateBeat(next).ok, true); }
  assert.equal(track(ops.setTrackGain(recorded(), 't2', 0.5)).takeGroups.length, 1);
});
test('delete lane repoints comp, merge keeps comp regions, and recording limits refuse clearly', () => {
  let d = recorded(); const id = track(d).takeGroups[0].id;
  d = takes.deleteLane(d, 't2', id, 2); assert.deepEqual(track(d).takeGroups[0].comp, [[0, 1]]);
  const regions = track(d).regions; d = takes.flattenGroup(d, 't2', id);
  assert.deepEqual(track(d).regions, regions); assert.equal(track(d).takeGroups, undefined);
  d = recorded(8); assert.equal(takes.recordingCapacity(d, 't2', { start: 0, length: 15360 }).lanes, 0);
  assert.throws(() => takes.commitRecording(d, { trackId: 't2', start: 0, length: 15360, takes: [{ asset: asset(9) }] }), /8 takes/);
  let many = base();
  for (let i = 0; i < 16; i++) many = takes.commitRecording(many, { trackId: 't2', start: i * 3840, length: 3840, takes: [{ asset: asset(i, 2) }] });
  assert.equal(takes.recordingCapacity(many, 't2', { start: 16 * 3840, length: 3840 }).lanes, 0);
  assert.ok(takes.recordingCapacity(many, 't2', { start: 0, length: 7680 }).lanes > 0);
  assert.equal(track(takes.commitRecording(many, { trackId: 't2', start: 0, length: 7680, takes: [{ asset: asset(88, 4) }] })).takeGroups.length, 15);
});
test('tail only validates on takes and within 50 ms', () => {
  for (const value of [0, -1, 0.051, Infinity, NaN]) { const d = recorded(); track(d).regions[0].tailSec = value; assert.equal(validateBeat(d).ok, false); }
  const d = recorded(); track(d).regions[0].tailSec = 0.05; assert.equal(validateBeat(d).ok, true);
  assert.equal(tickSeconds(track(d).regions[0].length, 120), 8);
});
test('a single pass matching a full 8-lane group is refused at commit without replacing any take', () => {
  const d = recorded(8), before = structuredClone(track(d).takeGroups[0]);
  assert.equal(takes.recordingCapacity(d, 't2', { start: 0, length: 240, single: true }).reason, '', 'preflight cannot know the final length');
  assert.throws(() => takes.commitRecording(d, { trackId: 't2', start: 0, length: 15360, single: true, takes: [{ asset: asset(9) }] }),
    /Take limit reached — 8 takes per section\. Delete a take in that section, then Try again/);
  assert.deepEqual(track(d).takeGroups[0], before);
  const freed = takes.deleteLane(d, 't2', before.id, 0);
  const next = takes.commitRecording(freed, { trackId: 't2', start: 0, length: 15360, single: true, takes: [{ asset: asset(9) }] });
  assert.equal(track(next).takeGroups[0].id, before.id); assert.equal(track(next).takeGroups[0].lanes.length, 8);
});
test('a single pass with the same finalized range as a group with room appends a take (criterion 6)', () => {
  let d = recorded(2); const id = track(d).takeGroups[0].id;
  d = takes.commitRecording(d, { trackId: 't2', start: 0, length: 15360, single: true, takes: [{ asset: asset(9) }] });
  assert.equal(track(d).takeGroups.length, 1); assert.equal(track(d).takeGroups[0].id, id); assert.equal(track(d).takeGroups[0].lanes.length, 3);
  assert.deepEqual(track(d).takeGroups[0].comp, [[0, 2]]);
});
