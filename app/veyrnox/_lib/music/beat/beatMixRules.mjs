export const REVERB_SIZES = Object.freeze([0.8, 1.6, 2.8, 4]);
export const DEFAULT_FX_PARAMS = Object.freeze({
  eq: Object.freeze({ low: 0, mid: 0, high: 0 }), compressor: Object.freeze({ threshold: -24, ratio: 4 }),
  distortion: Object.freeze({ drive: 0 }), delay: Object.freeze({ time: 0.375, feedback: 0.35, mix: 0.15 }),
  reverb: Object.freeze({ size: 1.6, mix: 0.12 }),
});
export const DEFAULT_MASTER = Object.freeze({ gain: 0.8, limiter: true,
  reverb: Object.freeze({ size: 1.6 }), delay: Object.freeze({ time: 0.375, feedback: 0.35 }) });
export const FX_RANGES = Object.freeze({ low: [-12, 12], mid: [-12, 12], high: [-12, 12],
  threshold: [-60, 0], ratio: [1, 20], drive: [0, 100], time: [0.02, 1], feedback: [0, 0.8], mix: [0, 1] });
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const subset = (v, names) => object(v) && Object.keys(v).every(k => names.includes(k));
const exact = (v, names) => subset(v, names) && names.every(k => Object.hasOwn(v, k));
const finite = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
export function masterError(master) {
  return exact(master, ['gain', 'limiter', 'reverb', 'delay']) && finite(master.gain, 0, 1) && typeof master.limiter === 'boolean'
    && exact(master.reverb, ['size']) && REVERB_SIZES.includes(master.reverb.size)
    && exact(master.delay, ['time', 'feedback']) && finite(master.delay.time, 0.02, 1) && finite(master.delay.feedback, 0, 0.8)
    ? null : 'Invalid master settings.';
}
export function trackMixError(track) {
  if (Object.hasOwn(track, 'fx')) {
    if (!Array.isArray(track.fx) || !track.fx.length || track.fx.length > 4) return 'A track can have at most 4 effects.';
    const ids = new Set();
    for (const fx of track.fx) {
      if (!exact(fx, ['id', 'type', 'bypass', 'params']) || typeof fx.id !== 'string' || !/^f[0-9a-z]{1,8}$/.test(fx.id)
        || ids.has(fx.id) || typeof fx.type !== 'string' || !Object.hasOwn(DEFAULT_FX_PARAMS, fx.type) || typeof fx.bypass !== 'boolean'
        || !exact(fx.params, Object.keys(DEFAULT_FX_PARAMS[fx.type]))
        || Object.entries(fx.params).some(([k, v]) => k === 'size' ? !REVERB_SIZES.includes(v) : !finite(v, ...FX_RANGES[k]))) return 'Invalid effect settings.';
      ids.add(fx.id);
    }
  }
  if (Object.hasOwn(track, 'sends') && (!exact(track.sends, ['reverb', 'delay'])
    || !finite(track.sends.reverb, 0, 1) || !finite(track.sends.delay, 0, 1))) return 'Invalid send levels.';
  if (Object.hasOwn(track, 'automation')) {
    if (!subset(track.automation, ['gain', 'pan']) || !Object.keys(track.automation).length) return 'Invalid automation lanes.';
    for (const [lane, points] of Object.entries(track.automation)) {
      if (!Array.isArray(points) || !points.length || points.length > 64) return 'A lane needs 1 to 64 points.';
      let previous = -1;
      for (const p of points) {
        if (!Array.isArray(p) || p.length !== 3 || !Number.isSafeInteger(p[0]) || p[0] % 60 || p[0] <= previous
          || p[0] > 512 * 3840 || !finite(p[1], lane === 'gain' ? 0 : -1, 1) || !finite(p[2], -1, 1)) return 'Invalid automation point.';
        previous = p[0];
      }
    }
  }
  return null;
}
export const trackHasMix = track => !!track && (Boolean(track.fx?.length)
  || ['reverb', 'delay'].some(bus => track.sends?.[bus] > 0)
  || ['gain', 'pan'].some(lane => Boolean(track.automation?.[lane]?.length)));
export const hasMixer = doc => Boolean(doc.master) || (doc.tracks || []).some(trackHasMix);
const delayTail = p => p.feedback === 0 ? p.time : p.time * Math.log(0.001) / Math.log(p.feedback);
export function mixTailSeconds(doc) {
  if (!hasMixer(doc)) return 1.5;
  const master = doc.master || DEFAULT_MASTER;
  return Math.min(10, Math.max(1.5, ...(doc.tracks || []).map(t =>
    (t.fx || []).filter(f => !f.bypass).reduce((tail, f) => tail + (f.type === 'reverb' ? f.params.size : f.type === 'delay' ? delayTail(f.params) : 0), 0)
    + Math.max(t.sends?.reverb > 0 ? master.reverb.size : 0, t.sends?.delay > 0 ? delayTail(master.delay) : 0))));
}

export const patternTailSeconds = (doc, track) => doc.master || trackHasMix(track) ? mixTailSeconds(doc) : 1.5;
