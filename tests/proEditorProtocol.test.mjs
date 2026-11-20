import test from 'node:test';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {
  buildMessage, isAllowedParentOrigin, isSafeName, LIMITS, parseAllowedParents,
  parseAppMessage, parseHostMessage, PROTOCOL, transferList,
} from '../pro-editor/src/protocol.mjs';

const SESSION = 'a'.repeat(32);

test('a well-formed app message parses and extra keys are refused', () => {
  const ok = parseAppMessage({ protocol: PROTOCOL, type: 'app:hello' });
  assert.equal(ok.ok, true);
  assert.equal(parseAppMessage({ protocol: PROTOCOL, type: 'app:hello', extra: 1 }).ok, false);
  assert.equal(parseAppMessage({ protocol: 'other', type: 'app:hello' }).ok, false);
  assert.equal(parseAppMessage({ protocol: PROTOCOL, type: 'host:started' }).ok, false);
  assert.equal(parseAppMessage('hello').ok, false);
  assert.equal(parseAppMessage(null).ok, false);
});

test('app:open needs a safe name and an ArrayBuffer within the cap', () => {
  const bytes = new ArrayBuffer(8);
  const base = { protocol: PROTOCOL, type: 'app:open', sessionId: SESSION };
  assert.equal(parseAppMessage({ ...base, name: 'a.fcproj', bytes }).ok, true);
  assert.equal(parseAppMessage({ protocol: PROTOCOL, type: 'app:open', name: 'a.fcproj', bytes }).ok, false, 'a command without the session id is refused');
  for (const name of ['', 'a/b', 'a\\b', 'a\u0000b', 'x'.repeat(LIMITS.maxName + 1), 5]) {
    assert.equal(parseAppMessage({ ...base, name, bytes }).ok, false, String(name));
  }
  // A typed array view is not an ArrayBuffer: it is refused, not silently copied.
  assert.equal(parseAppMessage({ ...base, name: 'a', bytes: new Uint8Array(2) }).ok, false);
  const huge = { byteLength: LIMITS.maxBytes + 1 };
  Object.setPrototypeOf(huge, ArrayBuffer.prototype);
  assert.equal(parseAppMessage({ ...base, name: 'a', bytes: huge }).ok, false);
});

test('host messages validate session ids, counters and reasons', () => {
  assert.equal(parseHostMessage({ protocol: PROTOCOL, type: 'host:started', sessionId: SESSION }).ok, true);
  assert.equal(parseHostMessage({ protocol: PROTOCOL, type: 'host:started', sessionId: 'nope' }).ok, false);
  assert.equal(parseHostMessage({ protocol: PROTOCOL, type: 'host:failed', sessionId: SESSION, reason: 'owned-elsewhere', detail: '' }).ok, true);
  assert.equal(parseHostMessage({ protocol: PROTOCOL, type: 'host:failed', sessionId: SESSION, reason: 'made-up', detail: '' }).ok, false);
  assert.equal(parseHostMessage({ protocol: PROTOCOL, type: 'host:restarted', sessionId: SESSION, renderer: 'webgl', count: -1 }).ok, false);
  assert.equal(parseHostMessage({ protocol: PROTOCOL, type: 'host:save', sessionId: SESSION, seq: 1, engine: 1, name: 'p.fcproj', saveAs: false, bytes: new ArrayBuffer(1) }).ok, true);
  // Outgoing saves may exceed the 512 MiB open cap (exports); they stop at maxSaveBytes.
  const big = Object.setPrototypeOf({ byteLength: LIMITS.maxBytes + 1 }, ArrayBuffer.prototype);
  assert.equal(parseHostMessage({ protocol: PROTOCOL, type: 'host:save', sessionId: SESSION, seq: 1, engine: 1, name: 'x.mp4', saveAs: false, bytes: big }).ok, true);
  const tooBig = Object.setPrototypeOf({ byteLength: LIMITS.maxSaveBytes + 1 }, ArrayBuffer.prototype);
  assert.equal(parseHostMessage({ protocol: PROTOCOL, type: 'host:save', sessionId: SESSION, seq: 1, engine: 1, name: 'x.mp4', saveAs: false, bytes: tooBig }).ok, false);
});

test('buildMessage refuses what the parser would refuse and lists transferables', () => {
  assert.throws(() => buildMessage('app:open', { sessionId: SESSION, name: '../x', bytes: new ArrayBuffer(1) }));
  const msg = buildMessage('host:save', { sessionId: SESSION, seq: 2, engine: 1, name: 'a', saveAs: true, bytes: new ArrayBuffer(4) });
  assert.equal(transferList(msg).length, 1);
  assert.equal(transferList(buildMessage('app:hello')).length, 0);
});

test('isSafeName rejects separators and control characters only', () => {
  assert.equal(isSafeName('My cut (v2).fcproj'), true);
  assert.equal(isSafeName('a/b'), false);
  assert.equal(isSafeName('tab\there'), false);
});

test('allowed parents are exact origins; wildcards and suffixes are never matched', () => {
  const allowed = parseAllowedParents('https://veyrnox.ai, http://localhost:3000');
  assert.deepEqual(allowed, ['https://veyrnox.ai', 'http://localhost:3000']);
  assert.equal(isAllowedParentOrigin('https://veyrnox.ai', allowed), true);
  assert.equal(isAllowedParentOrigin('https://veyrnox.ai.evil.com', allowed), false);
  assert.equal(isAllowedParentOrigin('https://evil.veyrnox.ai', allowed), false);
  assert.equal(isAllowedParentOrigin('null', allowed), false);
  assert.deepEqual(parseAllowedParents('http://example.com'), [], 'plain http is only allowed for local hosts');
  assert.deepEqual(parseAllowedParents('https://veyrnox.ai/path'), [], 'a path is not an origin');
  assert.deepEqual(parseAllowedParents('*'), []);
  assert.deepEqual(parseAllowedParents(''), []);
});

test('messages cloned from another realm still count as plain objects', () => {
  const foreign = vm.runInNewContext('({ protocol: "veyrnox.pro/1", type: "app:hello" })');
  assert.notEqual(Object.getPrototypeOf(foreign), Object.prototype, 'sanity: a different Object.prototype');
  assert.equal(parseAppMessage(foreign).ok, true);
  assert.equal(parseAppMessage(vm.runInNewContext('[1]')).ok, false);
  assert.equal(parseAppMessage(Object.create({ inherited: 1 })).ok, false, 'objects with a custom prototype chain are not plain');
});
