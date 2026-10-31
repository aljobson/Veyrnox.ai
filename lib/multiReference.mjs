// Server authority. Public clients use capabilities.media[slot].maxFiles.
export const MULTI_REFERENCE_CONTRACT = 'v1';
// Per-slot ceiling. A model's own verified `max` decides; 3 stays the default for models verified only to 3.
export const MAX_SLOT_FILES = 9;
export const MAX_REFERENCES = 12; // fal Seedance 2.0 reference-to-video: 12 files across images, videos and audio
export const multiReferenceEnabled = (env = process.env) => env?.MULTI_REFERENCE_ENABLED === 'true';
// Both the endpoint count and price must have dated, reviewable evidence.
export function verifiedReferenceLimit(spec) {
  const https = value => {
    try { return typeof value === 'string' && new URL(value).protocol === 'https:'; } catch { return false; }
  };
  const date = spec?.verifiedAt;
  return https(spec?.verification) && https(spec?.priceVerification)
    && typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}
// Dispatch checks the admitted count against this verified contract, never a live flag.
export function hardMaxFiles(spec) {
  const max = spec?.max ?? 1;
  return spec?.list === true && verifiedReferenceLimit(spec) && Number.isInteger(max) && max >= 1 && max <= MAX_SLOT_FILES ? max : 1;
}

export function effectiveMaxFiles(spec, env = process.env) {
  return multiReferenceEnabled(env) ? hardMaxFiles(spec) : 1;
}
