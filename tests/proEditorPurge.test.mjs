import test from 'node:test';
import assert from 'node:assert/strict';
import { createPurger } from '../pro-editor/src/purgeCore.mjs';
import { PROTOCOL, parseHostMessage } from '../pro-editor/src/protocol.mjs';
import { CLEANUP_KEY, LOCK_NAME } from '../pro-editor/src/session.mjs';
import { createFakeLocks, createFakeOpfs, createFakeStorage } from './helpers/proEditorFakes.mjs';

const APEX = 'https://veyrnox.ai';
const tick = async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); };

function setup({ locks = createFakeLocks(), opfs = createFakeOpfs({ 'recovery/snapshot.fcproj': 'A', 'media/a.mp4': 'A' }), ancestorOrigins = [APEX] } = {}) {
  const storage = createFakeStorage({ pref: '1' });
  const parentWindow = { name: 'parent' };
  const out = [];
  const purger = createPurger({
    allowedParents: [APEX], parentWindow, ancestorOrigins, locks, getRoot: async () => opfs.root, storage,
    postToParent: (msg, origin) => out.push({ msg, origin }),
  });
  const send = (data, { origin = APEX, source = parentWindow } = {}) => purger.handleParentMessage({ origin, source, data });
  return { purger, out, opfs, storage, locks, send };
}
const cleanup = { protocol: PROTOCOL, type: 'app:cleanup' };

test('cleanup wipes everything under the lock, replies to the exact parent origin and releases the lock', async () => {
  const t = setup();
  assert.deepEqual(t.send(cleanup), { handled: 'cleanup' });
  await tick();
  assert.deepEqual(t.opfs.names(), []);
  assert.equal(t.storage.length, 0);
  assert.equal(t.storage.getItem(CLEANUP_KEY), null);
  assert.equal(t.locks.isHeld(LOCK_NAME), false);
  assert.equal(t.out.length, 1);
  assert.equal(t.out[0].origin, APEX);
  const parsed = parseHostMessage(t.out[0].msg);
  assert.equal(parsed.ok, true);
  assert.deepEqual([t.out[0].msg.ok, t.out[0].msg.reason], [true, 'none']);
});

test('cleanup never steals the lock from a running editor and deletes nothing then', async () => {
  const locks = createFakeLocks();
  const t = setup({ locks });
  let release;
  const held = new Promise((r) => { release = r; });
  locks.request(LOCK_NAME, { ifAvailable: true }, () => held);
  t.send(cleanup);
  await tick();
  assert.deepEqual([t.out[0].msg.ok, t.out[0].msg.reason], [false, 'owned-elsewhere']);
  assert.deepEqual(t.opfs.names().sort(), ['media', 'recovery'], 'the owner\'s data is untouched');
  release();
});

test('a failed wipe is reported and leaves the cleanup marker set, and the lock is still released', async () => {
  const opfs = createFakeOpfs({ 'recovery/x': 'A' }, { failRemove: true });
  const t = setup({ opfs });
  t.send(cleanup);
  await tick();
  assert.deepEqual([t.out[0].msg.ok, t.out[0].msg.reason], [false, 'purge-failed']);
  assert.equal(t.storage.getItem(CLEANUP_KEY), '1');
  assert.equal(t.locks.isHeld(LOCK_NAME), false);
});

test('only an allowed parent window and origin can ask; other messages and a busy purger are ignored', async () => {
  const t = setup();
  assert.deepEqual(t.send(cleanup, { origin: 'https://evil.example' }), { ignored: 'origin' });
  assert.deepEqual(t.send(cleanup, { source: {} }), { ignored: 'source' });
  assert.equal(t.send({ protocol: PROTOCOL, type: 'app:hello' }).ignored, 'type');
  assert.equal(t.send({ ...cleanup, x: 1 }).ignored, 'bad-keys');
  assert.deepEqual(t.send(cleanup), { handled: 'cleanup' });
  assert.deepEqual(t.send(cleanup), { ignored: 'busy' });
  await tick();
  assert.equal(t.out.length, 1);
});

test('an unexpected immediate parent (ancestorOrigins) gets not-allowed and nothing is deleted', async () => {
  const t = setup({ ancestorOrigins: ['https://other.example'] });
  t.send(cleanup);
  await tick();
  assert.deepEqual([t.out[0].msg.ok, t.out[0].msg.reason], [false, 'not-allowed']);
  assert.equal(t.opfs.names().length, 2);
});
