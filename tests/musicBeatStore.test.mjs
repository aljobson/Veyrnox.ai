import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import { rename } from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import * as store from '../app/veyrnox/_lib/music/beat/beatStore.js';

test('unavailable IndexedDB preserves editing in memory, enforces revisions, deletion and the 50-project limit', async (t) => {
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = undefined;
  t.after(() => { globalThis.indexedDB = previous; });
  const doc = createBeat({ id: randomUUID(), now: 1 });
  const created = await store.createBeat(doc);
  assert.equal(created.revision, 1); assert.equal(created.persistent, false);
  assert.equal((await store.createBeat(doc)).error, 'conflict');
  const changed = rename(doc, 'New name', 2);
  assert.equal((await store.updateBeat(changed, 1)).revision, 2);
  assert.equal((await store.updateBeat(doc, 1)).error, 'conflict');
  assert.equal((await store.getBeat(doc.id)).record.doc.title, 'New name');
  assert.equal((await store.deleteBeat(doc.id, 1)).error, 'conflict');
  assert.equal((await store.deleteBeat(doc.id, 2)).action, 'delete');
  assert.equal((await store.updateBeat(doc, 2)).error, 'not_found');
  assert.equal((await store.getBeat('bad-id')).error, 'not_found');
  for (let i = 0; i < 50; i++) assert.equal((await store.createBeat(createBeat({ id: randomUUID(), now: i }))).revision, 1);
  assert.equal((await store.createBeat(createBeat({ id: randomUUID(), now: 51 }))).error, 'limit');
  const listed = await store.listBeats();
  assert.equal(listed.records.length, 50); assert.equal(listed.count, 50);
  assert.equal(listed.records[0].updatedAt, 49); assert.equal(listed.records[49].updatedAt, 0);
});
