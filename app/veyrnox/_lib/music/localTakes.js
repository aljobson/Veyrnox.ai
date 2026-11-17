import { getShelf, hydrateShelf, subscribeShelf } from './instrumentShelf.js';
import { getBeatTake, beatTakes, hydrateBeatTakes, subscribeBeatTakes } from './beat/beatTakeStore.js';
export function localTake(ref) {
  const beat = getBeatTake(ref), shelf = !beat && getShelf().find(t => t.id === ref), row = beat || shelf;
  return row ? { id: row.id, label: row.label, samples: row.samples, sampleRate: row.sampleRate,
    seconds: row.samples.length / row.sampleRate, origin: beat ? 'beat' : 'shelf' } : null;
}
export const localTakeIds = () => [...new Set([...beatTakes(), ...getShelf()].map(t => t.id))];
export const hydrateLocalTakes = () => Promise.all([hydrateBeatTakes(), hydrateShelf()]);
export function subscribeLocalTakes(fn) { const a = subscribeShelf(fn), b = subscribeBeatTakes(fn); return () => { a(); b(); }; }
