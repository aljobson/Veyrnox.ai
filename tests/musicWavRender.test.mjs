import test from 'node:test';
import assert from 'node:assert/strict';
import { wavSeconds } from '../lib/mediaLength.js';
import { renderPcmWavCrop, renderPcmWavFade, renderPcmWavRemaster, renderPcmWavReorder, renderPcmWavSpeed } from '../lib/musicWavRender.js';

function pcmWav({ seconds = 4, sampleRate = 8000, channels = 1, bits = 16, format = 1 } = {}) {
  const blockAlign = channels * (bits / 8);
  const frames = seconds * sampleRate;
  const out = Buffer.alloc(44 + frames * blockAlign);
  out.write('RIFF', 0); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(format, 20); out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(sampleRate, 24); out.writeUInt32LE(sampleRate * blockAlign, 28);
  out.writeUInt16LE(blockAlign, 32); out.writeUInt16LE(bits, 34); out.write('data', 36);
  out.writeUInt32LE(frames * blockAlign, 40);
  for (let index = 44; index < out.length; index += 1) out[index] = index % 251;
  return out;
}

test('PCM WAV crop writes a standalone measured master with exact selected frames', () => {
  const source = pcmWav();
  const result = renderPcmWavCrop(source, 1.25, 2.75);
  assert.equal(result.ok, true);
  assert.equal(result.seconds, 1.5);
  assert.equal(wavSeconds(result.bytes, result.bytes.length), 1.5);
  assert.equal(Buffer.from(result.bytes.subarray(44)).equals(source.subarray(44 + 10_000 * 2, 44 + 22_000 * 2)), true);
  assert.equal(source.readUInt32LE(4), source.length - 8);
});

test('WAV renderer fails closed on compressed, ambiguous and out-of-range input', () => {
  assert.equal(renderPcmWavCrop(pcmWav({ format: 3 }), 0, 2).error, 'wav_format_unsupported');
  assert.equal(renderPcmWavCrop(pcmWav(), 3, 5).error, 'crop_range_invalid');
  assert.equal(renderPcmWavCrop(new Uint8Array([1, 2, 3]), 0, 2).error, 'wav_invalid');
  const ambiguous = pcmWav();
  ambiguous.write('fmt ', 36);
  assert.equal(renderPcmWavCrop(ambiguous, 0, 2).error, 'wav_invalid');
});

test('PCM WAV fade renders full-length linear envelopes without changing the source', () => {
  const source = pcmWav({ seconds: 2, sampleRate: 4 });
  for (let offset = 44; offset < source.length; offset += 2) source.writeInt16LE(10_000, offset);
  const result = renderPcmWavFade(source, 1, 0.5);
  assert.equal(result.ok, true);
  assert.equal(wavSeconds(result.bytes, result.bytes.length), 2);
  const samples = Array.from({ length: 8 }, (_, index) => Buffer.from(result.bytes).readInt16LE(44 + index * 2));
  assert.deepEqual(samples, [0, 2500, 5000, 7500, 10000, 10000, 5000, 0]);
  assert.equal(source.readInt16LE(44), 10_000);
});

test('PCM WAV speed changes duration with interpolated frames and refuses unsafe ratios', () => {
  const source = pcmWav({ seconds: 2, sampleRate: 8 });
  for (let index = 0; index < 16; index += 1) source.writeInt16LE(index * 100, 44 + index * 2);
  const faster = renderPcmWavSpeed(source, 2);
  assert.equal(faster.ok, true);
  assert.equal(wavSeconds(faster.bytes, faster.bytes.length), 1);
  assert.deepEqual(Array.from({ length: 4 }, (_, index) => Buffer.from(faster.bytes).readInt16LE(44 + index * 2)), [0, 200, 400, 600]);
  const slower = renderPcmWavSpeed(source, 0.5);
  assert.equal(slower.ok, true);
  assert.equal(wavSeconds(slower.bytes, slower.bytes.length), 4);
  assert.equal(Buffer.from(slower.bytes).readInt16LE(46), 50);
  assert.equal(renderPcmWavSpeed(source, 0.49).error, 'speed_ratio_invalid');
  assert.equal(renderPcmWavSpeed(source, 1).error, 'speed_ratio_invalid');
  assert.equal(renderPcmWavFade(source, 1.5, 1).error, 'fade_range_invalid');
});

test('PCM WAV reorder swaps two exact sections without changing duration or source bytes', () => {
  const source = pcmWav({ seconds: 4, sampleRate: 4 });
  for (let index = 0; index < 16; index += 1) source.writeInt16LE(index, 44 + index * 2);
  const before = Buffer.from(source);
  const result = renderPcmWavReorder(source, 1.5, [2, 1]);
  assert.equal(result.ok, true);
  assert.equal(wavSeconds(result.bytes, result.bytes.length), 4);
  assert.deepEqual(Array.from({ length: 16 }, (_, index) => Buffer.from(result.bytes).readInt16LE(44 + index * 2)),
    [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1, 2, 3, 4, 5]);
  assert.equal(Buffer.from(source).equals(before), true);
  assert.equal(renderPcmWavReorder(source, 0.5, [2, 1]).error, 'reorder_range_invalid');
  assert.equal(renderPcmWavReorder(source, 2, [1, 2]).error, 'reorder_range_invalid');
});

test('PCM WAV remaster removes per-channel DC bias and applies one bounded linked gain', () => {
  const source = pcmWav({ seconds: 1, sampleRate: 4, channels: 2 });
  const samples = [[1000, 4000], [3000, 2000], [1000, 0], [-1000, -2000]];
  samples.forEach((frame, frameIndex) => frame.forEach((sample, channel) => {
    source.writeInt16LE(sample, 44 + (frameIndex * 2 + channel) * 2);
  }));
  const before = Buffer.from(source);
  const result = renderPcmWavRemaster(source, -2);
  assert.equal(result.ok, true);
  assert.equal(result.seconds, 1);
  assert.deepEqual(result.dcOffsets, [1000, 1000]);
  assert.ok(Math.abs(result.inputPeakDbfs - (20 * Math.log10(3000 / 32767))) < 0.000001);
  const output = Buffer.from(result.bytes);
  const outputSamples = Array.from({ length: 8 }, (_, index) => output.readInt16LE(44 + index * 2));
  assert.ok(Math.abs(Math.max(...outputSamples.map(Math.abs)) - Math.round(32767 * (10 ** (-2 / 20)))) <= 1);
  assert.deepEqual([
    outputSamples.filter((_, index) => index % 2 === 0).reduce((sum, value) => sum + value, 0),
    outputSamples.filter((_, index) => index % 2 === 1).reduce((sum, value) => sum + value, 0),
  ], [0, 0]);
  assert.equal(Buffer.from(source).equals(before), true);
  assert.equal(renderPcmWavRemaster(source, -0.5).error, 'remaster_target_invalid');
  const silence = pcmWav({ seconds: 1, sampleRate: 4 });
  for (let offset = 44; offset < silence.length; offset += 2) silence.writeInt16LE(1000, offset);
  assert.equal(renderPcmWavRemaster(silence, -2).error, 'remaster_silence');
});
