import { getSavedTakeStrict, listSavedTakesInRange, listSavedTakesStrict, putSavedTake } from '../instrumentTakeDb.js';
export const BEAT_TAKE_BYTES = 1000000000;
// `meta` holds every take's small lifecycle row (no audio). Audio is loaded lazily per take
// into `audio` (review P9-002), so opening a beat never reads every recording on the device.
let meta = new Map(), audio = new Map(), partials = new Map(), hydrated;
let storage = {
  listState: () => listSavedTakesStrict('beatTakeState'), putState: (row, check) => putSavedTake('beatTakeState', row, check),
  get: id => getSavedTakeStrict('beatTakes', id), put: (row, check) => putSavedTake('beatTakes', row, check),
  listChunksFor: id => listSavedTakesInRange('beatTakeChunks', `${id}:`, `${id}:￿`), putChunk: (row, check) => putSavedTake('beatTakeChunks', row, check),
};
const listeners = new Set();
export const subscribeBeatTakes = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => fn());
const META_FIELDS = ['id', 'beatId', 'label', 'sampleRate', 'length', 'createdAt', 'state', 'pending'];
const metaOf = row => Object.fromEntries(META_FIELDS.filter(k => row[k] !== undefined).map(k => [k, k === 'length' ? row.length ?? row.samples.length : row[k]]));
/** Metadata plus samples when this take's audio is loaded. */
export function getBeatTake(id) {
  const m = meta.get(id);
  if (!m) return null;
  return audio.has(id) ? { ...m, samples: audio.get(id) } : { ...m };
}
export const beatTakes = () => [...meta.keys()].map(getBeatTake);
export const beatTakeBytes = () => [...meta.values()].reduce((n, m) => n + (m.length || 0) * 4, 0);
export function configureBeatTakeStorage(adapter) { storage = adapter; meta = new Map(); audio = new Map(); partials = new Map(); hydrated = null; }
export function hydrateBeatTakes() {
  return hydrated ||= Promise.resolve(storage.listState()).then(states => {
    for (const row of states || []) if (row?.id && row.sampleRate > 0 && row.length > 0 && !meta.has(row.id)) meta.set(row.id, metaOf(row));
    emit();
  }).catch(error => { hydrated = null; throw error; });
}
function assemble(chunks, length) {
  const samples = new Float32Array(length);
  for (const chunk of chunks) samples.set(chunk.samples.subarray(0, Math.max(0, length - chunk.offset)), chunk.offset);
  return samples;
}
/** Load one take's audio (a whole row, or its checkpoint chunks). Throws if the device store cannot be read. */
export async function loadBeatTake(id) {
  await hydrateBeatTakes();
  const m = meta.get(id);
  if (!m) return null;
  if (!audio.has(id)) {
    const row = await storage.get(id);
    if (row?.samples?.length) audio.set(id, row.samples.length === m.length ? row.samples : row.samples.subarray(0, m.length));
    else {
      const chunks = (await storage.listChunksFor(id)).filter(c => c?.takeId === id && c.samples?.length);
      if (!chunks.length) return null;
      audio.set(id, assemble(chunks, m.length));
    }
  }
  return getBeatTake(id);
}
let writes = Promise.resolve();
function write(work) { const result = writes.catch(() => {}).then(work); writes = result; return result; }
const saveError = () => new Error('Could not save recorded audio on this device. Keep this page open and try again.');
function checkSize(bytes) { if (bytes > BEAT_TAKE_BYTES) throw new Error('Recorded takes use 1 GB on this device. Free storage before recording.'); }
async function saveMeta(next, check = () => {}) {
  check();
  if (!await storage.putState(next, check)) throw saveError();
  meta.set(next.id, next);
}
export function appendBeatTake(row, offset, check = () => {}) {
  return write(async () => {
    await hydrateBeatTakes(); check();
    const old = meta.get(row.id)?.length || 0, length = Math.max(old, offset + row.samples.length);
    checkSize(beatTakeBytes() + (length - old) * 4);
    const { samples, ...rest } = row;
    if (!await storage.putChunk({ ...rest, samples, id: `${row.id}:${offset}`, takeId: row.id, offset }, check)) throw saveError();
    partials.set(row.id, Math.max(partials.get(row.id) || 0, offset + samples.length));
    audio.delete(row.id);
    await saveMeta(metaOf({ ...rest, length, state: meta.get(row.id)?.state ?? row.state }), check);
    return row;
  });
}
export function putBeatTake(row, check = () => {}) {
  return write(async () => {
    await hydrateBeatTakes(); check();
    if (!(row.samples instanceof Float32Array) || !row.samples.length || !(row.sampleRate > 0)) throw new Error('The recorded take has no audio.');
    const previous = meta.get(row.id)?.length || 0;
    checkSize(beatTakeBytes() - previous * 4 + row.samples.byteLength);
    // A checkpointed take already has a durable prefix. Only append its suffix,
    // even on commit retry; never rewrite the prefix.
    const durable = partials.get(row.id) ?? (meta.has(row.id) && !audio.has(row.id) ? previous : null);
    if (durable !== null && durable !== undefined) {
      if (row.samples.length > durable) {
        const { samples, ...rest } = row;
        if (!await storage.putChunk({ ...rest, samples: samples.slice(durable), id: `${row.id}:${durable}`, takeId: row.id, offset: durable }, check)) throw saveError();
        partials.set(row.id, row.samples.length);
      }
    } else if (!await storage.put(row, check)) throw saveError();
    await saveMeta(metaOf({ ...row, length: row.samples.length, state: meta.get(row.id)?.state ?? row.state }), check);
    audio.set(row.id, row.samples); emit(); return row;
  });
}
export function documentHasTake(doc, row) {
  return doc?.id === row.beatId && Object.values(doc.assets || {}).some(a => a.source === 'take' && a.ref === row.id);
}
// Lifecycle changes rewrite only the small metadata row, never audio.
async function setState(id, state) { await saveMeta({ ...meta.get(id), state }); }
/** Retire pending takes that the locally saved document references (by beat id and immutable take id). */
export async function reconcileBeatTakes(saved) {
  await hydrateBeatTakes();
  for (const row of [...meta.values()]) if (row.state === 'pending' && documentHasTake(saved, row)) await setState(row.id, 'committed');
}
/** Metadata of takes still awaiting recovery; load audio with loadBeatTake before committing. */
export const pendingBeatTakes = beatId => [...meta.values()].filter(row => row.beatId === beatId && row.state === 'pending').map(row => ({ ...row }));
export async function discardBeatTakes(ids) {
  if (!ids.length) return;
  await hydrateBeatTakes();
  for (const id of ids) if (meta.get(id)?.state === 'pending') await setState(id, 'discarded');
}
