import { listSavedTakes, putSavedTake } from '../instrumentTakeDb.js';
export const BEAT_TAKE_BYTES = 1000000000;
let rows = new Map(), hydrated;
let storage = { list: () => listSavedTakes('beatTakes'), put: row => putSavedTake('beatTakes', row) };
const listeners = new Set();
export const subscribeBeatTakes = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => fn());
export const getBeatTake = id => rows.get(id) || null;
export const beatTakes = () => [...rows.values()];
export const beatTakeBytes = () => beatTakes().reduce((n, r) => n + r.samples.byteLength, 0);
export function configureBeatTakeStorage(adapter) { storage = adapter; rows = new Map(); hydrated = null; }
export function hydrateBeatTakes() {
  return hydrated ||= storage.list().then(items => {
    for (const row of items) if (row?.samples?.length && row.sampleRate > 0 && !rows.has(row.id)) rows.set(row.id, row);
    emit();
  }).catch(error => { hydrated = null; throw error; });
}
let writes = Promise.resolve();
export function putBeatTake(row) {
  const work = writes.catch(() => {}).then(async () => {
    await hydrateBeatTakes();
    if (!(row.samples instanceof Float32Array) || !row.samples.length || !(row.sampleRate > 0)) throw new Error('The recorded take has no audio.');
    if (beatTakeBytes() - (rows.get(row.id)?.samples.byteLength || 0) + row.samples.byteLength > BEAT_TAKE_BYTES) throw new Error('Recorded takes use 1 GB on this device. Free storage before recording.');
    if (!await storage.put(row)) throw new Error('Could not save recorded audio on this device. Keep this page open and try again.');
    rows.set(row.id, row); emit(); return row;
  });
  writes = work; return work;
}
export function documentHasTake(doc, row) {
  return doc?.id === row.beatId && Object.values(doc.assets || {}).some(a => a.source === 'take' && a.ref === row.id);
}
export async function reconcileBeatTakes(saved, versions = []) {
  await hydrateBeatTakes();
  for (const row of beatTakes()) if (row.state === 'pending' && [saved, ...versions].some(doc => documentHasTake(doc, row))) await putBeatTake({ ...row, state: 'committed' });
}
export const pendingBeatTakes = beatId => beatTakes().filter(row => row.beatId === beatId && row.state === 'pending');
export async function discardBeatTakes(ids) {
  for (const id of ids) { const row = rows.get(id); if (row?.state === 'pending') await putBeatTake({ ...row, state: 'discarded' }); }
}
