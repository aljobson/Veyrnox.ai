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

/** Models Film Studio can drive for a kind; the setup picker and the defaults share this. */
export function eligibleFilmModels(models, kind) {
  return (models || []).filter(m => m.kind === kind && m.takesPrompt !== false && !m.gated && !m.isEdit && !m.takesTopic && !m.takesPlan
    && (kind !== 'video' || m.durations?.some(n => n >= 10 && n <= 15)));
}

/** Fill empty Studio image/video models with the first eligible one, so setup starts ready. Returns the same film when nothing changes. */
export function withFilmStackDefaults(film, models) {
  let stack = film.stack;
  for (const kind of ['image', 'video']) {
    if (stack[kind] || stack[kind + 'Access'] !== 'Studio') continue;
    const pick = eligibleFilmModels(models, kind)[0];
    if (pick) stack = normalizeFilmStack(stack, kind, pick.id, models);
  }
  return stack === film.stack ? film : { ...film, stack };
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
