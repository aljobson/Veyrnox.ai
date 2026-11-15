export const PPQ = 960;
export const stepTicks = 240;
export const stepSeconds = (bpm) => 60 / bpm / 4;
export const stepTime = (stepIndex, bpm, swing) => (stepIndex + (stepIndex % 2 ? swing * 0.5 : 0)) * stepSeconds(bpm);
export const loopSeconds = (bpm, steps) => stepSeconds(bpm) * steps;
export function nearestStep(offset, bpm, swing, steps) {
  const length = loopSeconds(bpm, steps);
  const wrapped = ((offset % length) + length) % length;
  let best = 0;
  let distance = Infinity;
  for (let step = 0; step < steps; step++) {
    const delta = Math.abs(wrapped - stepTime(step, bpm, swing));
    const circular = Math.min(delta, length - delta);
    if (circular < distance) { best = step; distance = circular; }
  }
  return best;
}

export const barTicks = 3840;
export const snapTick = (tick, snap = stepTicks) => Math.round(tick / snap) * snap;
export const clampLocator = (tick, end) => Math.max(0, Math.min(end, snapTick(tick)));
export function moveLocator(tick, key, snap, end) {
  const delta = { ArrowLeft: -snap, ArrowRight: snap, PageUp: -barTicks, PageDown: barTicks }[key];
  return clampLocator(key === 'Home' ? 0 : key === 'End' ? end : tick + (delta || 0), end);
}
// Shared by the scheduler and mixdown; straight boundaries never accumulate swing.
export const swingDelay = (step, bpm, swing) => step % 2 ? swing * stepSeconds(bpm) * 0.5 : 0;
export const eventTime = (straight, step, bpm, swing) => straight + swingDelay(step, bpm, swing);

export function formatPosition(ticks) {
  const tick = Math.max(0, Math.floor(ticks));
  const bar = Math.floor(tick / 3840) + 1, beat = Math.floor(tick % 3840 / 960) + 1;
  const step = Math.floor(tick % 960 / 240) + 1;
  return `bar ${bar}` + (tick % 3840 ? `, beat ${beat}` : '') + (tick % 960 ? `, step ${step}` : '');
}
