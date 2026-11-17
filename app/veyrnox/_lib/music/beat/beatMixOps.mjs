import { edit, trackById, BeatRefusal } from './beatOps.mjs';
import { DEFAULT_FX_PARAMS, DEFAULT_MASTER } from './beatMixRules.mjs';
const change = (doc, id, fn) => edit(doc, Date.now(), d => fn(trackById(d, id), d));
function effect(track, id) {
  const found = track.fx?.find(f => f.id === id);
  if (!found) throw new BeatRefusal('That effect no longer exists.');
  return found;
}
function points(track, lane) {
  if (!['gain', 'pan'].includes(lane)) throw new BeatRefusal('Choose gain or pan automation.');
  return track.automation?.[lane] || [];
}
function point(track, lane, index) {
  const p = points(track, lane)[index];
  if (!p) throw new BeatRefusal('That point no longer exists.');
  return p;
}
export const addEffect = (doc, id, type) => change(doc, id, t => {
  if (!Object.hasOwn(DEFAULT_FX_PARAMS, type)) throw new BeatRefusal('Choose an effect type.');
  t.fx ||= [];
  if (t.fx.length >= 4) throw new BeatRefusal('A track can have at most 4 effects.');
  let n = 1; while (t.fx.some(f => f.id === `f${n.toString(36)}`)) n++;
  t.fx.push({ id: `f${n.toString(36)}`, type, bypass: false, params: { ...DEFAULT_FX_PARAMS[type] } });
});
export const removeEffect = (doc, id, fxId) => change(doc, id, t => { effect(t, fxId); t.fx = t.fx.filter(f => f.id !== fxId); if (!t.fx.length) delete t.fx; });
export const moveEffect = (doc, id, fxId, delta) => change(doc, id, t => {
  effect(t, fxId); const at = t.fx.findIndex(f => f.id === fxId), to = at + delta;
  if (![-1, 1].includes(delta) || to < 0 || to >= t.fx.length) throw new BeatRefusal('The effect cannot move further.');
  [t.fx[at], t.fx[to]] = [t.fx[to], t.fx[at]];
});
export const setEffectBypass = (doc, id, fxId, bypass) => change(doc, id, t => { effect(t, fxId).bypass = bypass; });
export const setEffectParam = (doc, id, fxId, param, value) => change(doc, id, t => { effect(t, fxId).params[param] = value; });
export const setSend = (doc, id, bus, value) => change(doc, id, t => {
  if (!['reverb', 'delay'].includes(bus)) throw new BeatRefusal('Choose reverb or delay.');
  t.sends = { reverb: 0, delay: 0, ...t.sends, [bus]: value };
  if (t.sends.reverb === 0 && t.sends.delay === 0) delete t.sends;
});
export const setMaster = (doc, patch) => edit(doc, Date.now(), d => {
  const m = d.master || structuredClone(DEFAULT_MASTER);
  d.master = { ...m, ...patch, reverb: { ...m.reverb, ...patch.reverb }, delay: { ...m.delay, ...patch.delay } };
});
export const addAutomationPoint = (doc, id, lane, tick, value) => change(doc, id, t => {
  const list = points(t, lane);
  if (list.length >= 64) throw new BeatRefusal('A lane can have at most 64 points.');
  t.automation ||= {}; t.automation[lane] = [...list, [tick, value, 0]].sort((a, b) => a[0] - b[0]);
});
export const moveAutomationPoint = (doc, id, lane, index, tick, value) => change(doc, id, t => {
  const p = point(t, lane, index), list = points(t, lane);
  if (tick <= (list[index - 1]?.[0] ?? -1) || tick >= (list[index + 1]?.[0] ?? Infinity)) throw new BeatRefusal('Keep the point between its neighbours.');
  p[0] = tick; p[1] = value;
});
export const setAutomationCurve = (doc, id, lane, index, curve) => change(doc, id, t => { point(t, lane, index)[2] = curve; });
function clear(t, lane) {
  points(t, lane);
  if (t.automation) { delete t.automation[lane]; if (!Object.keys(t.automation).length) delete t.automation; }
}
export const clearAutomation = (doc, id, lane) => change(doc, id, t => clear(t, lane));
export const removeAutomationPoint = (doc, id, lane, index) => change(doc, id, t => {
  point(t, lane, index); t.automation[lane].splice(index, 1);
  if (!t.automation[lane].length) clear(t, lane);
});
