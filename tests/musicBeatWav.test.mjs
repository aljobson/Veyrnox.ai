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

test('16-bit bytes match the pre-phase-6 golden, including truncation and NaN', () => {
  const bytes = encodeWavChannels([new Float32Array([-1, 0, 1, NaN, 0.5, -0.5])], 44100);
  assert.equal(Buffer.from(bytes).toString('hex'), '524946463000000057415645666d7420100000000100010044ac00008858010002001000646174610c00000000800000ff7f0000ff3f00c0');
});
test('24-bit PCM packs signed samples and pads odd mono data', () => {
  const values = new Float32Array([-1, 0, 1, NaN, -2, 2, 0.5]);
  const result = encodeWavChannels([values], 48000, 24), v = new DataView(result);
  assert.equal(v.getUint16(34, true), 24); assert.equal(v.getUint16(32, true), 3);
  assert.equal(v.getUint32(28, true), 144000); assert.equal(v.getUint32(40, true), 21);
  assert.equal(result.byteLength, 66);
  assert.equal(Buffer.from(result).subarray(44, 65).toString('hex'), '000080000000ffff7f000000000080ffff7fffff3f');
});
test('window writes produce the same bytes as one-shot for both bit depths', async () => {
  const { createWavWriter } = await import('../app/veyrnox/_lib/music/beat/beatWav.mjs');
  const channels = [Float32Array.from([-1, 0.2, NaN, 1]), Float32Array.from([1, -0.3, 0, -1])];
  for (const bitDepth of [16, 24]) {
    const writer = createWavWriter({ channels: 2, sampleRate: 48000, bitDepth, frames: 4 });
    writer.write(channels.map(c => c.subarray(0, 1)), 0); writer.write(channels.map(c => c.subarray(1)), 1);
    assert.deepEqual(writer.finish(), encodeWavChannels(channels, 48000, bitDepth));
    assert.throws(() => writer.write(channels, 1), RangeError);
  }
});
