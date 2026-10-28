import { generationMimeTypes } from './generationSourceSlots.mjs';

// Files people pick that /api/v1/uploads never stores. The browser turns each
// into a stored type first (app/veyrnox/_lib/uploadConvert.mjs), so the
// gateway allowlist in lib/uploadSource.js stays exactly as it is.
// Keys are what the file is; values are what it becomes.
const CONVERTIBLE = Object.freeze({
  image: Object.freeze({ 'image/heic': 'image/jpeg', 'image/heif': 'image/jpeg', 'image/avif': 'image/png', 'image/gif': 'image/png' }),
  video: Object.freeze({ 'video/quicktime': 'video/mp4', 'video/webm': 'video/mp4' }),
  audio: Object.freeze({}),
});
const KINDS = ['image', 'video', 'audio'];

// A browser may leave `file.type` empty (HEIC on most desktops) or use a
// non-standard name. The extension is only a hint: the gateway still reads the
// bytes after upload (sniffType) before anything reaches a provider.
const BY_EXTENSION = Object.freeze({
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', gif: 'image/gif',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav',
});
const ALIASES = Object.freeze({
  'image/jpg': 'image/jpeg', 'image/pjpeg': 'image/jpeg', 'image/heic-sequence': 'image/heic', 'image/heif-sequence': 'image/heif',
  'video/x-m4v': 'video/mp4', 'audio/mp3': 'audio/mpeg', 'audio/x-wav': 'audio/wav', 'audio/wave': 'audio/wav', 'audio/vnd.wave': 'audio/wav',
});

/** The media type a picked file is, from its declared type or else its extension. Empty when unknown. */
export function fileMediaType(file) {
  const declared = String(file?.type || '').toLowerCase().split(';')[0].trim();
  if (declared && declared !== 'application/octet-stream') return ALIASES[declared] || declared;
  const ext = String(file?.name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return (ext && BY_EXTENSION[ext]) || '';
}

/** What a file picker for this kind should offer: stored types, convertible ones, and their extensions. */
export function pickerAccept(kind) {
  const types = [...generationMimeTypes(kind), ...Object.keys(CONVERTIBLE[kind] || {})];
  const extensions = Object.entries(BY_EXTENSION).filter(([, type]) => types.includes(type)).map(([ext]) => `.${ext}`);
  return [...types, ...extensions].join(',');
}

/**
 * How a picked file reaches the gateway.
 * @returns {{kind:string, from:string, to:string|null}|null} `to` is null when
 *   the file is already a stored type; the whole result is null when the file
 *   is neither stored nor convertible.
 */
export function uploadPlan(file) {
  const from = fileMediaType(file);
  if (!from) return null;
  for (const kind of KINDS) {
    if (generationMimeTypes(kind).includes(from)) return { kind, from, to: null };
    const to = CONVERTIBLE[kind][from];
    if (to) return { kind, from, to };
  }
  return null;
}

/** The file name a converted file is saved under: same stem, the new type's extension. */
export function convertedName(name, to) {
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'video/mp4': 'mp4' }[to];
  const stem = String(name || 'upload').replace(/\.[^./\\]+$/, '') || 'upload';
  return ext ? `${stem}.${ext}` : stem;
}
