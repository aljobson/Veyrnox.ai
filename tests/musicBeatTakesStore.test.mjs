import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../app/veyrnox/_lib/music/beat/beatTakeStore.js';
import { configureShelfStorage, hydrateShelf, removeShelfTake } from '../app/veyrnox/_lib/music/instrumentShelf.js';
import { localTake, localTakeIds, hydrateLocalTakes, subscribeLocalTakes } from '../app/veyrnox/_lib/music/localTakes.js';
import { createDeviceCopy } from '../app/veyrnox/_lib/music/beat/beatCloudRules.mjs';
import { createBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import { addAudioTrack } from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import { commitRecording } from '../app/veyrnox/_lib/music/beat/beatTakeOps.mjs';
import { takeAsset } from '../app/veyrnox/_lib/music/beat/beatAudioRecordingSession.js';
const row = (id = 'new') => ({ id, samples: new Float32Array(48000), sampleRate: 48000, beatId: 'beat', label: 'Recorded', state: 'pending', pending: { recordingId: 'run' } });
function storage() { const rows = new Map(); store.configureBeatTakeStorage({ list: async () => [...rows.values()], put: async r => { rows.set(r.id, structuredClone(r)); return true; } }); return rows; }
test('local registry normalizes both origins; shelf changes keep recorded audio and notify', async () => {
  storage(); configureShelfStorage({ list: async () => [{ ...row('shelf'), label: 'Shelf' }, { ...row('new'), label: 'Collision' }], put: async () => true, remove: async () => true });
  let changes = 0; const unsubscribe = subscribeLocalTakes(() => changes++);
  await hydrateLocalTakes(); await store.putBeatTake(row());
  assert.equal(localTake('new').origin, 'beat'); assert.equal(localTake('new').label, 'Recorded'); assert.equal(localTake('shelf').origin, 'shelf');
  assert.equal(localTake('new').seconds, 1); assert.deepEqual(new Set(localTakeIds()), new Set(['new', 'shelf']));
  removeShelfTake('new'); assert.equal(localTake('new').origin, 'beat'); assert.ok(changes >= 3); unsubscribe();
});
test('recovery matches immutable refs and beat id, never reused document asset keys', async () => {
  const disk = storage(); await store.putBeatTake(row());
  await store.reconcileBeatTakes({ id: 'beat', assets: { a1: { source: 'take', ref: 'old' } } }); assert.equal(store.getBeatTake('new').state, 'pending');
  await store.reconcileBeatTakes({ id: 'other', assets: { a1: { source: 'take', ref: 'new' } } }); assert.equal(store.getBeatTake('new').state, 'pending');
  const saved = { id: 'beat', assets: { a2: { source: 'take', ref: 'new' } } };
  await store.reconcileBeatTakes({ id: 'beat', assets: {} }, [saved]); assert.equal(disk.get('new').state, 'committed');
  await store.reconcileBeatTakes({ id: 'beat', assets: {} }); assert.deepEqual(store.pendingBeatTakes('beat'), []);
  await store.discardBeatTakes(['new']); assert.equal(store.getBeatTake('new').state, 'committed');
  await store.putBeatTake(row('discard')); await store.discardBeatTakes(['discard']); assert.equal(store.getBeatTake('discard').state, 'discarded');
});
test('recorded takes can be copied through the existing device copy eligibility path', async () => {
  storage(); configureShelfStorage({ list: async () => [], put: async () => true, remove: async () => true }); await hydrateShelf();
  const take = row(); await store.putBeatTake(take);
  const doc = commitRecording(addAudioTrack(createBeat({ id: crypto.randomUUID(), now: 1 })), { trackId: 't2', start: 0, length: 960, takes: [{ asset: takeAsset(take) }] });
  let copy;
  const result = await createDeviceCopy(doc, localTakeIds().map(id => ({ id })), async d => { copy = d; return {}; }, crypto.randomUUID(), 100);
  assert.ok(result.id); assert.equal(Object.values(copy.assets)[0].ref, take.id);
});
test('failed persistence never reports a take saved in memory', async () => {
  store.configureBeatTakeStorage({ list: async () => [], put: async () => false });
  await assert.rejects(store.putBeatTake(row()), /Could not save/); assert.equal(store.getBeatTake('new'), null);
});
