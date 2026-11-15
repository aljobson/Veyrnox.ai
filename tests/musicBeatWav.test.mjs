import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWavChannels } from '../app/veyrnox/_lib/music/beat/beatWav.mjs';

test('stereo WAV writes RIFF, PCM header, interleaving and clips both polarities', () => {
  const result = encodeWavChannels([new Float32Array([0, -1, 2]), new Float32Array([1, -2, 0.5])], 44100);
  const view = new DataView(result);
  assert.equal(new TextDecoder().decode(new Uint8Array(result, 0, 4)), 'RIFF');
  assert.equal(new TextDecoder().decode(new Uint8Array(result, 8, 4)), 'WAVE');
  assert.equal(view.getUint32(4, true), result.byteLength - 8);
  assert.equal(view.getUint16(20, true), 1); assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 44100); assert.equal(view.getUint32(28, true), 176400);
  assert.equal(view.getUint16(32, true), 4); assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 12);
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => view.getInt16(44 + i * 2, true)), [0, 32767, -32768, -32768, 32767, 16383]);
});
test('WAV rejects mismatched channels and bad sample rates before encoding', () => {
  assert.throws(() => encodeWavChannels([new Float32Array(1), new Float32Array(2)], 44100), RangeError);
  assert.throws(() => encodeWavChannels([], 44100), RangeError);
  assert.throws(() => encodeWavChannels([new Float32Array(1)], 0), RangeError);
});
