import test from 'node:test';
import assert from 'node:assert/strict';
import { MUSIC_STUDIO_ACTION_TYPES, MUSIC_STUDIO_INPUT_LIMIT, musicStudioProposalCurrent, planMusicStudioAction } from '../lib/musicStudioActions.mjs';
import * as historyOps from '../app/veyrnox/_lib/music/beat/beatHistory.mjs';
import * as ops from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import { make } from './musicBeatFixtures.mjs';

const doc = (patch = {}) => ({
  id: 'beat-1', updatedAt: 10, tempo: { bpm: 92 }, view: 'song', currentPattern: 'A',
  tracks: [
    { id: 't1', name: 'Drums and Bass', mute: false, solo: false },
    { id: 't2', name: 'Stems', mute: true, solo: false },
    { id: 't3', name: 'STEMS', mute: false, solo: false },
    { id: 't4', name: 'Export bus', mute: false, solo: true },
  ], ...patch,
});
const plan = (input, overrides = {}) => planMusicStudioAction({ input, document: doc(), capabilities: { studioChat: true, magicBar: false }, ...overrides });

test('Studio planner fails closed and bounds input before parsing', () => {
  assert.equal(planMusicStudioAction({ input: 'help', document: doc(), capabilities: {} }).code, 'studio_disabled');
  assert.equal(plan(' ').code, 'empty');
  assert.equal(plan('x'.repeat(MUSIC_STUDIO_INPUT_LIMIT + 1)).code, 'too_long');
  assert.equal(plan('set tempo 100; mute track 1').code, 'one_action');
  assert.equal(plan('set tempo 100 and then mute track 1').code, 'one_action');
  assert.equal(plan('mute named Drums and Bass').kind, 'proposal');
});

test('Studio planner answers bounded project questions without an action', () => {
  assert.deepEqual(plan('current tempo').params, { bpm: 92 });
  assert.deepEqual(plan('current view').params, { view: 'song', pattern: 'A' });
  const tracks = plan('list tracks');
  assert.equal(tracks.kind, 'answer');
  assert.equal(tracks.tracks.length, 4);
  assert.equal(plan('what can you do').code, 'help');
});

test('Studio planner emits every supported typed local operation', () => {
  const cases = [
    ['set tempo 120', { type: 'set_tempo', bpm: 120 }],
    ['mute track 1', { type: 'set_track_mute', trackId: 't1', value: true }],
    ['unmute track 2', { type: 'set_track_mute', trackId: 't2', value: false }],
    ['solo named Drums and Bass', { type: 'set_track_solo', trackId: 't1', value: true }],
    ['unsolo named Export bus', { type: 'set_track_solo', trackId: 't4', value: false }],
    ['switch to pattern view', { type: 'set_view', view: 'pattern' }],
    ['select pattern d', { type: 'select_pattern', pattern: 'D' }],
  ];
  for (const [input, operation] of cases) assert.deepEqual(plan(input).operation, operation);
  assert.deepEqual([...MUSIC_STUDIO_ACTION_TYPES], ['set_tempo', 'set_track_mute', 'set_track_solo', 'set_view', 'select_pattern']);
});

test('track targeting is one-based, normalized, exact and ambiguity safe', () => {
  assert.equal(plan('mute track 0').code, 'track_not_found');
  assert.equal(plan('mute track 99').code, 'track_not_found');
  assert.equal(plan('mute named stems').code, 'track_ambiguous');
  assert.equal(plan('mute named missing').code, 'track_not_found');
  assert.equal(plan('mute named Export bus').operation.trackId, 't4');
  assert.equal(plan('mute Stems').code, 'magic_locked');
  const spaced = doc({ tracks: [
    { id: 'compact', name: 'Drum Kit', mute: false, solo: false },
    { id: 'spaced', name: 'Drum  Kit', mute: false, solo: false },
  ] });
  const named = input => planMusicStudioAction({ input, document: spaced, capabilities: { studioChat: true } });
  assert.equal(named('mute named Drum Kit').operation.trackId, 'compact');
  assert.equal(named('mute named Drum  Kit').operation.trackId, 'spaced');
});

test('write proposals honor state and never propose no-op edits', () => {
  assert.equal(plan('set tempo 92').code, 'already');
  assert.equal(plan('unmute track 1').code, 'already');
  assert.equal(plan('set tempo 120', { editability: { readOnly: true } }).code, 'not_editable_now');
  assert.equal(plan('set tempo 120', { editability: { recording: true } }).code, 'not_editable_now');
  assert.equal(plan('mute track 1', { editability: { recording: true } }).kind, 'proposal');
  assert.equal(plan('mute track 1', { editability: { replacing: true } }).code, 'not_editable_now');
  assert.equal(plan('mute track 1', { editability: { busy: true } }).code, 'not_editable_now');
});

test('paid, generative and executable intents can never become local operations', () => {
  for (const input of ['generate a beat', 'split stems', 'extend this', 'replace chorus', 'write a plugin', 'execute code', 'publish and share']) {
    const locked = plan(input);
    assert.equal(locked.kind, 'blocked');
    assert.equal(locked.code, 'magic_locked');
    const gated = plan(input, { capabilities: { studioChat: true, magicBar: true } });
    assert.equal(gated.kind, 'blocked');
    assert.equal(gated.code, 'magic_handoff');
    assert.equal('operation' in locked, false);
    assert.equal('operation' in gated, false);
  }
  assert.equal(plan('mute named Export bus').kind, 'proposal');
});

test('proposals bind to the planned document revision and stable target', () => {
  const initial = make();
  const source = ops.addTrack(initial, initial.tracks[0].kit, initial.updatedAt);
  const target = source.tracks[0].id;
  const proposal = planMusicStudioAction({ input: 'mute track 1', document: source, capabilities: { studioChat: true } });
  assert.equal(musicStudioProposalCurrent(proposal, source), true);
  assert.equal(musicStudioProposalCurrent(proposal, { ...source }), false);
  const renamed = ops.renameTrack(source, target, 'Renamed', source.updatedAt);
  assert.equal(renamed.updatedAt, source.updatedAt, 'same-timestamp edit reproduces the former stale-proposal gap');
  assert.equal(musicStudioProposalCurrent(proposal, renamed), false);
  assert.equal(musicStudioProposalCurrent(proposal, ops.removeTrack(source, target, source.updatedAt)), false);
  const undone = historyOps.undo(historyOps.record(historyOps.createHistory(source), renamed, { now: source.updatedAt })).present;
  assert.deepEqual(undone.tracks, source.tracks);
  assert.notEqual(undone, source);
  assert.equal(musicStudioProposalCurrent(proposal, undone), false);
});
