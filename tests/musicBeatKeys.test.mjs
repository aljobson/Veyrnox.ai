import test from 'node:test';
import assert from 'node:assert/strict';
import { routeBeatKey, TYPING_NOTES } from '../app/veyrnox/_lib/music/beat/beatKeys.mjs';
test('one router directs pads or all seventeen musical typing keys by track kind', () => {
  assert.deepEqual(routeBeatKey({ key: 'a', kind: 'drums' }), { type: 'pad', pad: 'kick' });
  for (const [key, pitch] of Object.entries(TYPING_NOTES)) assert.deepEqual(routeBeatKey({ key, kind: 'midi', octave: -1, velocity: 80 }), { type: 'note', pitch: pitch - 12, velocity: 80 });
  assert.equal(routeBeatKey({ key: 'a', kind: 'audio' }), null);
});
test('repeat, text fields and commands are ignored; octave and velocity are bounded', () => {
  for (const flag of ['repeat', 'textInput', 'command']) assert.equal(routeBeatKey({ key: 'a', kind: 'midi', [flag]: true }), null);
  for (const [key, type, value] of [['z', 'octave', -1], ['x', 'octave', 1], ['c', 'velocity', 84], ['v', 'velocity', 116]]) assert.deepEqual(routeBeatKey({ key, kind: 'midi' }), { type, value });
  assert.equal(routeBeatKey({ key: 'z', kind: 'midi', octave: -3 }).value, -3);
  assert.equal(routeBeatKey({ key: 'v', kind: 'midi', velocity: 127 }).value, 127);
});
