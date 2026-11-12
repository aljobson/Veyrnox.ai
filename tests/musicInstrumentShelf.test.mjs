import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SHELF_TAKES, addShelfTake, configureShelfStorage, getShelf, hydrateShelf, removeShelfTake, subscribeShelf } from '../app/veyrnox/_lib/music/instrumentShelf.js';

function memoryStorage(seed = []) {
  const rows = new Map(seed.map((row) => [row.id, row]));
  return { rows, list: async () => [...rows.values()], put: async (row) => { rows.set(row.id, row); return true; }, remove: async (id) => { rows.delete(id); return true; } };
}
const take = (label, length = 10) => ({ label, samples: new Float32Array(length), sampleRate: 44100 });

test('shelf rejects empty takes, notifies, caps and removes (write-through)', () => {
  const storage = memoryStorage();
  configureShelfStorage(storage);
  let calls = 0;
  const off = subscribeShelf(() => { calls += 1; });
  assert.equal(addShelfTake({ label: 'x', samples: new Float32Array(0), sampleRate: 44100 }), null);
  assert.equal(addShelfTake({ label: 'x', samples: new Float32Array(10), sampleRate: 0 }), null);
  assert.equal(addShelfTake(take('Piano', 44100)).seconds, 1);
  for (let i = 0; i < MAX_SHELF_TAKES + 2; i += 1) addShelfTake(take(`t${i}`));
  assert.equal(getShelf().length, MAX_SHELF_TAKES);
  assert.equal(storage.rows.size, MAX_SHELF_TAKES);
  const first = getShelf()[0].id;
  removeShelfTake(first);
  assert.equal(getShelf().length, MAX_SHELF_TAKES - 1);
  assert.equal(storage.rows.has(first), false);
  assert.ok(calls >= 3);
  off();
});

test('hydrate restores saved takes once, skips junk and keeps takes added meanwhile', async () => {
  const storage = memoryStorage([
    { id: 'a', label: 'Saved', samples: new Float32Array(100), sampleRate: 44100, createdAt: 5 },
    { id: 'bad', label: 'Broken', samples: new Float32Array(0), sampleRate: 44100 },
  ]);
  configureShelfStorage(storage);
  const added = addShelfTake(take('New'));
  await hydrateShelf();
  await hydrateShelf();
  assert.deepEqual(getShelf().map((i) => i.label).sort(), ['New', 'Saved']);
  assert.ok(getShelf().some((i) => i.id === added.id));
});
