import test from 'node:test';
import assert from 'node:assert/strict';
import { v5BeatFixture } from './fixtures/musicBeatV5.mjs';
import { renderSong } from '../app/veyrnox/_lib/music/beat/beatMixdown.js';
import { FakeContext } from './musicBeatMixFixtures.mjs';
import { validateBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import { configureBeatWrites, getBeatWriteVersion, capabilityGeneration, assertBeatGeneration, assertBeatWritable, withBeatVersionFloor } from '../app/veyrnox/_lib/music/beat/beatCompatibility.mjs';
import { musicRuntimeFlag } from '../lib/musicRuntime.js';
import { musicBeatV5WritesEnabled } from '../lib/musicBackend.js';
import { restoreVersion, addAudioTrack, setTempo } from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import { exportRange } from '../app/veyrnox/_lib/music/beat/beatSequence.mjs';
import { recordingCapacity, commitRecording, setComp } from '../app/veyrnox/_lib/music/beat/beatTakeOps.mjs';
import { createAudioRecording } from '../app/veyrnox/_lib/music/beat/beatAudioRecordingSession.js';
import { putBeatTake, appendBeatTake, configureBeatTakeStorage } from '../app/veyrnox/_lib/music/beat/beatTakeStore.js';
import { memoryBeatTakeStorage } from './musicBeatTakeStorageFixture.mjs';
const v5 = v5BeatFixture;
test.afterEach(() => configureBeatWrites(false));
test('switch is absent/off by default; only explicit runtime literal enables it', () => {
  assert.equal(getBeatWriteVersion(), 4);
  for (const value of [undefined, false, 1, 'yes']) {
    const env = { MUSIC_RUNTIME_FLAGS: JSON.stringify({ ui: true, beatEditor: true, beatV5Writes: value }) };
    assert.equal(musicRuntimeFlag('beatV5Writes', env), false); assert.equal(musicBeatV5WritesEnabled(env), false);
  }
  assert.equal(musicBeatV5WritesEnabled({ MUSIC_RUNTIME_FLAGS: '{"ui":true,"beatEditor":true,"beatV5Writes":true}' }), true);
});
test('generation is monotonic across off/on/off and unchanged configuration is stable', () => {
  const before = capabilityGeneration(); configureBeatWrites(false); assert.equal(capabilityGeneration(), before);
  configureBeatWrites(true); assert.equal(getBeatWriteVersion(), 5); assert.ok(capabilityGeneration() > before);
  const enabled = capabilityGeneration(); configureBeatWrites(true); assert.equal(capabilityGeneration(), enabled);
  configureBeatWrites(false); assert.ok(capabilityGeneration() > enabled);
  assert.throws(() => assertBeatGeneration(enabled), { code: 'capability_changed' });
});
test('restore content keeps v5 floor and validates against capability; unsupported still refused', () => {
  const doc = v5(), old = { ...doc, version: 4, title: 'Old content' };
  assert.throws(() => restoreVersion(doc, old), { code: 'v5_write_disabled' });
  configureBeatWrites(true);
  const restored = restoreVersion(doc, old, 5);
  assert.equal(restored.version, 5); assert.equal(restored.title, old.title); assert.ok(validateBeat(restored).ok);
  for (const version of [6, 999]) assert.throws(() => assertBeatWritable({ ...doc, version }), { code: 'unsupported_version' });
  assert.equal(withBeatVersionFloor(doc, 4), doc);
});
test('v5 exports and records/comps with the same take schema as v4', () => {
  configureBeatWrites(true);
  let doc = addAudioTrack(setTempo(v5(), 120));
  assert.deepEqual(exportRange(doc, 'song'), exportRange({ ...doc, version: 4 }, 'song'));
  assert.ok(recordingCapacity(doc, 't2', { start: 0, length: 3840 }).lanes > 0);
  doc = commitRecording(doc, { trackId: 't2', start: 0, length: 3840, takes: ['a', 'b'].map(ref => ({ asset: { source: 'take', ref, name: ref, durationSec: 2, bpm: null, sourceChannels: 1, encodedBytes: 0 } })) });
  assert.ok(validateBeat(doc).ok);
  const group = doc.tracks[1].takeGroups[0];
  assert.equal(group.lanes.length, 2);
  doc = setComp(doc, 't2', group.id, 0, 1920, 0);
  assert.ok(validateBeat(doc).ok);
  assert.equal(doc.version, 5);
});
test('read-only recording refuses before subscribing or writing any audio', () => {
  const doc = addAudioTrack(v5());
  assert.throws(() => createAudioRecording({ doc, capture: { subscribe() { assert.fail('must not capture'); } } }), { code: 'v5_write_disabled' });
});
test('rollback stops an active v5 recording and preserves only an unattached pending take', async () => {
  configureBeatWrites(true);
  let doc = addAudioTrack(setTempo(v5(), 120)), receive, stopped = 0;
  const original = JSON.stringify(doc), rows = [], messages = [];
  const capture = { context: { sampleRate: 100, currentTime: 2, state: 'suspended' }, subscribe(fn) { receive = fn; return () => {}; } };
  const session = createAudioRecording({ doc, trackId: 't2', range: { start: 0, length: 7680, cycle: false }, capture, rtt: 0, contextStart: 0, countIn: false,
    current: () => doc, edit() { assert.fail('rollback must not attach'); }, announce: s => messages.push(s), onState() {}, stop() { stopped++; }, persist: async (row, check) => { check(); rows.push(row); } });
  session.window({ fromSec: 0, toSec: 4, contextTime: 0 }); receive({ frame: 0, samples: new Float32Array(200).fill(0.25) });
  configureBeatWrites(false); assert.equal(stopped, 1);
  await session.finish();
  assert.equal(rows.length, 1); assert.equal(rows[0].state, 'pending'); assert.equal(JSON.stringify(doc), original);
  assert.match(messages.at(-1), /read-only/);
});
test('stale queued take and chunk persistence never reaches storage', async () => {
  const storage = memoryBeatTakeStorage(); configureBeatTakeStorage(storage.adapter);
  configureBeatWrites(true); const generation = capabilityGeneration();
  const check = () => assertBeatGeneration(generation);
  const row = { id: 'queued', beatId: crypto.randomUUID(), samples: new Float32Array(100), sampleRate: 100, state: 'pending' };
  const take = putBeatTake(row, check), chunk = appendBeatTake(row, 0, check);
  configureBeatWrites(false);
  await assert.rejects(take, { code: 'capability_changed' }); await assert.rejects(chunk, { code: 'capability_changed' });
  assert.equal(storage.audio.size, 0); assert.equal(storage.chunks.size, 0); assert.equal(storage.states.size, 0);
});
test('v5 mixdown runs the existing offline renderer in both write states', async t => {
  const previous = globalThis.window; globalThis.window = { OfflineAudioContext: FakeContext };
  t.after(() => { globalThis.window = previous; });
  for (const enabled of [true, false]) {
    configureBeatWrites(enabled); await renderSong(v5(), { buffers: new Map() });
    assert.ok(FakeContext.instances.at(-1).nodes.some(node => node.started));
  }
});

for (const enabled of [false, true]) test(`v4 recording survives capability change to ${enabled}, checkpoints and attaches its take`, async () => {
  configureBeatWrites(!enabled);
  let doc = addAudioTrack(setTempo({ ...v5(), version: 4 }, 120)), receive, stops = 0, checks = 0;
  const capture = { context: { sampleRate: 100, currentTime: 12, state: 'suspended' }, subscribe(fn) { receive = fn; return () => {}; } };
  const session = createAudioRecording({ doc, trackId: 't2', range: { start: 0, length: 30720, cycle: false }, capture, rtt: 0, contextStart: 0, countIn: false,
    current: () => doc, edit(change) { doc = change(doc); return 'undo'; }, announce() {}, onState() {}, stop() { stops++; },
    checkpointPersist: async (_row, _offset, check) => { check(); checks++; },
    persist: async (_row, check) => { configureBeatWrites(!enabled); check(); checks++; } });
  session.window({ fromSec: 0, toSec: 16, contextTime: 0 });
  configureBeatWrites(enabled); receive({ frame: 0, samples: new Float32Array(1200).fill(0.25) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stops, 0); assert.equal(session.error, '');
  await session.finish();
  assert.equal(checks, 2); assert.equal(session.error, ''); assert.equal(stops, 0);
  assert.equal(doc.tracks[1].takeGroups[0].lanes.length, 1);
});
