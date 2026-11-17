import { listSavedTakesStrict, putSavedTake } from '../instrumentTakeDb.js';
export const BEAT_TAKE_BYTES = 1000000000;
let rows = new Map(), partials = new Map(), hydrated;
let storage = {
  list: () => listSavedTakesStrict('beatTakes'), put: row => putSavedTake('beatTakes', row),
  listState: () => listSavedTakesStrict('beatTakeState'), putState: row => putSavedTake('beatTakeState', row),
  listChunks: () => listSavedTakesStrict('beatTakeChunks'), putChunk: row => putSavedTake('beatTakeChunks', row),
};
const listeners = new Set();
export const subscribeBeatTakes = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => fn());
export function getBeatTake(id) {
  const partial = partials.get(id);
  if (!rows.has(id) && partial) {
    const samples = new Float32Array(partial.length);
    for (const chunk of partial.chunks) samples.set(chunk.samples, chunk.offset);
    rows.set(id, { ...partial.row, samples });
  }
  return rows.get(id) || null;
}
export const beatTakes = () => [...new Set([...rows.keys(), ...partials.keys()])].map(getBeatTake);
export const beatTakeBytes = () => [...rows].reduce((n, [id, row]) => n + (partials.has(id) ? 0 : row.samples.byteLength), 0)
  + [...partials.values()].reduce((n, part) => n + part.length * 4, 0);
export function configureBeatTakeStorage(adapter) { storage = adapter; rows = new Map(); partials = new Map(); hydrated = null; }
function rememberChunk(chunk) {
  const { takeId, offset, samples, ...metadata } = chunk;
  const old = partials.get(takeId);
  const chunks = (old?.chunks || []).filter(c => c.offset !== offset);
  chunks.push({ offset, samples });
  const length = Math.max(old?.length || 0, offset + samples.length);
  const row = !old || offset + samples.length >= old.length ? { ...metadata, id: takeId } : old.row;
  partials.set(takeId, { chunks, length, row }); rows.delete(takeId);
}
export function hydrateBeatTakes() {
  return hydrated ||= Promise.all([storage.list(), storage.listState?.() || [], storage.listChunks?.() || []]).then(([items, states, chunks]) => {
    for (const row of items) if (row?.samples?.length && row.sampleRate > 0 && !rows.has(row.id)) rows.set(row.id, row);
    for (const chunk of chunks) if (chunk?.samples?.length && chunk.sampleRate > 0) rememberChunk(chunk);
    for (const state of states) {
      if (rows.has(state.id)) rows.set(state.id, { ...rows.get(state.id), state: state.state });
      if (partials.has(state.id)) partials.get(state.id).row.state = state.state;
    }
    emit();
  }).catch(error => { hydrated = null; throw error; });
}
let writes = Promise.resolve();
function write(work) { const result = writes.catch(() => {}).then(work); writes = result; return result; }
const saveError = () => new Error('Could not save recorded audio on this device. Keep this page open and try again.');
function checkSize(bytes) { if (bytes > BEAT_TAKE_BYTES) throw new Error('Recorded takes use 1 GB on this device. Free storage before recording.'); }
async function append(row, offset) {
  const chunk = { ...row, id: `${row.id}:${offset}`, takeId: row.id, offset };
  if (!await storage.putChunk(chunk)) throw saveError();
  rememberChunk(chunk);
}
export function appendBeatTake(row, offset) {
  return write(async () => {
    await hydrateBeatTakes();
    const old = partials.get(row.id)?.length || 0;
    checkSize(beatTakeBytes() + Math.max(0, offset + row.samples.length - old) * 4);
    await append(row, offset); return row;
  });
}
export function putBeatTake(row) {
  return write(async () => {
    await hydrateBeatTakes();
    if (!(row.samples instanceof Float32Array) || !row.samples.length || !(row.sampleRate > 0)) throw new Error('The recorded take has no audio.');
    const previous = partials.get(row.id)?.length || rows.get(row.id)?.samples.length || 0;
    checkSize(beatTakeBytes() - previous * 4 + row.samples.byteLength);
    // A checkpointed take already has a durable prefix. Only append its suffix,
    // even on commit retry; assemble once at commit/recovery, never every 10 s.
    if (partials.has(row.id)) {
      if (row.samples.length > previous) await append({ ...row, samples: row.samples.slice(previous) }, previous);
    } else if (!await storage.put(row)) throw saveError();
    rows.set(row.id, row); emit(); return row;
  });
}
export function documentHasTake(doc, row) {
  return doc?.id === row.beatId && Object.values(doc.assets || {}).some(a => a.source === 'take' && a.ref === row.id);
}
async function setState(id, state) {
  if (!await storage.putState({ id, state })) throw saveError();
  if (rows.has(id)) rows.set(id, { ...rows.get(id), state });
  if (partials.has(id)) partials.get(id).row.state = state;
}
// Lifecycle reconciliation only examines metadata, never assembles or rewrites audio.
const metadata = () => [...new Map([...rows, ...[...partials].map(([id, p]) => [id, p.row])]).values()];
export async function reconcileBeatTakes(saved) {
  await hydrateBeatTakes();
  for (const row of metadata()) if (row.state === 'pending' && documentHasTake(saved, row)) await setState(row.id, 'committed');
}
export const pendingBeatTakes = beatId => metadata().filter(row => row.beatId === beatId && row.state === 'pending').map(row => getBeatTake(row.id));
export async function discardBeatTakes(ids) {
  if (!ids.length) return;
  await hydrateBeatTakes();
  for (const id of ids) {
    const row = partials.get(id)?.row || rows.get(id);
    if (row?.state === 'pending') await setState(id, 'discarded');
  }
}
