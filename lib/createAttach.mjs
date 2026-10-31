import { generationMimeTypes, generationSlotKind, publicSlotMax } from './generationSourceSlots.mjs';
import { pickerAccept } from './uploadInputTypes.mjs';

// The Create "Attach from device" button works before a model is chosen for it:
// the files' types name the slots they fill, and the model follows the files.
const KIND_ORDER = ['image', 'video', 'audio'];
const SLOT_ORDER = ['image', 'endImage', 'video', 'audio'];

// Offers HEIC, AVIF, GIF, MOV and WebM too: they are converted before planAttachments sees them.
export const attachAccept = () => KIND_ORDER.map(pickerAccept).join(',');

export function attachSlotFor(file) {
  const type = String(file?.type || '').toLowerCase();
  return KIND_ORDER.find(kind => generationMimeTypes(kind).includes(type)) || null;
}

// At most 3 a kind, unless one slot of the model is itself verified for more (Seedance reference: 9).
const kindCap = (model, kind) => Math.max(3, ...Object.entries(model?.media || {})
  .filter(([slot]) => generationSlotKind(slot) === kind).map(([, spec]) => publicSlotMax(spec)));

// Hand the files, in the order given, to the slots a model declares: the first
// picture to the start image, the next to the end image, and so on.
function assign(model, queues) {
  const left = Object.fromEntries(Object.entries(queues).map(([kind, files]) => [kind, [...files]]));
  const assignments = [];
  for (const slot of SLOT_ORDER) {
    const spec = model.media?.[slot];
    if (!spec) continue;
    const queue = left[generationSlotKind(slot)];
    const reserve = SLOT_ORDER.slice(SLOT_ORDER.indexOf(slot) + 1).filter(other => model.media?.[other]?.required && generationSlotKind(other) === generationSlotKind(slot)).length;
    const count = Math.min(publicSlotMax(spec), Math.max(0, queue.length - reserve), kindCap(model, generationSlotKind(slot)) - assignments.filter(a => generationSlotKind(a.slot) === generationSlotKind(slot)).length);
    if (!count && spec.required) return null;
    for (let i = 0; i < count; i++) assignments.push({ slot, file: queue.shift() });
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

/**
 * How many files of each kind the Add files dialog lets the user pick for a model:
 * the sum of its slots' limits, at most 3 a kind unless one slot is verified higher (as `assign` places them). A model
 * with no media slots lets the files choose the model, so each kind gets the 3.
 * @param {{media?: Record<string, object>}|null|undefined} model
 * @returns {{image: number, video: number, audio: number}}
 */
export function attachCapacity(model) {
  const media = model?.media || {};
  if (!Object.keys(media).length) return { image: 3, video: 3, audio: 3 };
  const capacity = { image: 0, video: 0, audio: 0 };
  for (const [slot, spec] of Object.entries(media)) {
    const kind = generationSlotKind(slot);
    if (kind) capacity[kind] = Math.min(kindCap(model, kind), capacity[kind] + publicSlotMax(spec));
  }
  return capacity;
}
