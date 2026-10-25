import { generationMimeTypes } from './generationSourceSlots.mjs';

// The Create "Attach from device" button works before a model is chosen for it:
// the file's type names the slot it fills, and the model follows the file.
const SLOT_ORDER = ['image', 'video', 'audio'];

export const attachAccept = () => SLOT_ORDER.flatMap(generationMimeTypes).join(',');

export function attachSlotFor(file) {
  const type = String(file?.type || '').toLowerCase();
  return SLOT_ORDER.find(slot => generationMimeTypes(slot).includes(type)) || null;
}

/**
 * The model that can take `slot`, or null. The current model wins when it can;
 * otherwise prefer one of the same kind, then an open (not gated) one, then the
 * cheapest. A model that also needs a different slot is skipped: the person
 * has only just attached one file.
 */
export function modelForAttachment(models, current, slot) {
  const fits = model => model.media?.[slot] && Object.entries(model.media).every(([name, spec]) => name === slot || !spec.required);
  if (current && fits(current)) return current;
  return [...(models || [])].filter(fits).sort((a, b) =>
    (b.kind === current?.kind) - (a.kind === current?.kind) || Boolean(a.gated) - Boolean(b.gated) || a.credits - b.credits)[0] || null;
}
