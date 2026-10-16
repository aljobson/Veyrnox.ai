import { supportedAspect } from './chatMedia.js';

/** Film cards require 10–15s; retain only lengths the selected Studio model declares. */
export function normalizeFilmStack(stack, key, value, models) {
  const next = { ...stack, [key]: value };
  if (next.videoAccess !== 'Studio') return next;
  const model = models.find(item => item.id === next.video);
  if (!model) return next;
  const lengths = (model.durations || []).filter(seconds => seconds >= 10 && seconds <= 15);
  return {
    ...next,
    seconds: lengths.length && !lengths.includes(Number(next.seconds)) ? String(lengths[0]) : next.seconds,
    aspect: supportedAspect(model, next.aspect) || next.aspect,
  };
}

/** A source-derived format has no aspect control; explicit model options must match. */
export function filmAspectCompatible(model, aspect) {
  const supported = supportedAspect(model, aspect);
  return !aspect || supported === null || supported === aspect;
}

export function videoAgentBalanceState(balance, credits) {
  if (!Number.isFinite(balance) || balance < 0 || !Number.isFinite(credits) || credits < 0) return 'unavailable';
  return balance < credits ? 'insufficient' : 'ready';
}
