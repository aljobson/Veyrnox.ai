import { getShelf, hydrateShelf, subscribeShelf } from './instrumentShelf.js';
import { getBeatTake, beatTakes, hydrateBeatTakes, loadBeatTake, subscribeBeatTakes } from './beat/beatTakeStore.js';
const normalize = (beat, shelf) => {
  const row = beat || shelf;
  return row ? { id: row.id, label: row.label, samples: row.samples, sampleRate: row.sampleRate,
    seconds: row.samples.length / row.sampleRate, origin: beat ? 'beat' : 'shelf' } : null;
};
/** Synchronous lookup: a shelf take, or a beat take whose audio is already loaded. */
export function localTake(ref) {
  const beat = getBeatTake(ref);
  return normalize(beat?.samples ? beat : null, !beat?.samples && getShelf().find(t => t.id === ref));
}
/** Loads a recorded beat take's audio on demand; throws if the device store cannot be read. */
export async function loadLocalTake(ref) {
  await hydrateLocalTakes();
  const beat = getBeatTake(ref) ? await loadBeatTake(ref) : null;
  return normalize(beat?.samples ? beat : null, !beat?.samples && getShelf().find(t => t.id === ref));
}
export const localTakeIds = () => [...new Set([...beatTakes(), ...getShelf()].map(t => t.id))];
export const hydrateLocalTakes = () => Promise.all([hydrateBeatTakes(), hydrateShelf()]);
export function subscribeLocalTakes(fn) { const a = subscribeShelf(fn), b = subscribeBeatTakes(fn); return () => { a(); b(); }; }
