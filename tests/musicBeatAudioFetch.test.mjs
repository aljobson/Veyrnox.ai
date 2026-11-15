import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAudioAsset, scans, decodes } from '../app/veyrnox/_lib/music/beat/beatAudioFetch.mjs';
const text = (b, at, value) => b.set(new TextEncoder().encode(value), at);
function mp3(count) {
  const bytes = new Uint8Array(count * 104), v = new DataView(bytes.buffer);
  for (let at = 0; at < bytes.length; at += 104) bytes.set([255, 251, 16, 0], at);
  text(bytes, 36, 'Xing'); v.setUint32(40, 1); v.setUint32(44, 1); // intentionally understated
  return bytes;
}
function network(bytes, ignoreRange = false) {
  const calls = [], reads = [], cancels = [];
  return { calls, reads, cancels, fetchAudio: async (url, options) => {
    const range = !!options.headers?.Range; calls.push({ url, range });
    let at = 0, read = 0;
    const source = range && !ignoreRange ? bytes.subarray(0, 65536) : bytes;
    return { ok: true, status: range && !ignoreRange ? 206 : 200,
      headers: new Headers(range && !ignoreRange ? { 'Content-Range': `bytes 0-${source.length - 1}/${bytes.length}` } : { 'Content-Length': String(bytes.length) }),
      body: { cancel: async () => { cancels.push({ range, at, read }); }, getReader: () => ({ read: async () => {
        assert.ok(scans.usage.count <= 2 && scans.usage.count > 0);
        read++; reads.push(range); if (at === source.length) return { done: true };
        const value = source.subarray(at, at + 32768); at += value.length; return { value, done: false };
      }, cancel: async () => { cancels.push({ range, at, read }); } }) } };
  } };
}
const base = { source: 'song', name: 'Version', bpm: null, ref: {} };
test('short MP3 uses measured frames before fixed-rate decode, including a cold reload', async () => {
  const bytes = mp3(400), net = network(bytes); let calls = 0;
  const decode = async () => { calls++; assert.equal(decodes.usage.count, 1); return { length: Math.round(400 * 1152 / 44100 * 48000), sampleRate: 48000, numberOfChannels: 2 }; };
  const first = await fetchAudioAsset('signed', base, null, { ...net, decode });
  assert.ok(first.asset.durationSec > 10); assert.equal(calls, 1);
  const cold = await fetchAudioAsset('fresh-signature', base, first.asset, { ...net, decode });
  assert.equal(calls, 2); assert.equal(cold.asset.durationSec, first.asset.durationSec);
  assert.deepEqual(scans.usage, { count: 0, bytes: 0 }); assert.deepEqual(decodes.usage, { count: 0, bytes: 0 });
});
test('a lying Xing header on a twenty minute MP3 is refused before decode', async () => {
  const bytes = mp3(46000), net = network(bytes); let decodes = 0;
  await assert.rejects(fetchAudioAsset('signed', base, null, { ...net, decode: async () => { decodes++; } }), /600 seconds/);
  assert.equal(decodes, 0); assert.equal(net.calls.length, 2);
});
test('ignored Range is bounded to 64 KiB, cancelled, and followed by a fresh full fetch', async () => {
  const bytes = mp3(1000), net = network(bytes, true);
  await fetchAudioAsset('signed', base, null, { ...net, decode: async () => ({ length: Math.round(1000 * 1152 / 44100 * 48000), sampleRate: 48000, numberOfChannels: 2 }) });
  assert.equal(net.cancels[0].at, 65536); assert.equal(net.calls.length, 2); assert.equal(net.calls[1].range, false);
});
test('missing cold metadata refuses before fetch; drift and decoder failures release reservations', async () => {
  const bytes = mp3(400), net = network(bytes);
  await assert.rejects(fetchAudioAsset('signed', base, {}, { ...net, decode: async () => {} }), /metadata/); assert.equal(net.calls.length, 0);
  await assert.rejects(fetchAudioAsset('signed', base, null, { ...net, decode: async () => ({ length: 99 * 48000, sampleRate: 48000, numberOfChannels: 2 }) }), /changed size/);
  await assert.rejects(fetchAudioAsset('signed', base, null, { ...net, decode: async () => { throw new Error('decoder failure'); } }), /decoder failure/);
  assert.deepEqual(scans.usage, { count: 0, bytes: 0 }); assert.deepEqual(decodes.usage, { count: 0, bytes: 0 });
});

test('cold encoded growth is refused before streaming beyond its recorded allocation', async () => {
  const bytes = mp3(400), net = network(bytes);
  const stored = { durationSec: 400 * 1152 / 44100, sourceChannels: 2, encodedBytes: bytes.length - 1 };
  let called = false;
  await assert.rejects(fetchAudioAsset('signed', base, stored, { ...net, decode: async () => { called = true; } }), /changed size/);
  assert.equal(called, false); assert.equal(net.reads.length, 0);
});
