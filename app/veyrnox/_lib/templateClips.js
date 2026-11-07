export const TEMPLATE_CLIP_MODELS = Object.freeze({
  'seedance-2.0-reference': 'bytedance/seedance-2.0/reference-to-video',
  'seedance-2.0-reference-kie': 'market:bytedance/seedance-2',
});
export function isTemplateClipModel(id) {
  return typeof id === 'string' && Object.hasOwn(TEMPLATE_CLIP_MODELS, id);
}
// Public registry only. Availability and source media remain server-owned.
export const TEMPLATE_CLIPS = Object.freeze([
  Object.freeze({ id: 'medieval-runway-look', name: 'Medieval Runway Look', kind: 'recast' }),
]);

export function publicTemplateClip(id, clips = TEMPLATE_CLIPS) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(id)) return null;
  const clip = clips.find(item => item.id === id && item.kind === 'recast');
  return clip ? { id: clip.id, name: clip.name, kind: clip.kind } : null;
}
