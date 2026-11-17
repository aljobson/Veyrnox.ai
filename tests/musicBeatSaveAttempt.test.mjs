import test from 'node:test';
import assert from 'node:assert/strict';
import { mixdownSaveAttempt } from '../app/veyrnox/_lib/music/beat/beatSaveAttempt.mjs';
test('same render and payload retry with the same key; changed render or payload use a fresh key', () => {
  let keys = 0; const key = () => `key-${++keys}`;
  const first = mixdownSaveAttempt(null, 'song:Title:false', 'hash-one', key);
  assert.equal(mixdownSaveAttempt(first, first.payload, first.sha256, key), first);
  const changed = mixdownSaveAttempt(first, first.payload, 'hash-two', key);
  assert.notEqual(changed.key, first.key);
  assert.equal(mixdownSaveAttempt(changed, changed.payload, changed.sha256, key), changed);
  assert.notEqual(mixdownSaveAttempt(changed, 'cycle:Title:false', changed.sha256, key).key, changed.key);
  const back = mixdownSaveAttempt(changed, first.payload, first.sha256, key);
  assert.notEqual(back.key, changed.key); assert.equal(mixdownSaveAttempt(back, back.payload, back.sha256, key), back);
});
