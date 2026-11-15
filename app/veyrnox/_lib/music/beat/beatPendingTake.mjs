import { validInstrument } from './beatMidiRules.mjs';
// Refused takes live outside the versioned beat document. Keep a bounded recovery
// copy across navigation/pagehide without bypassing the beat store's conflict rules.
const memory = new Map();
const key = (id) => `veyrnox.beat.pending-take:${id}`;
export function validPendingTake(take) {
  return !!take && validInstrument(take.instrument) && /^t[0-9a-z]{1,12}$/.test(take.trackId) && Number.isInteger(take.startTick) && take.startTick >= 0 &&
    Number.isInteger(take.endLimit) && take.endLimit <= 512 * 3840 && take.endLimit > take.startTick &&
    [0, 60, 120, 240, 480, 960].includes(take.snap) && Array.isArray(take.notes) && take.notes.length <= 5000 &&
    take.notes.every((n) => n && [n.start, n.end, n.pitch, n.velocity].every(Number.isInteger) && n.start >= take.startTick && n.end <= take.endLimit &&
      n.end - n.start >= 30 && n.end - n.start <= 64 * 3840 && n.pitch >= 21 && n.pitch <= 108 && n.velocity >= 1 && n.velocity <= 127);
}
export function rememberTake(id, take, storage) {
  memory.set(id, structuredClone(take));
  try { storage ??= globalThis.localStorage; storage?.setItem(key(id), JSON.stringify(take)); return !!storage; } catch { return false; }
}
export function readPendingTake(id, storage) {
  try {
    storage ??= globalThis.localStorage;
    const raw = memory.get(id) || JSON.parse(storage?.getItem(key(id)) || 'null');
    return validPendingTake(raw) ? structuredClone(raw) : null;
  } catch { return null; }
}
export function forgetTake(id, storage) {
  memory.delete(id); try { storage ??= globalThis.localStorage; storage?.removeItem(key(id)); } catch { /* recovery will still be harmless on retry */ }
}
