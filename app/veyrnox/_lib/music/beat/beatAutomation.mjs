// Curves are sampled exactly once. Window boundaries only interpolate these chords.
export function curveShape(t, c) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return c < 0 ? t ** (1 - 3 * c) : c > 0 ? 1 - (1 - t) ** (1 + 3 * c) : t;
}
export function automationEnvelope(points, bpm) {
  const vertices = [], seconds = tick => tick / 960 * 60 / bpm;
  for (let i = 0; i < points.length; i++) {
    const [tick, value, curve] = points[i], next = points[i + 1];
    vertices.push([seconds(tick), value]);
    if (next && curve) for (let j = 1; j <= 16; j++) {
      const t = j / 17;
      vertices.push([seconds(tick + (next[0] - tick) * t), value + (next[1] - value) * curveShape(t, curve)]);
    }
  }
  return vertices;
}
export function envelopeAt(envelope, sec) {
  if (!envelope.length) return 0;
  if (sec <= envelope[0][0]) return envelope[0][1];
  for (let i = 1; i < envelope.length; i++) {
    const [end, value] = envelope[i], [start, previous] = envelope[i - 1];
    if (sec <= end) return previous + (value - previous) * (sec - start) / (end - start);
  }
  return envelope.at(-1)[1];
}
const scheduledEnds = new WeakMap();
export function scheduleAutomation(param, envelope, { fromSec, toSec, contextTime }) {
  if (!envelope.length || toSec <= fromSec) return;
  // Floating-point reassociation must not put a seam's set before the previous ramp.
  const previousEnd = scheduledEnds.get(param);
  if (previousEnd !== undefined && Math.abs(contextTime - previousEnd) < 1e-9) contextTime = previousEnd;
  param.setValueAtTime(envelopeAt(envelope, fromSec), contextTime);
  for (const [sec, value] of envelope) if (sec > fromSec && sec < toSec)
    param.linearRampToValueAtTime(value, contextTime + (sec - fromSec));
  const endTime = contextTime + (toSec - fromSec);
  param.linearRampToValueAtTime(envelopeAt(envelope, toSec), endTime);
  scheduledEnds.set(param, endTime);
}
