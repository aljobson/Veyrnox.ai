import { generationMimeTypes, generationSlotKind } from './generationSourceSlots.mjs';

// The Create "Attach from device" button works before a model is chosen for it:
// the files' types name the slots they fill, and the model follows the files.
const KIND_ORDER = ['image', 'video', 'audio'];
const SLOT_ORDER = ['image', 'endImage', 'video', 'audio'];

export const attachAccept = () => KIND_ORDER.flatMap(generationMimeTypes).join(',');

export function attachSlotFor(file) {
  const type = String(file?.type || '').toLowerCase();
  return KIND_ORDER.find(kind => generationMimeTypes(kind).includes(type)) || null;
}

// Hand the files, in the order given, to the slots a model declares: the first
// picture to the start image, the next to the end image, and so on.
function assign(model, queues) {
  const left = Object.fromEntries(Object.entries(queues).map(([kind, files]) => [kind, [...files]]));
  const assignments = [];
  for (const slot of SLOT_ORDER) {
    const spec = model.media?.[slot];
    if (!spec) continue;
    const file = left[generationSlotKind(slot)]?.shift();
    if (file) assignments.push({ slot, file });
    else if (spec.required) return null;
  }
  return assignments;
}

/**
 * Pick the model for a set of attached files, and say which slot takes which file.
 * The model that places the most files wins; a tie keeps the current model, then
 * the same kind, then an open (not gated) one, then the cheapest. A model whose
 * required slots the files cannot fill is skipped. `unused` lists the files no
 * slot took (a third picture, an unsupported type). Null when nothing fits.
 */
export function planAttachments(models, current, files) {
  const queues = Object.fromEntries(KIND_ORDER.map(kind => [kind, []]));
  const unsupported = [];
  for (const file of files || []) {
    const kind = attachSlotFor(file);
    if (kind) queues[kind].push(file); else unsupported.push(file);
  }
  const candidates = (models || []).map(model => ({ model, assignments: assign(model, queues) }))
    .filter(item => item.assignments && item.assignments.length > 0);
  candidates.sort((a, b) =>
    b.assignments.length - a.assignments.length
    || (b.model.id === current?.id) - (a.model.id === current?.id)
    || (b.model.kind === current?.kind) - (a.model.kind === current?.kind)
    || Boolean(a.model.gated) - Boolean(b.model.gated)
    || a.model.credits - b.model.credits);
  const best = candidates[0];
  if (!best) return null;
  const used = new Set(best.assignments.map(item => item.file));
  return { model: best.model, assignments: best.assignments, unused: [...files].filter(file => !used.has(file)) };
}
