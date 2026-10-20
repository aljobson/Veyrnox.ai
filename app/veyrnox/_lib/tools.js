// The /tools page: models that work on a file you already have, grouped by
// the job they do. Which models exist, what they take and what they cost all
// come from the live catalog; only the task names and one-line blurbs live
// here. A catalog model with a required upload and no task listed still
// shows, under "More tools", so a new row is never hidden.

import { translator } from '../../../lib/i18n/translate.mjs';

export const TOOL_TASKS = [
  { key: 'upscale', label: 'Upscale', blurb: 'Make an image larger and sharper.', ids: ['topaz-upscale'] },
  { key: 'background', label: 'Remove background', blurb: 'Cut the subject out of a photo.', ids: ['bria-bg-remove'] },
  { key: 'expand', label: 'Expand', blurb: 'Extend an image beyond its edges.', ids: ['bria-expand'] },
  { key: 'edit', label: 'Edit with a prompt', blurb: 'Change an image by describing the change.', ids: ['nano-banana-pro-edit', 'nano-banana-pro-edit-grsai'] },
  { key: 'face-filters', label: 'Face filters', blurb: 'Retouch, relight or restyle the face in your own photo.', ids: ['face-retouch', 'face-enhance', 'face-relight', 'face-makeup', 'face-age'] },
  { key: 'animate', label: 'Photo to video', blurb: 'Turn a still image into a moving clip.', ids: ['kling-3.0-i2v', 'kling-3.0-i2v-kie'] },
  { key: 'avatar', label: 'Talking avatar', blurb: 'Make a photo speak a voice clip.', ids: ['kling-avatar-v2'] },
  { key: 'lipsync', label: 'Lip sync', blurb: 'Match a video\'s lips to new speech.', ids: ['latentsync'] },
  { key: 'audio-separation', label: 'Separate vocals and instruments', blurb: 'Split your own audio into six separate tracks.', ids: ['demucs-stems'] },
  { key: 'video-sound', label: 'Add sound to a video', blurb: 'Generate sound that fits a short clip.', ids: ['mmaudio-v2-video'] },
  { key: 'video-upscale', label: 'Upscale video', blurb: 'Make a short clip larger and sharper.', ids: ['topaz-upscale-video'] },
];
const OTHER = { key: 'other', label: 'More tools', blurb: 'Other models that start from your own file.' };

const SLOT_LABEL = { image: 'an image', video: 'a video', audio: 'audio' };
const ENGLISH = translator('en');

/** True for a model that cannot run without an upload. */
export function isTool(model) {
  return Object.values(model?.capabilities?.media || {}).some((spec) => spec && spec.required);
}

/**
 * "an image and audio": the uploads a tool requires, in words. `t` is a
 * translator (lib/i18n/translate.mjs); with none the words are English.
 */
export function toolNeeds(model, t = ENGLISH) {
  const slots = Object.entries(model?.capabilities?.media || {}).filter(([, spec]) => spec && spec.required)
    .map(([slot]) => (SLOT_LABEL[slot] ? t(`tools.slot.${slot}`) : slot));
  return slots.reduce((joined, slot) => (joined ? t('tools.and', { a: joined, b: slot }) : slot), '');
}

/**
 * @param {Array<{id:string, capabilities?:object}>} models  shelf models from the catalog
 * @returns {Array<{key:string,label:string,blurb:string,tools:Array}>} non-empty groups, in TOOL_TASKS order
 */
export function toolGroups(models) {
  const tools = models.filter(isTool);
  const taskOf = (id) => TOOL_TASKS.find((t) => t.ids.includes(id));
  const groups = TOOL_TASKS.map((t) => ({ key: t.key, label: t.label, blurb: t.blurb, tools: tools.filter((m) => t.ids.includes(m.id)) }));
  groups.push({ ...OTHER, tools: tools.filter((m) => !taskOf(m.id)) });
  return groups.filter((g) => g.tools.length > 0);
}
