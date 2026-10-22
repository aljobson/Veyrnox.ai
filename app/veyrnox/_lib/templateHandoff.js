import { SHOWCASE_CLIPS } from './showcase.js';

const cssAspect = (value) => typeof value === 'string' && /^\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?$/.test(value)
  ? value.replace(':', ' / ') : value;

/** A template stays visibly identifiable in Create without treating its preview as generation input. */
export function templateHandoffVisual(preset) {
  if (!preset || typeof preset.id !== 'string' || !preset.id) return null;
  const clip = typeof preset.clipKey === 'string' ? SHOWCASE_CLIPS[preset.clipKey] : null;
  if (clip?.video && clip?.poster) {
    return {
      kind: 'video',
      video: clip.video,
      poster: clip.poster,
      aspectRatio: cssAspect(clip.aspectRatio || preset.previewAspect) || '16 / 9',
    };
  }
  return { kind: 'artwork', aspectRatio: cssAspect(preset.previewAspect || preset.aspect) || '16 / 9' };
}

export function templateNeedsSource(preset) {
  return typeof preset?.needs === 'string' && preset.needs.trim() ? preset.needs.trim() : '';
}
