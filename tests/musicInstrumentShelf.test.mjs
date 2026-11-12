import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SHELF_TAKES, addShelfTake, getShelf, removeShelfTake, subscribeShelf } from '../app/veyrnox/_lib/music/instrumentShelf.js';

test('shelf rejects empty takes, notifies, caps and removes', () => {
  let calls = 0;
  const off = subscribeShelf(() => { calls += 1; });
  assert.equal(addShelfTake({ label: 'x', samples: new Float32Array(0), sampleRate: 44100 }), null);
  assert.equal(addShelfTake({ label: 'x', samples: new Float32Array(10), sampleRate: 0 }), null);
  const first = addShelfTake({ label: 'Piano', samples: new Float32Array(44100), sampleRate: 44100 });
  assert.equal(first.seconds, 1);
  for (let i = 0; i < MAX_SHELF_TAKES + 2; i += 1) addShelfTake({ label: `t${i}`, samples: new Float32Array(10), sampleRate: 44100 });
  assert.equal(getShelf().length, MAX_SHELF_TAKES);
  removeShelfTake(getShelf()[0].id);
  assert.equal(getShelf().length, MAX_SHELF_TAKES - 1);
  assert.ok(calls >= 3);
  off();
});
