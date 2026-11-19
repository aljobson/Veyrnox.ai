import test from 'node:test';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHost } from '../pro-editor/src/hostCore.mjs';
import { LIMITS, PROTOCOL } from '../pro-editor/src/protocol.mjs';
import { CLEANUP_KEY } from '../pro-editor/src/session.mjs';
import {
  createFakeLocks, createFakeOpfs, createFakeStorage, deterministicCrypto,
} from './helpers/proEditorFakes.mjs';

const APEX = 'https://veyrnox.ai';
const SELF = 'https://pro.example';
const tick = async () => { for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r)); };

function harness({ locks = createFakeLocks(), opfs, ancestorOrigins = [APEX], failRemove = false } = {}) {
  const fs = opfs || createFakeOpfs({ 'recovery/snapshot.fcproj': 'a', 'media/x.mp4': 'b' }, { failRemove });
  const storage = createFakeStorage({ pref: '1' });
  const events = [];
  const parentWindow = { name: 'parent' };
  const toParent = [];
  const toInner = [];
  const frames = [];
  const realRemove = fs.root.removeEntry.bind(fs.root);
  fs.root.removeEntry = async (...a) => { events.push('purge:' + (locks.isHeld('veyrnox-pro-editor') ? 'locked' : 'unlocked')); return realRemove(...a); };

  const host = createHost({
    selfOrigin: SELF,
    allowedParents: [APEX],
    parentWindow,
    ancestorOrigins,
    locks,
    getRoot: async () => fs.root,
    storage,
    crypto: deterministicCrypto,
    createInner({ renderer, nonce }) {
      const frame = { renderer, nonce, contentWindow: { name: 'inner' + frames.length }, destroyed: false };
      frame.destroy = () => { frame.destroyed = true; events.push('destroy'); fs.root.write('recovery/late-write'); };
      frames.push(frame);
      events.push('create:' + renderer);
      return frame;
    },
    postToParent(msg, origin) { toParent.push({ msg, origin }); },
    postToInner(msg, origin) { toInner.push({ msg, origin }); },
  });

  const fromParent = (data, { origin = APEX, source = parentWindow } = {}) => host.handleParentMessage({ origin, source, data });
  const app = (type, fields = {}) => fromParent({ protocol: PROTOCOL, type, sessionId: host.sessionId, ...fields });
  const hello = async () => { const r = fromParent({ protocol: PROTOCOL, type: 'app:hello' }); await tick(); return r; };
  const fromInner = (data, { frame = frames.at(-1), origin = SELF } = {}) =>
    host.handleInnerMessage({ origin, source: frame && frame.contentWindow, data });
  const types = () => toParent.map((m) => m.msg.type);
  return { host, fs, storage, events, frames, toParent, toInner, locks, fromParent, app, hello, fromInner, types, parentWindow };
}

test('hello from an allowed parent: lock, purge, then one inner frame, then host:started', async () => {
  const h = harness();
  await h.hello();
  assert.equal(h.host.phase, 'running');
  assert.deepEqual(h.events.filter((e) => e.startsWith('purge') || e.startsWith('create')).slice(0, 3), ['purge:locked', 'purge:locked', 'create:default']);
  assert.equal(h.fs.names().length, 0, 'recovery and media wiped before the engine starts');
  assert.equal(h.frames.length, 1);
  assert.match(h.frames[0].nonce, /^[0-9a-f]{32}$/);
  assert.deepEqual(h.types(), ['host:started']);
  assert.equal(h.toParent[0].origin, APEX, 'replies go to the exact parent origin, never *');
  assert.equal(h.locks.isHeld('veyrnox-pro-editor'), true, 'lock held for the document life');
  assert.equal(h.storage.getItem(CLEANUP_KEY), null);
});

test('messages from the wrong origin or the wrong window are ignored and start nothing', async () => {
  const h = harness();
  const hello = { protocol: PROTOCOL, type: 'app:hello' };
  assert.deepEqual(h.fromParent(hello, { origin: 'https://evil.example' }), { ignored: 'origin' });
  assert.deepEqual(h.fromParent(hello, { origin: 'null' }), { ignored: 'origin' });
  assert.deepEqual(h.fromParent(hello, { source: { name: 'other' } }), { ignored: 'source' });
  assert.deepEqual(h.fromParent({ protocol: PROTOCOL, type: 'app:hello', x: 1 }), { ignored: 'bad-keys' });
  await tick();
  assert.equal(h.host.phase, 'waiting');
  assert.equal(h.frames.length, 0);
  assert.equal(h.toParent.length, 0);
  assert.equal(h.locks.isHeld('veyrnox-pro-editor'), false);
});

test('an unexpected immediate parent (ancestorOrigins) is refused', async () => {
  const h = harness({ ancestorOrigins: ['https://other.example'] });
  await h.hello();
  assert.equal(h.host.phase, 'failed');
  assert.equal(h.frames.length, 0);
  assert.equal(h.toParent[0].msg.reason, 'parent-not-allowed');
  assert.equal(h.fs.names().length > 0, true, 'nothing deleted when the start is refused');
});

test('a second instance is refused while the first holds the lock and deletes nothing', async () => {
  const locks = createFakeLocks();
  const first = harness({ locks });
  await first.hello();
  const second = harness({ locks, opfs: createFakeOpfs({ 'recovery/snapshot.fcproj': 'user A' }) });
  await second.hello();
  assert.equal(second.host.phase, 'failed');
  assert.equal(second.toParent[0].msg.reason, 'owned-elsewhere');
  assert.deepEqual(second.fs.names(), ['recovery'], 'the owner\'s data is untouched');
  assert.equal(second.frames.length, 0);
});

test('a failed purge starts no editor and releases the lock', async () => {
  const h = harness({ failRemove: true });
  await h.hello();
  assert.equal(h.host.phase, 'failed');
  assert.equal(h.frames.length, 0);
  assert.equal(h.toParent[0].msg.reason, 'purge-failed');
  assert.equal(h.locks.isHeld('veyrnox-pro-editor'), false);
  assert.equal(h.storage.getItem(CLEANUP_KEY), '1');
});

test('consume gives one restart capability per nonce and never for a wrong or stale one', async () => {
  const h = harness();
  await h.hello();
  const nonce = h.frames[0].nonce;
  assert.equal(h.host.consume('0'.repeat(32)), null);
  assert.equal(h.host.consume(undefined), null);
  const capability = h.host.consume(nonce);
  assert.equal(typeof capability, 'function');
  assert.equal(h.host.consume(nonce), null, 'single use');
});

test('restart: old engine destroyed, storage purged under the lock, new nonce and frame', async () => {
  const h = harness();
  await h.hello();
  const first = h.frames[0];
  const restart = h.host.consume(first.nonce);
  h.events.length = 0;
  assert.equal(restart({ renderer: 'webgl', reason: 'webgpu-init' }), true);
  await tick();
  assert.equal(h.events[0], 'destroy', 'the engine and its writers go away before anything else');
  assert.ok(h.events.indexOf('destroy') < h.events.indexOf('purge:locked'));
  assert.ok(h.events.indexOf('purge:locked') < h.events.indexOf('create:webgl'));
  assert.equal(h.events.includes('purge:unlocked'), false, 'the lock is never released between engines');
  assert.deepEqual(h.fs.names(), [], 'a write from the dead engine did not survive');
  assert.equal(h.frames.length, 2);
  assert.notEqual(h.frames[1].nonce, first.nonce);
  assert.equal(h.frames[1].renderer, 'webgl');
  assert.equal(h.types().at(-1), 'host:restarted');
  assert.equal(h.toParent.at(-1).msg.count, 1);
});

test('restart abuse: stale capability, bad renderer, concurrent request and the fourth restart are refused', async () => {
  const h = harness();
  await h.hello();
  const stale = h.host.consume(h.frames[0].nonce);
  assert.equal(stale({ renderer: 'nonsense' }), false);
  assert.equal(stale('webgl'), false);
  assert.equal(stale({ renderer: 'webgl', reason: 'x' }), true);
  assert.equal(stale({ renderer: 'webgl', reason: 'x' }), false, 'concurrent restart');
  await tick();
  assert.equal(stale({ renderer: 'webgl', reason: 'x' }), false, 'the old frame is stale after the restart');
  for (let i = 0; i < 2; i += 1) {
    const cap = h.host.consume(h.frames.at(-1).nonce);
    assert.equal(cap({ renderer: 'default', reason: 'fatal-reload' }), true);
    await tick();
  }
  const last = h.host.consume(h.frames.at(-1).nonce);
  assert.equal(last({ renderer: 'default', reason: 'fatal-reload' }), false, 'fourth restart refused');
  assert.equal(h.toParent.at(-1).msg.reason, 'restart-refused');
});

test('inner messages are accepted only from the inner window on our own origin and are mapped', async () => {
  const h = harness();
  await h.hello();
  h.toParent.length = 0;
  assert.deepEqual(h.fromInner({ type: 'filmcraft:dirty', dirty: true }, { origin: 'https://evil.example' }), { ignored: 'source' });
  assert.deepEqual(h.fromInner({ type: 'filmcraft:dirty', dirty: true }, { frame: { contentWindow: {} } }), { ignored: 'source' });
  h.fromInner({ type: 'filmcraft:ready', version: '1', appVersion: '0.20.1' });
  h.fromInner({ type: 'filmcraft:dirty', dirty: true });
  h.fromInner({ type: 'filmcraft:save', name: 'cut.fcproj', saveAs: false, bytes: new ArrayBuffer(3) });
  h.fromInner({ type: 'filmcraft:save', name: '../../etc/passwd', saveAs: true, bytes: new ArrayBuffer(1) });
  h.fromInner({ type: 'filmcraft:save', name: 'bad.fcproj', saveAs: false, bytes: new Uint8Array(2) });
  h.fromInner({ type: 'filmcraft:failed', error: 'no webgl' });
  assert.deepEqual(h.types(), ['host:engine-ready', 'host:dirty', 'host:save', 'host:save', 'host:failed']);
  const saves = h.toParent.filter((m) => m.msg.type === 'host:save').map((m) => m.msg);
  assert.deepEqual(saves.map((s) => [s.seq, s.name, s.saveAs]), [[1, 'cut.fcproj', false], [2, 'unnamed', true]]);
  assert.equal(h.toParent.at(-1).msg.reason, 'engine-failed');
});

test('app:open is forwarded to the inner frame only while running', async () => {
  const h = harness();
  const bytes = new ArrayBuffer(5);
  const before = { protocol: PROTOCOL, type: 'app:open', sessionId: 'f'.repeat(32), name: 'clip.mp4', bytes };
  assert.deepEqual(h.fromParent(before), { ignored: 'origin-changed' }, 'no session yet');
  await h.hello();
  assert.deepEqual(h.fromParent({ ...before, bytes: new ArrayBuffer(1) }), { ignored: 'session' }, 'a stale or foreign session id never reaches the engine');
  assert.equal(h.toInner.length, 0);
  assert.deepEqual(h.app('app:open', { name: 'clip.mp4', bytes }), { handled: 'queued' }, 'the engine is not ready yet');
  h.fromInner({ type: 'filmcraft:ready' });
  assert.deepEqual(h.app('app:open', { name: 'clip.mp4', bytes }), { handled: 'open' });
  assert.equal(h.toInner[0].origin, SELF);
  assert.equal(h.toInner[0].msg.type, 'filmcraft:open');
  assert.equal(h.toInner[0].msg.bytes, bytes);
});

test('shutdown destroys the engine, purges, releases the lock and a new instance can start', async () => {
  const locks = createFakeLocks();
  const h = harness({ locks });
  await h.hello();
  h.app('app:shutdown');
  await tick();
  assert.equal(h.host.phase, 'closed');
  assert.equal(h.frames[0].destroyed, true);
  assert.deepEqual(h.fs.names(), []);
  assert.equal(locks.isHeld('veyrnox-pro-editor'), false);
  assert.equal(h.types().at(-1), 'host:closed');
  const next = harness({ locks });
  await next.hello();
  assert.equal(next.host.phase, 'running');
});

test('purge command wipes and reports; a repeated hello while running is answered again', async () => {
  const h = harness();
  await h.hello();
  h.fromParent({ protocol: PROTOCOL, type: 'app:hello' });
  assert.equal(h.types().filter((t) => t === 'host:started').length, 2);
  h.app('app:purge');
  await tick();
  assert.equal(h.toParent.at(-1).msg.type, 'host:purged');
  assert.equal(h.toParent.at(-1).msg.ok, true);
  assert.equal(h.host.phase, 'closed');
});

test('a save posted by an engine before it was destroyed is still delivered, bound to that engine', async () => {
  const h = harness();
  await h.hello();
  const first = h.frames[0];
  const restart = h.host.consume(first.nonce);
  restart({ renderer: 'webgl', reason: 'webgpu-init' });
  await tick();
  h.toParent.length = 0;
  // Late save from engine 1 (retired) arrives after engine 2 started.
  assert.deepEqual(h.fromInner({ type: 'filmcraft:save', name: 'late.fcproj', saveAs: false, bytes: new ArrayBuffer(2) }, { frame: first }), { handled: 'save' });
  assert.deepEqual(h.fromInner({ type: 'filmcraft:dirty', dirty: true }, { frame: first }), { ignored: 'retired' }, 'only saves, nothing else, from a retired engine');
  const late = h.toParent[0].msg;
  assert.equal(late.type, 'host:save');
  assert.equal(late.engine, 1, 'the parent can tell it did not come from the current engine (2)');
  h.app('app:shutdown');
  await tick();
  assert.deepEqual(h.fromInner({ type: 'filmcraft:save', name: 'after.fcproj', saveAs: false, bytes: new ArrayBuffer(1) }, { frame: h.frames[1] }), { handled: 'save' }, 'in flight at shutdown, still delivered');
  assert.deepEqual(h.fromInner({ type: 'filmcraft:save', name: 'x', saveAs: false, bytes: new ArrayBuffer(1) }, { frame: { contentWindow: {} } }), { ignored: 'source' });
});

test('restart requests created in another window (another realm) are accepted', async () => {
  const h = harness();
  await h.hello();
  const restart = h.host.consume(h.frames[0].nonce);
  const foreign = vm.runInNewContext('({ renderer: "webgl", reason: "webgpu-init" })');
  assert.notEqual(Object.getPrototypeOf(foreign), Object.prototype);
  assert.equal(restart(foreign), true);
  await tick();
  assert.equal(h.frames[1].renderer, 'webgl');
});

test('an oversized save is reported, not silently dropped', async () => {
  const h = harness();
  await h.hello();
  h.toParent.length = 0;
  const huge = Object.setPrototypeOf({ byteLength: LIMITS.maxSaveBytes + 1 }, ArrayBuffer.prototype);
  assert.deepEqual(h.fromInner({ type: 'filmcraft:save', name: 'export.mp4', saveAs: false, bytes: huge }), { handled: 'too-large' });
  assert.equal(h.toParent[0].msg.reason, 'save-too-large');
  assert.equal(h.toParent[0].msg.detail, 'export.mp4');
  // Above the 512 MiB open cap but under the save cap: delivered.
  const big = Object.setPrototypeOf({ byteLength: LIMITS.maxBytes + 1 }, ArrayBuffer.prototype);
  assert.deepEqual(h.fromInner({ type: 'filmcraft:save', name: 'export.mp4', saveAs: false, bytes: big }), { handled: 'save' });
});

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test('shutdown while the start purge is pending keeps the lock until every purge finished', async () => {
  const locks = createFakeLocks();
  const gate = deferred();
  const opfs = createFakeOpfs({ 'recovery/a': 'x' });
  opfs.root.removeEntry = async () => { await gate.promise; };
  const h = harness({ locks, opfs });
  h.fromParent({ protocol: PROTOCOL, type: 'app:hello' });
  await tick();
  assert.equal(locks.isHeld('veyrnox-pro-editor'), true);
  h.app('app:shutdown');
  await tick();
  assert.equal(locks.isHeld('veyrnox-pro-editor'), true, 'the lock is held while the first purge is still pending');
  const other = harness({ locks });
  await other.hello();
  assert.equal(other.toParent[0].msg.reason, 'owned-elsewhere', 'nobody else can start meanwhile');
  gate.resolve();
  await h.host.idle();
  assert.equal(h.host.phase, 'closed');
  assert.equal(locks.isHeld('veyrnox-pro-editor'), false);
  assert.equal(h.frames.length, 0, 'the closed session never launched an engine');
});

test('shutdown before the lock is granted: the late lock is purged under and released, no engine starts', async () => {
  const base = createFakeLocks();
  const grant = deferred();
  const locks = {
    isHeld: (n) => base.isHeld(n),
    request: async (name, options, callback) => { await grant.promise; return base.request(name, options, callback); },
  };
  const h = harness({ locks });
  h.fromParent({ protocol: PROTOCOL, type: 'app:hello' });
  await tick();
  h.app('app:shutdown');
  grant.resolve();
  await h.host.idle();
  assert.equal(h.host.phase, 'closed');
  assert.equal(h.frames.length, 0);
  assert.equal(base.isHeld('veyrnox-pro-editor'), false, 'the late lock was released');
  assert.deepEqual(h.fs.names(), [], 'cleanup ran under the lock');
});

test('an open sent before the engine is ready is held, then delivered in order when it announces ready', async () => {
  const h = harness();
  await h.hello();
  const b1 = new ArrayBuffer(1);
  const b2 = new ArrayBuffer(2);
  assert.deepEqual(h.app('app:open', { name: 'a.mp4', bytes: b1 }), { handled: 'queued' });
  assert.deepEqual(h.app('app:open', { name: 'b.mp4', bytes: b2 }), { handled: 'queued' });
  assert.equal(h.toInner.length, 0, 'nothing reaches an engine that is not listening yet');
  h.fromInner({ type: 'filmcraft:ready', version: '1', appVersion: '0.20.1' });
  assert.deepEqual(h.toInner.map((m) => m.msg.name), ['a.mp4', 'b.mp4']);
  assert.deepEqual(h.app('app:open', { name: 'c.mp4', bytes: new ArrayBuffer(1) }), { handled: 'open' }, 'ready now: forwarded at once');
});

test('the open queue is bounded and queued opens are reported dropped when their engine goes away', async () => {
  const h = harness();
  await h.hello();
  for (let i = 0; i < 8; i += 1) assert.deepEqual(h.app('app:open', { name: 'f' + i, bytes: new ArrayBuffer(1) }), { handled: 'queued' });
  h.toParent.length = 0;
  assert.deepEqual(h.app('app:open', { name: 'overflow', bytes: new ArrayBuffer(1) }), { handled: 'rejected' });
  assert.equal(h.toParent[0].msg.reason, 'open-dropped');
  h.toParent.length = 0;
  const restart = h.host.consume(h.frames[0].nonce);
  restart({ renderer: 'webgl', reason: 'x' });
  await tick();
  const dropped = h.toParent.filter((m) => m.msg.type === 'host:failed' && m.msg.reason === 'open-dropped');
  assert.equal(dropped.length, 8, 'each held open is reported, never silently consumed');
  assert.equal(h.toInner.length, 0);
  // The new engine is not ready until it says so.
  assert.deepEqual(h.app('app:open', { name: 'again', bytes: new ArrayBuffer(1) }), { handled: 'queued' });
});

test('a ready signal from a retired engine does not mark the new engine ready', async () => {
  const h = harness();
  await h.hello();
  const first = h.frames[0];
  const restart = h.host.consume(first.nonce);
  restart({ renderer: 'webgl', reason: 'x' });
  await tick();
  assert.equal(h.fromInner({ type: 'filmcraft:ready' }, { frame: first }).ignored, 'retired');
  assert.deepEqual(h.app('app:open', { name: 'a', bytes: new ArrayBuffer(1) }), { handled: 'queued' });
});

test('a fatal-error restart keeps the renderer that works instead of going back to WebGPU', async () => {
  const h = harness();
  await h.hello();
  const toWebgl = h.host.consume(h.frames[0].nonce);
  toWebgl({ renderer: 'webgl', reason: 'webgpu-init' });
  await tick();
  assert.equal(h.frames[1].renderer, 'webgl');
  const fatal = h.host.consume(h.frames[1].nonce);
  fatal({ renderer: 'default', reason: 'fatal-reload' });
  await tick();
  assert.equal(h.frames[2].renderer, 'webgl', 'still WebGL: only an explicit webgl request switches renderers');
  assert.equal(h.toParent.at(-1).msg.renderer, 'webgl');
  assert.equal(h.toParent.at(-1).msg.count, 2);
});

test('an open that arrives while a restart is purging is held for the replacement engine, not lost', async () => {
  const gate = (() => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; })();
  const opfs = createFakeOpfs({ 'recovery/a': 'x' });
  const h = harness({ opfs });
  await h.hello();
  // Make the restart purge wait so the window between destroy and relaunch is observable.
  opfs.root.write('recovery/b');
  const realRemove = opfs.root.removeEntry;
  opfs.root.removeEntry = async (...a) => { await gate.promise; return realRemove(...a); };
  const restart = h.host.consume(h.frames[0].nonce);
  restart({ renderer: 'webgl', reason: 'webgpu-init' });
  await tick();
  assert.equal(h.frames.length, 1, 'the old engine is gone and the new one has not launched yet');
  assert.deepEqual(h.app('app:open', { name: 'during.mp4', bytes: new ArrayBuffer(1) }), { handled: 'queued' });
  gate.resolve();
  await h.host.idle();
  assert.equal(h.frames.length, 2);
  h.fromInner({ type: 'filmcraft:ready' }, { frame: h.frames[1] });
  assert.deepEqual(h.toInner.map((m) => m.msg.name), ['during.mp4'], 'delivered to the replacement engine');
});

test('an open that cannot be accepted is reported, never silently consumed', async () => {
  const h = harness();
  await h.hello();
  h.app('app:shutdown');
  await tick();
  h.toParent.length = 0;
  // After shutdown the session is closed: commands are refused, but the open is reported first
  // only while the session is still the negotiated one (the parent must not wait for a reply).
  const r = h.app('app:open', { name: 'late.mp4', bytes: new ArrayBuffer(1) });
  assert.equal(r.ignored, 'phase');
  assert.equal(h.toParent[0].msg.reason, 'open-dropped');
  assert.equal(h.toParent[0].msg.detail, 'not-running');
});
