export const TALKING_AVATAR_BACKGROUND_MAX_BYTES = 500 * 1024 * 1024;

export const DEFAULT_TALKING_AVATAR_COMPOSITION = Object.freeze({
  subtitles: false,
  captionPreset: 'simple',
  pictureInPicture: false,
  narration: 'speech',
  position: 'bottom-right',
  shape: 'circle',
});

export const TALKING_AVATAR_POSITIONS = Object.freeze([
  { id: 'top-left', label: 'Top left' },
  { id: 'top-right', label: 'Top right' },
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'bottom-right', label: 'Bottom right' },
]);

export const TALKING_AVATAR_SHAPES = Object.freeze([
  { id: 'circle', label: 'Circle', description: 'Round crop' },
  { id: 'original', label: 'Original', description: 'Keep portrait ratio' },
]);

export function validateTalkingAvatarBackground(file) {
  if (!file) return { ok: false, code: 'background_required' };
  if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(file.type)) return { ok: false, code: 'background_type' };
  if (!(Number(file.size) > 0) || Number(file.size) > TALKING_AVATAR_BACKGROUND_MAX_BYTES) return { ok: false, code: 'background_size' };
  return { ok: true, code: null };
}

export function talkingAvatarCompositionStatus(settings, background, { subtitlesAvailable = false } = {}) {
  const current = { ...DEFAULT_TALKING_AVATAR_COMPOSITION, ...(settings || {}) };
  if (current.pictureInPicture && !background) return { ready: false, code: 'background_required' };
  if (current.subtitles && !subtitlesAvailable) return { ready: false, code: 'captions_unavailable' };
  return { ready: true, code: null };
}
