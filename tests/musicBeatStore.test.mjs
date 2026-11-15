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

function fakeIndexedDB() {
  const rows = new Map();
  const fake = {
    rows, fault: null, puts: 0,
    open() {
      if (fake.fault === 'open') throw new DOMException('Temporary failure', 'QuotaExceededError');
      const request = {};
      queueMicrotask(() => {
        request.result = {
          close() {},
          transaction() {
            if (fake.fault === 'transaction') throw new DOMException('Temporary failure', 'InvalidStateError');
            let aborted = false;
            const tx = {
              abort() { aborted = true; queueMicrotask(() => tx.onabort()); },
              objectStore() {
                return {
                  getAll() {
                    const read = {};
                    queueMicrotask(() => {
                      if (fake.fault === 'abort') { tx.abort(); return; }
                      if (fake.fault === 'error') { tx.onerror(); return; }
                      read.result = structuredClone([...rows.values()]);
                      read.onsuccess();
                      if (!aborted) tx.oncomplete();
                    });
                    return read;
                  },
                  put(record) {
                    if (fake.fault === 'put') throw new DOMException('Full', 'QuotaExceededError');
                    fake.puts++; rows.set(record.id, structuredClone(record));
                  },
                  delete(id) { rows.delete(id); },
                };
              },
            };
            return tx;
          },
        };
        request.onsuccess();
      });
      return request;
    },
  };
  return fake;
}

test('a transient open failure returns storage and the next call writes to IndexedDB', async (t) => {
  const previous = globalThis.indexedDB;
  const fake = fakeIndexedDB(); globalThis.indexedDB = fake;
  t.after(() => { globalThis.indexedDB = previous; });
  const isolated = await import('../app/veyrnox/_lib/music/beat/beatStore.js?transient-open');
  const doc = createBeat({ id: randomUUID(), now: 1 });
  fake.fault = 'open';

  assert.deepEqual(await isolated.createBeat(doc), { error: 'storage' });
  assert.equal(fake.puts, 0);
  fake.fault = null;
  const result = await isolated.createBeat(doc);

  assert.equal(result.persistent, true);
  assert.equal(result.revision, 1);
  assert.equal(fake.puts, 1);
  assert.deepEqual(fake.rows.get(doc.id).doc, doc);
});

test('a working store never falls back on transaction, abort, error or quota failures', async (t) => {
  for (const fault of ['transaction', 'abort', 'error', 'put', 'open']) {
    await t.test(fault, async (t) => {
      const previous = globalThis.indexedDB;
      const fake = fakeIndexedDB(); globalThis.indexedDB = fake;
      t.after(() => { globalThis.indexedDB = previous; });
      const isolated = await import(`../app/veyrnox/_lib/music/beat/beatStore.js?transient-${fault}-after-success`);
      const doc = createBeat({ id: randomUUID(), now: 1 });
      await isolated.createBeat(doc);
      const changed = rename(doc, 'Retry this edit', 2);
      fake.fault = fault;

      assert.deepEqual(await isolated.updateBeat(changed, 1), { error: 'storage' });
      assert.equal(fake.rows.get(doc.id).revision, 1);
      fake.fault = null;
      const result = await isolated.updateBeat(changed, 1);

      assert.equal(result.persistent, true);
      assert.equal(result.revision, 2);
      assert.equal(fake.puts, 2);
      assert.deepEqual(fake.rows.get(doc.id).doc, changed);
    });
  }
});

test('legacy reads migrate only valid records; first save writes v2 with original revision checks', async (t) => {
  const previous = globalThis.indexedDB;
  const fake = fakeIndexedDB(); globalThis.indexedDB = fake;
  t.after(() => { globalThis.indexedDB = previous; });
  const isolated = await import('../app/veyrnox/_lib/music/beat/beatStore.js?migration');
  const { tracks, cycle, view, ...common } = createBeat({ id: randomUUID(), now: 1 });
  const doc = { ...common, version: 1, kit: tracks[0].kit };
  fake.rows.set(doc.id, { id: doc.id, revision: 8, doc, updatedAt: 1 });
  const read = await isolated.getBeat(doc.id);
  assert.equal(read.record.doc.version, 2); assert.equal(read.record.doc.view, 'pattern');
  assert.equal(read.record.revision, 8); assert.equal(fake.puts, 0);
  assert.equal((await isolated.listBeats()).records[0].doc.version, 2);
  const saved = await isolated.updateBeat(rename(read.record.doc, 'Migrated', 2), 8);
  assert.equal(saved.revision, 9); assert.equal(fake.rows.get(doc.id).doc.version, 2);
  const bad = { ...doc, id: randomUUID(), kit: 'missing' };
  fake.rows.set(bad.id, { id: bad.id, revision: 1, doc: bad, updatedAt: 1 });
  assert.equal((await isolated.getBeat(bad.id)).error, 'damaged');
});
