// Hand-off between the Instruments page and Studio. Held in memory for live updates and written
// through to a storage adapter (IndexedDB in the browser) so it survives a reload.
import { deleteSavedTake, listSavedTakes, putSavedTake } from './instrumentTakeDb.js';

export const MAX_SHELF_TAKES = 8;
const STORE = 'shelf';
const EMPTY = Object.freeze([]);

let items = EMPTY;
let hydrated = false;
let storage = { list: () => listSavedTakes(STORE), put: (item) => putSavedTake(STORE, item), remove: (id) => deleteSavedTake(STORE, id) };
const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener());

export function subscribeShelf(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getShelf = () => items;
export const getServerShelf = () => EMPTY;

/** Test seam: swap the storage adapter and reset state. */
export function configureShelfStorage(adapter) {
  storage = adapter;
  items = EMPTY;
  hydrated = false;
}

const valid = (row) => row && typeof row.id === 'string' && row.samples?.length > 0 && row.sampleRate > 0;
const freeze = (row) => Object.freeze({
  id: row.id,
  label: String(row.label || 'Instrument take').slice(0, 80),
  samples: row.samples,
  sampleRate: row.sampleRate,
  seconds: row.samples.length / row.sampleRate,
  createdAt: row.createdAt || Date.now(),
});

/** Load saved shelf takes once; takes added before it finishes are kept. */
export async function hydrateShelf() {
  if (hydrated) return;
  hydrated = true;
  const rows = (await storage.list()).filter(valid).map(freeze);
  const known = new Set(items.map((item) => item.id));
  items = [...items, ...rows.filter((row) => !known.has(row.id))].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_SHELF_TAKES);
  emit();
}

/** @param {{ label: string, samples: Float32Array, sampleRate: number }} take */
export function addShelfTake(take) {
  if (!take?.samples?.length || !(take.sampleRate > 0)) return null;
  const item = freeze({ ...take, id: globalThis.crypto?.randomUUID?.() || `shelf-${Date.now()}-${items.length}`, createdAt: Date.now() });
  const next = [item, ...items];
  const dropped = next.slice(MAX_SHELF_TAKES);
  items = next.slice(0, MAX_SHELF_TAKES);
  storage.put({ ...item });
  dropped.forEach((row) => storage.remove(row.id));
  emit();
  return item;
}

export function removeShelfTake(id) {
  items = items.filter((item) => item.id !== id);
  storage.remove(id);
  emit();
}
