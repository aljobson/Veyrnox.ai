import { createBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
export const make = () => createBeat({ id: 'e40439d1-646a-4c11-9c12-69fa3a851234', now: 0 });
export function legacy() {
  const { tracks, cycle, view, ...doc } = make();
  return { ...doc, version: 1, kit: tracks[0].kit };
}
export function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}
