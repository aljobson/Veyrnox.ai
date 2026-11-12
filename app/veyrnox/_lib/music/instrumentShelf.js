// In-memory hand-off between the Instruments page and Studio. It survives in-app navigation
// (same tab, same JS session) and is gone on reload; nothing is uploaded or persisted.

export const MAX_SHELF_TAKES = 8;

let items = [];
const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener());

export function subscribeShelf(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getShelf = () => items;
export const getServerShelf = () => EMPTY;
const EMPTY = Object.freeze([]);

/** @param {{ label: string, samples: Float32Array, sampleRate: number }} take */
export function addShelfTake(take) {
  if (!take?.samples?.length || !(take.sampleRate > 0)) return null;
  const item = Object.freeze({
    id: globalThis.crypto?.randomUUID?.() || `shelf-${Date.now()}-${items.length}`,
    label: String(take.label || 'Instrument take').slice(0, 80),
    samples: take.samples,
    sampleRate: take.sampleRate,
    seconds: take.samples.length / take.sampleRate,
  });
  items = [item, ...items].slice(0, MAX_SHELF_TAKES);
  emit();
  return item;
}

export function removeShelfTake(id) {
  items = items.filter((item) => item.id !== id);
  emit();
}
