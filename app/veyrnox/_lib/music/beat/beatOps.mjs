import { BEAT_LIMITS, validateBeat } from './beatDocument.mjs';
function edit(doc, now, change) {
  const next = structuredClone(doc);
  change(next);
  next.updatedAt = now;
  if (!validateBeat(next).ok) throw new Error('invalid');
  return next;
}
function hits(doc, pad) { return doc.patterns[doc.currentPattern].rows[pad] || []; }
function put(doc, pad, step, velocity) {
  doc.patterns[doc.currentPattern].rows[pad] = [...hits(doc, pad).filter(([s]) => s !== step), [step, velocity]].sort((a, b) => a[0] - b[0]);
}
export const toggleStep = (doc, pad, step, now = Date.now()) => edit(doc, now, (d) => {
  const row = hits(d, pad);
  if (row.some(([s]) => s === step)) d.patterns[d.currentPattern].rows[pad] = row.filter(([s]) => s !== step);
  else put(d, pad, step, 100);
});
export const cycleVelocity = (doc, pad, step, dir = 1, now = Date.now()) => edit(doc, now, (d) => {
  const hit = hits(d, pad).find(([s]) => s === step);
  if (hit) put(d, pad, step, BEAT_LIMITS.velocities[(BEAT_LIMITS.velocities.indexOf(hit[1]) + (dir < 0 ? 2 : 1)) % 3]);
});
export const addHitAtStep = (doc, pad, step, now = Date.now()) => edit(doc, now, (d) => put(d, pad, step, 100));
export const setTempo = (doc, bpm, now = Date.now()) => edit(doc, now, (d) => { d.tempo.bpm = bpm; });
export const setSwing = (doc, value, now = Date.now()) => edit(doc, now, (d) => { d.swing = value; });
export const setKit = (doc, kit, now = Date.now()) => edit(doc, now, (d) => { d.kit = kit; });
export const setSteps = (doc, steps, now = Date.now()) => edit(doc, now, (d) => { d.steps = steps; });
export const selectPattern = (doc, slot, now = Date.now()) => edit(doc, now, (d) => { d.currentPattern = slot; });
export const copyPattern = (doc, from, to, now = Date.now()) => edit(doc, now, (d) => { d.patterns[to] = structuredClone(d.patterns[from]); });
export const clearPattern = (doc, now = Date.now()) => edit(doc, now, (d) => { d.patterns[d.currentPattern] = { rows: {} }; });
export const rename = (doc, title, now = Date.now()) => edit(doc, now, (d) => { d.title = title; });
export const setMetronome = (doc, enabled, now = Date.now()) => edit(doc, now, (d) => { d.metronome = enabled; });
export const restorePattern = (doc, slot, pattern, now = Date.now()) => edit(doc, now, (d) => { d.patterns[slot] = structuredClone(pattern); });
