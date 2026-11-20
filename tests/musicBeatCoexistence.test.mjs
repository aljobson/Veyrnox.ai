import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBeat, upgradeBeatToV5 } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import { classifyRecord } from '../app/veyrnox/_lib/music/beat/beatStoreRules.mjs';
const base = new URL('../app/veyrnox/_lib/music/beat/', import.meta.url);
// Exact git-show HEAD snapshots (3003b9be1; beat sources identical to e79948073); only module specifiers are relocated.
const modules = new Map();
function oldModule(name) {
  if (modules.has(name)) return modules.get(name);
  const source = readFileSync(new URL(`./fixtures/musicBeatLegacyV1/${name}.txt`, import.meta.url), 'utf8');
  const relocated = source.replace(/from '([^']+)'/g, (_, specifier) => {
    const dependency = specifier.slice(2);
    const url = ['beatStoreRules.mjs', 'beatDocument.mjs'].includes(dependency) ? oldModule(dependency) : new URL(specifier, base).href;
    return `from '${url}'`;
  });
  const url = `data:text/javascript;base64,${Buffer.from(relocated).toString('base64')}`;
  modules.set(name, url); return url;
}
// Inline IndexedDB fake: version negotiation, blocked upgrades, close/versionchange,
// transaction reads/writes. No dependency or native environment is installed.
function indexedFixture() {
  const rows = new Map(), connections = new Set(), requests = [];
  let version = 1, pending;
  const fake = { rows, requests, get version() { return version; },
    open(name, wanted) {
      const request = {}; requests.push({ name, wanted });
      queueMicrotask(() => {
        if (wanted < version) { request.error = new DOMException('Older database version', 'VersionError'); request.onerror?.(); return; }
        function connect() {
          const db = { closed: false, objectStoreNames: { contains: name => name === 'projects' },
            createObjectStore() { assert.fail('existing projects store must not be recreated'); },
            close() { if (db.closed) return; db.closed = true; connections.delete(db); if (!connections.size && pending) { const ready = pending; pending = null; queueMicrotask(ready); } },
            transaction() {
              if (db.closed) throw new DOMException('Closed', 'InvalidStateError');
              let aborted = false;
              const tx = { abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); }, objectStore() {
                return { getAll() { const read = {}; queueMicrotask(() => { read.result = structuredClone([...rows.values()]); read.onsuccess(); if (!aborted) tx.oncomplete(); }); return read; },
                  put(row) { rows.set(row.id, structuredClone(row)); }, delete(id) { rows.delete(id); } };
              } }; return tx;
            } };
          request.result = db;
          if (wanted > version) { version = wanted; request.onupgradeneeded?.(); }
          connections.add(db); request.onsuccess?.();
        }
        if (wanted > version) {
          for (const db of [...connections]) db.onversionchange?.({ newVersion: wanted });
          if (connections.size) { pending = connect; request.onblocked?.(); return; }
        }
        connect();
      }); return request;
    } };
  return fake;
}
const open = (fake, version) => new Promise((resolve, reject) => { const r = fake.open('veyrnox-beat-projects', version); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
function row(doc) { return { id: doc.id, doc, updatedAt: doc.updatedAt, revision: 1 }; }
const turn = () => new Promise(resolve => setImmediate(resolve));
test('new database upgrades without writes; frozen old bundle cannot reopen, list, rewrite or damaged-delete v5', async t => {
  const before = globalThis.indexedDB, fake = indexedFixture(); globalThis.indexedDB = fake;
  t.after(() => { globalThis.indexedDB = before; });
  const doc = upgradeBeatToV5(createBeat({ id: crypto.randomUUID(), now: 1 })); doc.markers = [{ id: 'a', name: 'Intro', tick: 123 }];
  fake.rows.set(doc.id, row(doc)); const bytes = JSON.stringify([...fake.rows]);
  const old = await import(oldModule('beatStore.js'));
  const oldRules = await import(oldModule('beatStoreRules.mjs'));
  assert.equal(oldRules.validRecord(fake.rows.get(doc.id)), false, 'old validator mistakes valid v5 for damage');
  const oldConnection = await open(fake, 1); oldConnection.onversionchange = () => oldConnection.close();
  const store = await import(`${base.href}beatStore.js?coexistence`);
  assert.equal(JSON.stringify((await store.getBeat(doc.id)).record.doc), JSON.stringify(doc));
  assert.equal(oldConnection.closed, true); assert.equal(fake.version, 2);
  assert.equal(JSON.stringify((await store.listBeats()).records[0].doc), JSON.stringify(doc));
  assert.equal((await store.deleteDamagedBeat(doc.id, 1)).error, 'conflict');
  assert.equal(JSON.stringify([...fake.rows]), bytes);
  await assert.rejects(open(fake, 1), error => error.name === 'VersionError');
  const { markers, ...legacy } = doc; legacy.version = 4;
  for (const attempt of [() => old.listBeats(), () => old.getBeat(doc.id), () => old.updateBeat(legacy, 1),
    () => old.createBeat(legacy), () => old.deleteBeat(doc.id, 1), () => old.deleteDamagedBeat(doc.id, 1)]) {
    const result = await attempt(); assert.equal(result.error, 'storage');
    assert.equal(JSON.stringify([...fake.rows]), bytes);
  }
  for (const attempt of [() => store.createBeat(doc), () => store.updateBeat(doc, 1), () => store.updateBeat({ ...doc, version: 4 }, 1),
    () => store.setCloudLink(doc.id, null, { userId: crypto.randomUUID(), projectId: null, revision: 0 })]) {
    assert.equal((await attempt()).error, 'v5_write_disabled'); assert.equal(JSON.stringify([...fake.rows]), bytes);
  }
});
test('version 6 and 999 are excluded from damage and cannot be mutated or deleted by new code', async t => {
  const before = globalThis.indexedDB, fake = indexedFixture(); globalThis.indexedDB = fake;
  t.after(() => { globalThis.indexedDB = before; });
  const store = await import(`${base.href}beatStore.js?unsupported`);
  for (const version of [6, 999]) {
    const doc = { ...createBeat({ id: crypto.randomUUID(), now: 1 }), version };
    fake.rows.set(doc.id, row(doc)); const bytes = JSON.stringify([...fake.rows]);
    assert.equal(classifyRecord(row(doc)), 'unsupported-version');
    const listing = await store.listBeats(); assert.deepEqual(listing.damaged, []); assert.deepEqual(listing.records, []);
    assert.ok(listing.unsupported.some(r => r.id === doc.id));
    assert.equal((await store.getBeat(doc.id)).error, 'unsupported_version');
    for (const attempt of [() => store.deleteDamagedBeat(doc.id, 1), () => store.deleteDamagedBeat(doc.id, 99),
      () => store.deleteBeat(doc.id, 1), () => store.updateBeat({ ...doc, version: 4 }, 1)]) {
      assert.equal((await attempt()).error, 'unsupported_version'); assert.equal(JSON.stringify([...fake.rows]), bytes);
    }
  }
});
test('blocked open reports reload-to-update then retries when the old connection closes', async t => {
  const before = globalThis.indexedDB, fake = indexedFixture(); globalThis.indexedDB = fake;
  t.after(() => { globalThis.indexedDB = before; });
  const blocker = await open(fake, 1), store = await import(`${base.href}beatStore.js?blocked-upgrade`);
  let retried;
  const unsubscribe = store.subscribeBeats(event => { if (event.storageReady) retried = store.listBeats(); });
  t.after(unsubscribe);
  const doc = createBeat({ id: crypto.randomUUID(), now: 1 }); fake.rows.set(doc.id, row(doc));
  const bytes = JSON.stringify([...fake.rows]);
  assert.equal((await store.listBeats()).error, 'blocked'); assert.equal(fake.version, 1);
  blocker.close(); await turn(); await turn();
  assert.equal((await retried).records.length, 1); assert.equal(fake.version, 2);
  assert.equal(JSON.stringify([...fake.rows]), bytes);
});
