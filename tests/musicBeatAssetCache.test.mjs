import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { audioDoc, audioRegion } from './musicBeatAudioFixtures.mjs';
import { estimateExport } from '../app/veyrnox/_lib/music/beat/beatAudioRules.mjs';
import { exportSize } from '../app/veyrnox/_lib/music/beat/beatSequence.mjs';

// Virtual AudioBuffers report real PCM capacity without allocating hundreds of MB.
// Small channel arrays still exercise the production reversal loop and its output.
globalThis.window = new EventTarget();
const originals = new Map(), loads = new Map();
let beforeReverse = async () => {};
globalThis.beatCacheFixture = {
  cancelSongLoads() {},
  decodes: { acquire: async () => { await beforeReverse(); return () => {}; } },
  offline: () => ({ createBuffer: (numberOfChannels, length, sampleRate) => {
    const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(4));
    return { numberOfChannels, length, sampleRate, getChannelData: (c) => channels[c] };
  } }),
  loadSong: async (asset) => {
    loads.set(asset.ref.jobId, (loads.get(asset.ref.jobId) || 0) + 1);
    const buffer = globalThis.beatCacheFixture.offline().createBuffer(asset.sourceChannels, asset.durationSec * 48000, 48000);
    for (let c = 0; c < buffer.numberOfChannels; c++) buffer.getChannelData(c).set([1, 2, 3, 4]);
    originals.set(asset.ref.jobId, buffer);
    return { asset, buffer };
  },
};
const hooks = registerHooks({ load(url, context, next) {
  if (url.endsWith('/beatSongAsset.js')) return { format: 'module', shortCircuit: true,
    source: 'export const { offline, decodes, loadSong, cancelSongLoads } = globalThis.beatCacheFixture;' };
  return next(url, context);
} });
const assets = await import('../app/veyrnox/_lib/music/beat/beatAssets.js');
const { loadSongBuffers } = await import('../app/veyrnox/_lib/music/beat/beatMixdown.js');
hooks.deregister();
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const doc = audioDoc(), region = audioRegion(doc); doc.view = 'song';
  doc.assets = {};
  doc.tracks[0].regions = [];
  doc.tracks[1].regions = Array.from({ length: 6 }, (_, i) => {
    doc.assets[`a${i}`] = { source: 'song', ref: { songId: uuid(i), versionId: uuid(i + 10), jobId: uuid(i + 20) },
      name: `Song ${i}`, durationSec: 100, sourceChannels: 2, encodedBytes: 100, bpm: null };
    return { ...region, id: `r${i}`, assetId: `a${i}`, start: i * 240, length: 240, reverse: i % 2 === 0 };
  });
  return doc;
}
test('export keeps exact forward/reverse pairs after exceeding the 300 MB live LRU', async () => {
  const doc = fixture();
  assert.ok(estimateExport(doc, exportSize(doc).frames) < 600000000);
  assets.clearBeatAssets(); loads.clear();
  const buffers = await loadSongBuffers(doc);
  let evicted = 0;
  for (const [id, asset] of Object.entries(doc.assets)) {
    const loaded = buffers.get(id);
    assert.equal(loaded.missing, false);
    assert.equal(loads.get(asset.ref.jobId), 1, 'one fetch/decode per used asset');
    assert.equal(loaded.buffer, originals.get(asset.ref.jobId));
    if (doc.tracks[1].regions.find((r) => r.assetId === id).reverse)
      assert.deepEqual([...loaded.reverse.getChannelData(0)], [4, 3, 2, 1]);
    if (!assets.cachedAsset(asset, doc.tempo.bpm)) evicted++;
  }
  assert.ok(evicted > 0, 'fixture must exceed the actual 300 MB cache');
});
test('a concurrent forward request shares its entry with reverse even when evicted while reversal waits', async () => {
  assets.clearBeatAssets(); loads.clear();
  const doc = fixture(), first = doc.assets.a0;
  const forward = assets.loadAsset(first, 60);
  let resume, entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  beforeReverse = async () => { entered(); await new Promise((resolve) => { resume = resolve; }); };
  const pair = assets.loadAssetBuffers(first, 60, true);
  const buffer = await forward; await waiting;
  beforeReverse = async () => {};
  for (const asset of Object.values(doc.assets).slice(1)) await assets.loadAssetBuffers(asset, 60, true);
  assert.equal(assets.cachedAsset(first, 60), null, 'forward entry was evicted during reversal');
  resume();
  const loaded = await pair;
  assert.equal(loaded.buffer, buffer);
  assert.equal(loads.get(first.ref.jobId), 1);
  assert.deepEqual([...loaded.reversed.getChannelData(0)], [4, 3, 2, 1]);
  assets.clearBeatAssets();
});


test('pagehide cancels retention of late work and bfcache restoration allows a fresh load', async () => {
  assets.clearBeatAssets();
  const asset = fixture().assets.a0;
  let resume, entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  beforeReverse = async () => { entered(); await new Promise((resolve) => { resume = resolve; }); };
  const old = assets.loadAssetBuffers(asset, 60, true);
  await waiting;
  window.dispatchEvent(new Event('pagehide'));
  const paused = assets.assetState(asset, 60);
  assert.equal(await assets.loadAsset(asset, 60), null);
  resume(); assert.equal(await old, null);
  assert.equal(assets.cachedAsset(asset, 60), null);
  window.dispatchEvent(new Event('pageshow'));
  assert.notEqual(assets.assetState(asset, 60), paused, 'restoration notifies waveform subscribers');
  beforeReverse = async () => {};
  assert.ok(await assets.loadAsset(asset, 60));
  assert.equal(assets.assetState(asset, 60).status, 'ready');
  assets.clearBeatAssets();
});
