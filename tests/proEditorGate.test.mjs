import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGate } from '../pro-editor/src/gateLogic.mjs';
import { createFakeWindow } from './helpers/proEditorFakes.mjs';

const NONCE = 'b'.repeat(32);

function hostWith(expected) {
  let spent = false;
  return {
    consume(nonce) {
      if (spent || nonce !== expected) return null;
      spent = true;
      return () => true;
    },
  };
}

test('the gate passes only with a same-origin parent and a valid single-use nonce', () => {
  const win = createFakeWindow({ host: hostWith(NONCE), search: '?host=parent&hn=' + NONCE + '&webgl' });
  const result = evaluateGate({ win });
  assert.equal(result.ok, true);
  assert.equal(typeof result.requestRestart, 'function');
  // The nonce is stripped from the visible URL, other flags stay.
  assert.deepEqual(win.history.replaced, ['/fc/index.html?host=parent&webgl']);
});

test('a second use of the same nonce is refused', () => {
  const host = hostWith(NONCE);
  const search = '?hn=' + NONCE;
  assert.equal(evaluateGate({ win: createFakeWindow({ host, search }) }).ok, true);
  const again = evaluateGate({ win: createFakeWindow({ host, search }) });
  assert.deepEqual(again, { ok: false, reason: 'bad-nonce' });
});

test('direct navigation (not framed) is refused', () => {
  const result = evaluateGate({ win: createFakeWindow({ framed: false, search: '?hn=' + NONCE }) });
  assert.deepEqual(result, { ok: false, reason: 'not-framed' });
});

test('a cross-origin parent is refused whether location throws or differs', () => {
  const throwing = evaluateGate({ win: createFakeWindow({ host: hostWith(NONCE), search: '?hn=' + NONCE, throwOnParentLocation: true }) });
  assert.deepEqual(throwing, { ok: false, reason: 'parent-cross-origin' });
  const differing = evaluateGate({ win: createFakeWindow({ host: hostWith(NONCE), search: '?hn=' + NONCE, parentOrigin: 'https://veyrnox.ai' }) });
  assert.deepEqual(differing, { ok: false, reason: 'parent-origin-mismatch' });
});

test('missing or malformed nonce and a parent without the host object are refused', () => {
  assert.equal(evaluateGate({ win: createFakeWindow({ host: hostWith(NONCE), search: '' }) }).reason, 'no-nonce');
  assert.equal(evaluateGate({ win: createFakeWindow({ host: hostWith(NONCE), search: '?hn=short' }) }).reason, 'no-nonce');
  assert.equal(evaluateGate({ win: createFakeWindow({ host: undefined, search: '?hn=' + NONCE }) }).reason, 'no-host');
  assert.equal(evaluateGate({ win: createFakeWindow({ host: { consume: 'x' }, search: '?hn=' + NONCE }) }).reason, 'no-host');
  assert.equal(evaluateGate({ win: createFakeWindow({ host: hostWith('c'.repeat(32)), search: '?hn=' + NONCE }) }).reason, 'bad-nonce');
});
