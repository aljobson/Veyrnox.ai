import { getShelf, hydrateShelf, subscribeShelf } from '../instrumentShelf.js';
import { makeNoise, playEvent } from '../instrumentEngine.js';
import { soundById, soundDuration } from './beatSounds.mjs';
import { AUDIO_RATE, MB, admitDecode, checkDecoded, validAsset } from './beatAudioRules.mjs';
import { offline, decodes, loadSong } from './beatSongAsset.js';
import { clearTransientFailures, permanentAssetFailure } from './beatAssetFailures.mjs';
export const yieldAudio = () => new Promise((resolve) => setTimeout(resolve, 0));
const cache = new Map(), pending = new Map(), states = new Map(), listeners = new Set();
let size = 0, activeTempo = null;
const emit = () => listeners.forEach((f) => f());
export const subscribeAssets = (f) => { listeners.add(f); return () => listeners.delete(f); };
export const assetKey = (asset, bpm) => JSON.stringify([asset.source, asset.ref, asset.durationSec, asset.sourceChannels, asset.encodedBytes, asset.source === 'sound' ? bpm : null]);
const bytes = (buffer) => buffer.length * buffer.numberOfChannels * 4;
function remove(key) { const entry = cache.get(key); if (entry) size -= entry.bytes; cache.delete(key); states.delete(key); }
function retain(key, entry) {
  remove(key);
  while (size + entry.bytes > 300 * MB && cache.size) remove(cache.keys().next().value);
  cache.set(key, entry); size += entry.bytes;
  states.set(key, { status: 'ready' }); emit();
}
export function clearBeatAssets() { cache.clear(); states.clear(); size = 0; emit(); }
export function retryBeatAssets(asset, bpm) {
  clearTransientFailures(states, asset ? assetKey(asset, bpm) : undefined); emit();
}
if (typeof window !== 'undefined') window.addEventListener('online', () => retryBeatAssets());
export function prepareExportCache(doc) {
  retryBeatAssets();
  const used = new Map();
  for (const track of doc.tracks) for (const region of track.regions) if (region.assetId) {
    const key = assetKey(doc.assets[region.assetId], doc.tempo.bpm);
    used.set(key, used.get(key) || region.reverse);
  }
  for (const [key, entry] of cache) {
    if (!used.has(key)) remove(key);
    else if (!used.get(key) && entry.reversed) {
      size -= bytes(entry.reversed); entry.bytes -= bytes(entry.reversed); delete entry.reversed;
    }
  }
}
export function syncAssetTempo(bpm) {
  if (bpm === activeTempo) return;
  activeTempo = bpm;
  for (const [key, entry] of cache) if (entry.source === 'sound' && entry.bpm !== bpm) remove(key);
  emit();
}
subscribeShelf(() => {
  const ids = new Set(getShelf().map((t) => t.id));
  for (const [key, entry] of cache) if (entry.source === 'take' && !ids.has(entry.ref)) {
    remove(key); states.set(key, { status: 'missing', reason: 'This take was deleted', permanent: true });
  }
  emit();
});
const idle = Object.freeze({ status: 'loading' });
export const assetState = (asset, bpm) => states.get(assetKey(asset, bpm)) || idle;
export function cachedAsset(asset, bpm, reverse = false) {
  const key = assetKey(asset, bpm), entry = cache.get(key);
  if (!entry) return null;
  cache.delete(key); cache.set(key, entry);
  return reverse ? entry.reversed : entry.buffer;
}
export async function renderSound(ref, bpm) {
  const sound = soundById(ref);
  if (!sound) throw new Error('Starter sound is unavailable');
  const context = offline(2, Math.round(soundDuration(ref, bpm) * AUDIO_RATE));
  const out = context.createGain(); out.gain.value = 0.65;
  if (sound.category === 'FX') {
    const sweep = context.createBiquadFilter(); sweep.type = 'lowpass';
    sweep.frequency.setValueAtTime(150, 0);
    sweep.frequency.exponentialRampToValueAtTime(8000, soundDuration(ref, bpm));
    out.connect(sweep).connect(context.destination);
  } else out.connect(context.destination);
  const noise = makeNoise(context);
  for (const [beat, length, value, vel] of sound.notes) playEvent(context, out, noise, sound.instrument, sound.preset,
    { value, vel, dur: length * 60 / bpm }, beat * 60 / bpm);
  return context.startRendering();
}
async function takeBuffer(asset) {
  await hydrateShelf();
  const take = getShelf().find((t) => t.id === asset.ref);
  if (!take) throw new Error('This take was deleted');
  if (Math.abs(take.seconds - asset.durationSec) > asset.durationSec * 0.02) throw new Error('This sound changed size since it was added');
  const context = offline(1, Math.round(asset.durationSec * AUDIO_RATE));
  const input = context.createBuffer(1, take.samples.length, take.sampleRate); input.copyToChannel(take.samples, 0);
  const source = context.createBufferSource(); source.buffer = input; source.connect(context.destination); source.start();
  return context.startRendering();
}
export async function prepareAsset(item, bpm) {
  if (!item || !['song', 'sound', 'take'].includes(item.source) || typeof item.name !== 'string' || !item.name.trim()) throw new Error('Invalid sound.');
  let asset = { source: item.source, ref: item.ref, name: item.name.slice(0, 80), bpm: item.bpm || null };
  if (item.source === 'song') {
    if (!validAsset({ ...asset, durationSec: 1, sourceChannels: 2, encodedBytes: 0 }, bpm)) throw new Error('This song version is no longer available');
    const loaded = await loadSong(asset); asset = loaded.asset;
    retain(assetKey(asset, bpm), { ...loaded, ...asset, bpm, bytes: bytes(loaded.buffer) });
    return asset;
  }
  asset = { ...asset, durationSec: item.source === 'sound' ? soundDuration(item.ref, bpm) : item.durationSec,
    sourceChannels: item.source === 'sound' ? 2 : 1, encodedBytes: 0 };
  if (!validAsset(asset, bpm)) throw new Error('Invalid sound metadata.');
  admitDecode(asset);
  const buffer = await loadAsset(asset, bpm);
  if (!buffer) throw new Error(assetState(asset, bpm).reason);
  return asset;
}
export async function loadAsset(asset, bpm, reverse = false) {
  const key = assetKey(asset, bpm);
  let buffer = cachedAsset(asset, bpm, reverse);
  if (buffer) return buffer;
  if (pending.has(key)) { await pending.get(key); return loadAsset(asset, bpm, reverse); }
  if (states.get(key)?.status === 'missing') return null;
  const work = (async () => {
    try {
      const reserve = admitDecode(asset);
      let entry = cache.get(key);
      if (!entry) {
        states.set(key, idle); emit();
        if (asset.source === 'song') buffer = (await loadSong(asset, asset)).buffer;
        else {
          const release = await decodes.acquire(reserve);
          try { buffer = asset.source === 'sound' ? await renderSound(asset.ref, bpm) : await takeBuffer(asset); }
          finally { release(); }
        }
        checkDecoded(buffer, asset);
        entry = { buffer, source: asset.source, ref: asset.ref, bpm, bytes: bytes(buffer) };
      }
      if (reverse && !entry.reversed) {
        const release = await decodes.acquire(bytes(entry.buffer) * 2);
        try {
          const context = offline();
          const reversed = context.createBuffer(entry.buffer.numberOfChannels, entry.buffer.length, AUDIO_RATE);
          for (let c = 0; c < reversed.numberOfChannels; c++) {
            const from = entry.buffer.getChannelData(c), to = reversed.getChannelData(c);
            for (let at = 0; at < to.length; at++) { to[at] = from[from.length - 1 - at]; if (at % 262144 === 262143) await yieldAudio(); }
          }
          entry = { ...entry, reversed, bytes: bytes(entry.buffer) * 2 };
        } finally { release(); }
      }
      // Old tempo renders may finish after the project has already changed tempo.
      if (asset.source !== 'sound' || activeTempo === null || activeTempo === bpm) retain(key, entry);
      return reverse ? entry.reversed : entry.buffer;
    } catch (error) { states.set(key, { status: 'missing', reason: error.message, permanent: permanentAssetFailure(error) }); emit(); return null; }
  })();
  pending.set(key, work);
  try { return await work; } finally { pending.delete(key); }
}
const peakCache = new WeakMap();
export async function audioPeaks(buffer) {
  if (peakCache.has(buffer)) return peakCache.get(buffer);
  const work = (async () => {
    const peaks = new Float32Array(1024), stride = Math.max(1, Math.ceil(buffer.length / peaks.length));
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) {
        const index = Math.floor(i / stride); peaks[index] = Math.max(peaks[index], Math.abs(data[i]));
        if (i % 262144 === 262143) await yieldAudio();
      }
    }
    return peaks;
  })();
  peakCache.set(buffer, work); return work;
}
