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
