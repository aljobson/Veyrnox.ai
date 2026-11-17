import test from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../app/veyrnox/_lib/music/beat/beatTakeStore.js';
import { memoryBeatTakeStorage } from './musicBeatTakeStorageFixture.mjs';
import { configureShelfStorage, hydrateShelf, removeShelfTake } from '../app/veyrnox/_lib/music/instrumentShelf.js';
import { localTake, localTakeIds, hydrateLocalTakes, subscribeLocalTakes } from '../app/veyrnox/_lib/music/localTakes.js';
import { createDeviceCopy } from '../app/veyrnox/_lib/music/beat/beatCloudRules.mjs';
import { createBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import { addAudioTrack } from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import { commitRecording } from '../app/veyrnox/_lib/music/beat/beatTakeOps.mjs';
import { takeAsset } from '../app/veyrnox/_lib/music/beat/beatAudioRecordingSession.js';
const row = (id = 'new') => ({ id, samples: new Float32Array(48000), sampleRate: 48000, beatId: 'beat', label: 'Recorded', state: 'pending', pending: { recordingId: 'run' } });
function storage() { const disk = memoryBeatTakeStorage(); store.configureBeatTakeStorage(disk.adapter); return { rows: disk.audio, states: disk.states }; }
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
  await store.reconcileBeatTakes({ id: 'beat', assets: {} }, [saved]); assert.equal(store.getBeatTake('new').state, 'pending', 'unsaved versions cannot retire a take');
  await store.reconcileBeatTakes(saved); assert.equal(disk.states.get('new').state, 'committed');
  assert.equal(disk.rows.get('new').state, 'pending', 'lifecycle change never rewrites audio');
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
  store.configureBeatTakeStorage(memoryBeatTakeStorage([], { failPut: true }).adapter);
  await assert.rejects(store.putBeatTake(row()), /Could not save/); assert.equal(store.getBeatTake('new'), null);
});

test('append checkpoints persist linear bytes, assemble on reload and keep lifecycle writes small', async () => {
  const disk = memoryBeatTakeStorage(), { adapter, states } = disk; let written = 0;
  const put = adapter.put, putChunk = adapter.putChunk, putState = adapter.putState;
  adapter.put = async r => { written += r.samples.length; return put(r); };
  adapter.putChunk = async r => { written += r.samples.length; return putChunk(r); };
  adapter.putState = async r => { assert.equal(r.samples, undefined, 'lifecycle rows never carry audio'); return putState(r); };
  store.configureBeatTakeStorage(adapter);
  for (let i = 0; i < 3; i++) await store.appendBeatTake({ ...row(), samples: new Float32Array(10).fill(i + 1), pending: { length: (i + 1) * 240 } }, i * 10);
  assert.equal(store.beatTakeBytes(), 120);
  const final = { ...row(), samples: Float32Array.from({ length: 35 }, (_, i) => Math.min(4, Math.floor(i / 10) + 1)) };
  await store.putBeatTake(final); await store.putBeatTake(final);
  assert.equal(written, 35, 'commit and retry never rewrite the durable prefix');
  store.configureBeatTakeStorage(adapter); await store.hydrateBeatTakes();
  assert.equal(store.getBeatTake('new').samples, undefined, 'hydration loads metadata only');
  assert.deepEqual((await store.loadBeatTake('new')).samples, final.samples);
  await store.reconcileBeatTakes({ id: 'beat', assets: { a1: { source: 'take', ref: 'new' } } });
  assert.equal(written, 35); assert.equal(states.get('new').state, 'committed');
  store.configureBeatTakeStorage(adapter); await store.hydrateBeatTakes();
  assert.equal(store.getBeatTake('new').state, 'committed'); assert.deepEqual(store.pendingBeatTakes('beat'), []);
});
test('hydrate retries a failed read rather than caching an empty device forever', async () => {
  const disk = memoryBeatTakeStorage([row()], { failListState: 1 }); store.configureBeatTakeStorage(disk.adapter);
  await assert.rejects(store.hydrateBeatTakes(), /IndexedDB unavailable/);
  await store.hydrateBeatTakes(); assert.equal(disk.stateReads, 2); assert.equal(store.pendingBeatTakes('beat').length, 1);
});
test('beat strict reads reject IndexedDB errors while shelf reads retain their fallback', async t => {
  const db = await import('../app/veyrnox/_lib/music/instrumentTakeDb.js');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open() {
    const request = { error: Error('read blocked') }; queueMicrotask(() => request.onerror()); return request;
  } } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'indexedDB', previous); else delete globalThis.indexedDB; });
  await assert.rejects(db.listSavedTakesStrict('beatTakes'), /read blocked/);
  assert.deepEqual(await db.listSavedTakes('shelf'), []);
});
test('only lifecycle transactions get a 10 second timeout; audio and shelf writes keep their original lifetime', async t => {
  const db = await import('../app/veyrnox/_lib/music/instrumentTakeDb.js');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB'), realTimer = globalThis.setTimeout, timers = [];
  t.mock.method(globalThis, 'setTimeout', (fn, delay) => { timers.push(delay); return realTimer(fn, delay); });
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open() {
    const request = { result: { close() {}, transaction() {
      const tx = { objectStore: () => ({ put: () => ({}) }) }; queueMicrotask(() => tx.oncomplete()); return tx;
    } } }; queueMicrotask(() => request.onsuccess()); return request;
  } } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'indexedDB', previous); else delete globalThis.indexedDB; });
  for (const name of ['shelf', 'takes', 'beatTakes', 'beatTakeChunks', 'beatTakeState']) {
    timers.length = 0; assert.equal(await db.putSavedTake(name, { id: 'test' }), true);
    assert.equal(timers.includes(10000), name === 'beatTakeState', name);
  }
});
