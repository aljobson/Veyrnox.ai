import test from 'node:test';
import assert from 'node:assert/strict';

function environment(t) {
  const saved = { indexedDB: globalThis.indexedDB, window: globalThis.window, BroadcastChannel: globalThis.BroadcastChannel };
  globalThis.window = new EventTarget();
  const connections = [], channels = [];
  globalThis.BroadcastChannel = class {
    constructor() { this.closed = false; channels.push(this); }
    close() { this.closed = true; }
    postMessage() { assert.equal(this.closed, false); }
  };
  let afterRead = () => {}, fault = null;
  globalThis.indexedDB = { open() {
    const request = {};
    const db = { closed: false, close() { this.closed = true; }, transaction() {
      if (fault === 'transaction') throw new Error('transaction failed');
      const tx = { objectStore: () => ({ getAll() {
        const read = {};
        queueMicrotask(() => {
          read.result = []; read.onsuccess?.(); afterRead(db);
          if (fault === 'abort') tx.onabort();
          else if (fault === 'error') tx.onerror();
          else tx.oncomplete();
        });
        return read;
      } }) };
      return tx;
    } };
    connections.push(db);
    queueMicrotask(() => { request.result = db; request.onsuccess(); });
    return request;
  } };
  t.after(() => Object.assign(globalThis, saved));
  return { connections, channels, afterRead(fn) { afterRead = fn; }, fault(value) { fault = value; } };
}
for (const [name, path, read] of [
  ['beat projects', '../app/veyrnox/_lib/music/beat/beatStore.js', (store) => store.listBeats()],
  ['instrument shelf', '../app/veyrnox/_lib/music/instrumentTakeDb.js', (store) => store.listSavedTakes('shelf')],
]) {
  test(`${name}: every transaction closes, including errors, pagehide and versionchange`, async (t) => {
    const env = environment(t), store = await import(`${path}?lifecycle`);
    for (const fault of [null, 'transaction', 'abort', 'error']) {
      env.fault(fault); await read(store);
      assert.equal(env.connections.at(-1).closed, true, String(fault));
    }
    env.fault(null);
    env.afterRead((db) => { db.onversionchange(); assert.equal(db.closed, true); });
    await read(store);
    env.afterRead((db) => { window.dispatchEvent(new Event('pagehide')); assert.equal(db.closed, true); });
    await read(store);
    window.dispatchEvent(new Event('pageshow'));
    env.afterRead(() => {}); await read(store);
    assert.ok(env.connections.every((db) => db.closed));
  });
  test(`${name}: a timed-out open closes its eventual late connection`, async (t) => {
    environment(t);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let request;
    globalThis.indexedDB = { open: () => (request = {}) };
    const store = await import(`${path}?late-open`);
    const result = read(store);
    t.mock.timers.tick(2001); await result;
    let closed = false;
    request.result = { close() { closed = true; } };
    request.onsuccess(); assert.equal(closed, true);
  });
}
test('broadcast channel closes on pagehide and unsubscribe, and reconnects after bfcache restoration', async (t) => {
  const env = environment(t);
  const store = await import('../app/veyrnox/_lib/music/beat/beatStore.js?channel-lifecycle');
  const unsubscribe = store.subscribeBeats(() => {});
  assert.equal(env.channels.length, 1);
  window.dispatchEvent(new Event('pagehide')); assert.equal(env.channels[0].closed, true);
  window.dispatchEvent(new Event('pageshow')); assert.equal(env.channels.length, 2);
  assert.equal(env.channels[1].closed, false);
  unsubscribe(); assert.equal(env.channels[1].closed, true);
});
