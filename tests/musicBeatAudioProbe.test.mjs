import test from 'node:test';
import assert from 'node:assert/strict';
import { probeAudioHeader, admitProbe } from '../app/veyrnox/_lib/music/beat/beatAudioProbe.mjs';
import { mp3FrameCounter } from '../lib/mediaLength.js';
import { admitScan, admitDecode, checkDecoded, estimateExport, reservationPool, pcmBytes, MB } from '../app/veyrnox/_lib/music/beat/beatAudioRules.mjs';
import { audioDoc, takeAsset } from './musicBeatAudioFixtures.mjs';
const text = (b, at, s) => b.set(new TextEncoder().encode(s), at);
function wav(channels) {
  const b = new Uint8Array(44), v = new DataView(b.buffer); text(b, 0, 'RIFF'); text(b, 8, 'WAVE'); text(b, 12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true); v.setUint32(24, 44100, true);
  v.setUint16(32, channels * 2, true); text(b, 36, 'data'); v.setUint32(40, 44100 * channels * 2 * 10, true); return b;
}
function flac(samples = 480000) {
  const b = new Uint8Array(42); text(b, 0, 'fLaC'); b[7] = 34;
  b[18] = 48000 >> 12; b[19] = (48000 >> 4) & 255; b[20] = ((48000 & 15) << 4) | 2;
  new DataView(b.buffer).setUint32(22, samples); return b;
}
function mp3(count = 400, hint = null, variable = false) {
  const frames = [];
  for (let i = 0; i < count; i++) {
    const high = !variable || i === 0, frame = new Uint8Array(high ? 1044 : 104);
    frame.set([255, 251, high ? 224 : 16, 0]);
    if (i === 0 && hint !== null) { text(frame, 36, 'Xing'); const v = new DataView(frame.buffer); v.setUint32(40, 1); v.setUint32(44, hint); }
    frames.push(frame);
  }
  const b = new Uint8Array(frames.reduce((n, f) => n + f.length, 0)); let at = 0;
  for (const frame of frames) { b.set(frame, at); at += frame.length; } return b;
}
function measured(bytes) {
  const counter = mp3FrameCounter();
  for (let i = 0; i < bytes.length; i += 777) assert.equal(counter.push(bytes.subarray(i, i + 777)), true);
  return counter.end();
}
test('WAV mono/stereo and FLAC durations are exact; six channels, unknown FLAC and Ogg are refused', () => {
  for (const channels of [1, 2, 6]) {
    const bytes = wav(channels), info = probeAudioHeader(bytes, 44 + 44100 * channels * 20);
    assert.deepEqual(info, { container: 'wav', channels, sampleRate: 44100, durationSec: 10 });
    if (channels === 6) assert.throws(() => admitProbe(info), /6 channels/); else admitProbe(info);
  }
  assert.equal(probeAudioHeader(flac(), 1000).durationSec, 10);
  assert.throws(() => admitProbe(probeAudioHeader(flac(0), 1000)), /unknown/);
  const ogg = new Uint8Array(64); text(ogg, 0, 'OggS'); text(ogg, 28, 'OpusHead');
  assert.throws(() => admitProbe(probeAudioHeader(ogg, 64)), /Unsupported audio format \(Ogg\)/);
  assert.throws(() => admitProbe(probeAudioHeader(new Uint8Array(100), 100)), /Unsupported audio format/);
});
test('CBR, Xing and VBR without Xing always get measured frame duration', () => {
  for (const bytes of [mp3(), mp3(400, 400), mp3(400, null, true)]) {
    const info = probeAudioHeader(bytes.subarray(0, 65536), bytes.length); admitProbe(info);
    assert.equal(info.container, 'mp3'); assert.equal(info.durationSec, null);
    const durationSec = measured(bytes); assert.ok(Math.abs(durationSec - 400 * 1152 / 44100) < 1e-8);
    admitScan(bytes.length); admitDecode({ durationSec, sourceChannels: 2, encodedBytes: bytes.length });
  }
});
test('understated Xing cannot admit twenty minutes, and bad exact duration fails only after admission', () => {
  const bytes = mp3(46000, 383, true), info = probeAudioHeader(bytes, bytes.length);
  assert.ok(info.hintDurationSec < 11); admitScan(bytes.length);
  assert.throws(() => admitDecode({ durationSec: measured(bytes), sourceChannels: 2, encodedBytes: bytes.length }), /600 seconds/);
  const metadata = { durationSec: 10, sourceChannels: 2, encodedBytes: 1000 }; admitDecode(metadata);
  assert.throws(() => checkDecoded({ numberOfChannels: 2, sampleRate: 48000, length: 11 * 48000 }, metadata), /changed size/);
  checkDecoded({ numberOfChannels: 2, sampleRate: 48000, length: 480000 }, metadata);
  assert.throws(() => checkDecoded({ numberOfChannels: 1, sampleRate: 48000, length: 480000 }, metadata), /changed size/);
});
test('budgets use 48 kHz, include reverse/output/WAV/two reserves, and refuse invalid cold metadata', () => {
  const asset = takeAsset(10); assert.equal(pcmBytes(asset), 10 * 48000 * 4);
  const doc = audioDoc(asset); const base = estimateExport(doc, 441000);
  assert.equal(base, pcmBytes(asset) * 3 + 441000 * 12 + 44);
  doc.tracks[1].regions[0].reverse = true; assert.equal(estimateExport(doc, 441000), base + pcmBytes(asset));
  assert.throws(() => estimateExport(doc, 60000000), /too much audio to export/);
  delete doc.assets.a1.sourceChannels; assert.throws(() => estimateExport(doc, 441000), /metadata/);
  assert.throws(() => admitDecode({ durationSec: 600, sourceChannels: 2, encodedBytes: 1000 }), /300 MB/);
  assert.throws(() => admitScan(120 * MB + 1), /120 MB/);
});
test('concurrent scan/decode pools never exceed either reservation total or two jobs', async () => {
  for (const [limit, size] of [[240 * MB, 120 * MB], [600 * MB, 300 * MB]]) {
    const pool = reservationPool(2, limit), releaseA = await pool.acquire(size), releaseB = await pool.acquire(size);
    let third = false; const waiting = pool.acquire(size).then((release) => { third = true; return release; });
    await Promise.resolve(); assert.equal(third, false); assert.deepEqual(pool.usage, { count: 2, bytes: limit });
    releaseA(); const releaseC = await waiting; assert.deepEqual(pool.usage, { count: 2, bytes: limit });
    releaseB(); releaseC(); assert.deepEqual(pool.usage, { count: 0, bytes: 0 });
  }
});
