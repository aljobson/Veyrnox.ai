import { MAX_SLOT_FILES } from './multiReference.mjs';
// Public slot names describe media type; provider field names remain server-only.
const kinds = Object.freeze({ image: 'image', endImage: 'image', video: 'video', audio: 'audio' });
const mimeTypes = Object.freeze({ image: Object.freeze(['image/jpeg','image/png','image/webp']), video: Object.freeze(['video/mp4']), audio: Object.freeze(['audio/mpeg','audio/wav']) });
export const generationSlotKind = slot => Object.hasOwn(kinds,slot) ? kinds[slot] : null;
export const generationMimeTypes = kind => Object.hasOwn(mimeTypes,kind) ? mimeTypes[kind] : [];
export const mediaInputKey = slot => generationSlotKind(slot) ? `${slot}_url` : null;

export const sourceList = value => Array.isArray(value) ? value : value ? [value] : [];
export const publicSlotMax = spec => Number.isInteger(spec?.maxFiles) ? Math.max(1, Math.min(MAX_SLOT_FILES, spec.maxFiles)) : 1;
export function setSlotSources(sources, slot, values) {
  const next = { ...sources };
  if (!values.length) delete next[slot];
  else next[slot] = values.length === 1 ? values[0] : values;
  return next;
}
export function editSlotSource(sources, slot, source, index, max = 1) {
  const values = [...sourceList(sources[slot])];
  if (index !== undefined) {
    if (source) values[index] = source; else values.splice(index, 1);
  } else if (!source) values.splice(0);
  else if (max === 1) values.splice(0, values.length, source);
  else values.push(source);
  return setSlotSources(sources, slot, values);
}
export function moveSlotSource(sources, slot, from, to) {
  const values = [...sourceList(sources[slot])];
  if (from < 0 || to < 0 || from >= values.length || to >= values.length) return sources;
  values.splice(to, 0, values.splice(from, 1)[0]);
  return setSlotSources(sources, slot, values);
}

/**
 * The sources a newly chosen model can take: each slot it has keeps its files
 * up to that slot's limit, in order. `dropped` lists the rest, so the caller can
 * release their object URLs.
 */
export function sourcesForModel(sources, media) {
  const kept = {}, dropped = [];
  for (const [slot, value] of Object.entries(sources || {})) {
    const files = sourceList(value);
    const keep = media?.[slot] ? files.slice(0, publicSlotMax(media[slot])) : [];
    dropped.push(...files.slice(keep.length));
    if (keep.length) kept[slot] = keep.length === 1 ? keep[0] : keep;
  }
  return { sources: kept, dropped };
}

/** An incomplete optional reference is still part of the user's intended request. */
export function generationSourceState(media, sources) {
  const entries = Object.entries(media || {});
  const files = entries.flatMap(([slot]) => sourceList(sources?.[slot]));
  const needsReattach = files.some(source => source.needsUpload);
  // Reachable without any picker action: a draft or handoff can hold more files than this model (or the flag) allows.
  const overLimit = entries.some(([slot, spec]) => sourceList(sources?.[slot]).length > publicSlotMax(spec));
  return {
    needsReattach,
    overLimit,
    hasSource: !needsReattach && files.length > 0,
    missingSource: needsReattach || entries.some(([slot, spec]) => spec.required && !sourceList(sources?.[slot]).length),
  };
}
