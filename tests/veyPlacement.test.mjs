import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VEY_PLACEMENT, VEY_PLACEMENT_KEY, readVeyPlacement, writeVeyPlacement } from '../lib/veyPlacement.js';
import { clampVeyPosition } from '../lib/veyPointer.js';

const memory = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
};
test('manual position and both panel sides survive returning to the browser', () => {
  const storage = memory();
  assert.deepEqual(readVeyPlacement(storage), DEFAULT_VEY_PLACEMENT);
  for (const side of ['right', 'left']) {
    const placement = { side, position: { x: 245, y: 192 } };
    assert.equal(writeVeyPlacement(storage, placement), true);
    assert.deepEqual(readVeyPlacement(storage), placement);
  }
});
test('Dock persists automatic placement without forgetting the chosen panel side', () => {
  const storage = memory();
  writeVeyPlacement(storage, { side: 'right', position: null });
  assert.deepEqual(readVeyPlacement(storage), { side: 'right', position: null });
});
test('saved positions are clamped safely when returning to a smaller screen', () => {
  const storage = memory();
  writeVeyPlacement(storage, { side: 'right', position: { x: 1200, y: 900 } });
  assert.deepEqual(clampVeyPosition(readVeyPlacement(storage).position, { width: 320, height: 568 }), { x: 256, y: 502 });
});
test('malformed, incompatible and blocked storage never break the helper', () => {
  const storage = memory();
  for (const value of ['oops', 'null', '{"version":2}', '{"version":1,"side":"middle","position":{"x":"5","y":4}}']) {
    storage.setItem(VEY_PLACEMENT_KEY, value);
    assert.deepEqual(readVeyPlacement(storage), DEFAULT_VEY_PLACEMENT);
  }
  const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); } };
  assert.deepEqual(readVeyPlacement(blocked), DEFAULT_VEY_PLACEMENT);
  assert.equal(writeVeyPlacement(blocked, DEFAULT_VEY_PLACEMENT), false);
});
test('placement storage excludes images, rights, questions and task state', () => {
  const storage = memory();
  writeVeyPlacement(storage, { side: 'right', position: { x: 10, y: 90, secret: 'no' }, consent: true, source: 'no', task: 'no', question: 'no' });
  assert.deepEqual(JSON.parse(storage.getItem(VEY_PLACEMENT_KEY)), { version: 1, side: 'right', position: { x: 10, y: 90 } });
});
