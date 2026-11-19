import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acquireSessionLock, CLEANUP_KEY, createRestartLimiter, purgeStorage, randomHex,
} from '../pro-editor/src/session.mjs';
import { createFakeLocks, createFakeOpfs, createFakeStorage } from './helpers/proEditorFakes.mjs';

test('the lock is single-instance: a second request is refused while the first is held', async () => {
  const locks = createFakeLocks();
  const first = await acquireSessionLock(locks);
  assert.equal(first.ok, true);
  const second = await acquireSessionLock(locks);
  assert.deepEqual(second, { ok: false, reason: 'owned-elsewhere' });
  first.release();
  await new Promise((r) => setImmediate(r));
  const third = await acquireSessionLock(locks);
  assert.equal(third.ok, true, 'released lock can be taken again');
  third.release();
});

test('no Web Locks API means no start', async () => {
  assert.deepEqual(await acquireSessionLock(undefined), { ok: false, reason: 'locks-unavailable' });
  const broken = { request: () => Promise.reject(new Error('x')) };
  assert.deepEqual(await acquireSessionLock(broken), { ok: false, reason: 'locks-unavailable' });
});

test('purge removes every OPFS entry and localStorage but sets and clears the marker', async () => {
  const opfs = createFakeOpfs({ 'recovery/snapshot.fcproj': 'x', 'recovery/meta.json': 'y', 'media/a.mp4': 'z', stray: 'q' });
  const storage = createFakeStorage({ 'filmcraft.export-presets': '[]', keep: 'no' });
  const result = await purgeStorage({ getRoot: async () => opfs.root, storage });
  assert.equal(result.ok, true);
  assert.deepEqual(opfs.names(), []);
  assert.equal(storage.length, 0);
  assert.equal(storage.getItem(CLEANUP_KEY), null);
});

test('a failed purge leaves the cleanup marker set', async () => {
  const opfs = createFakeOpfs({ 'recovery/snapshot.fcproj': 'x' }, { failRemove: true });
  const storage = createFakeStorage();
  const result = await purgeStorage({ getRoot: async () => opfs.root, storage });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'purge-failed');
  assert.equal(storage.getItem(CLEANUP_KEY), '1', 'marker survives so the next start repeats the wipe');
});

test('purge fails closed when storage cannot hold the marker', async () => {
  const storage = createFakeStorage({}, { failSet: true });
  const result = await purgeStorage({ getRoot: async () => createFakeOpfs().root, storage });
  assert.equal(result.ok, false);
});

test('nonce is 128-bit hex and restarts are limited to three', () => {
  let n = 0;
  const crypto = { getRandomValues(buf) { for (let i = 0; i < buf.length; i += 1) buf[i] = (n += 7) % 256; return buf; } };
  assert.match(randomHex(crypto), /^[0-9a-f]{32}$/);
  const limiter = createRestartLimiter();
  assert.deepEqual([limiter.take(), limiter.take(), limiter.take(), limiter.take()], [true, true, true, false]);
  assert.equal(limiter.count, 3);
});
