// The /tools page: models that work on a file you already have, grouped by
// the job they do. Which models exist, what they take and what they cost all
// come from the live catalog; only the task names and one-line blurbs live
// here. A catalog model with a required upload and no task listed still
// shows, under "More tools", so a new row is never hidden.

export const TOOL_TASKS = [
  { key: 'upscale', label: 'Upscale', blurb: 'Make an image larger and sharper.', ids: ['topaz-upscale'] },
  { key: 'background', label: 'Remove background', blurb: 'Cut the subject out of a photo.', ids: ['bria-bg-remove'] },
  { key: 'expand', label: 'Expand', blurb: 'Extend an image beyond its edges.', ids: ['bria-expand'] },
  { key: 'edit', label: 'Edit with a prompt', blurb: 'Change an image by describing the change.', ids: ['nano-banana-pro-edit', 'nano-banana-pro-edit-grsai'] },
  { key: 'animate', label: 'Photo to video', blurb: 'Turn a still image into a moving clip.', ids: ['kling-3.0-i2v', 'kling-3.0-i2v-kie'] },
  { key: 'avatar', label: 'Talking avatar', blurb: 'Make a photo speak a voice clip.', ids: ['kling-avatar-v2'] },
  { key: 'lipsync', label: 'Lip sync', blurb: 'Match a video\'s lips to new speech.', ids: ['latentsync'] },
];
const OTHER = { key: 'other', label: 'More tools', blurb: 'Other models that start from your own file.' };

const SLOT_LABEL = { image: 'an image', video: 'a video', audio: 'audio' };

/** True for a model that cannot run without an upload. */
export function isTool(model) {
  return Object.values(model?.capabilities?.media || {}).some((spec) => spec && spec.required);
}

/** "an image and audio": the uploads a tool requires, in words. */
export function toolNeeds(model) {
  const slots = Object.entries(model?.capabilities?.media || {}).filter(([, spec]) => spec && spec.required)
    .map(([slot]) => SLOT_LABEL[slot] || slot);
  return slots.join(' and ');
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
