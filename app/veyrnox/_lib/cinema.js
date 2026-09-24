// Cinema camera controls: camera body, lens, focal length and aperture,
// turned into prompt text. Option lists and wording ported from
// Open-Generative-AI's CinemaStudio.jsx (MIT, Copyright (c) Anil Matcha).
// Client-side only: it changes the prompt, never the model or the price.

export const CAMERAS = {
  'Modular 8K Digital': 'modular 8K digital cinema camera',
  'Full-Frame Cine Digital': 'full-frame digital cinema camera',
  'Grand Format 70mm Film': 'grand format 70mm film camera',
  'Studio Digital S35': 'Super 35 studio digital camera',
  'Classic 16mm Film': 'classic 16mm film camera',
  'Premium Large Format Digital': 'premium large-format digital cinema camera',
};

export const LENSES = {
  'Premium Modern Prime': 'premium modern prime lens',
  'Classic Anamorphic': 'classic anamorphic lens',
  'Compact Anamorphic': 'compact anamorphic lens',
  '70s Cinema Prime': '1970s cinema prime lens',
  'Warm Cinema Prime': 'warm-toned cinema prime lens',
  'Vintage Prime': 'vintage prime lens',
  'Swirl Bokeh Portrait': 'swirl bokeh portrait lens',
  'Clinical Sharp Prime': 'ultra-sharp clinical prime lens',
  'Extreme Macro': 'extreme macro lens',
  'Creative Tilt Lens': 'creative tilt lens effect',
  'Halation Diffusion': 'halation diffusion filter',
};

export const FOCAL_LENGTHS = {
  8: 'ultra-wide perspective',
  14: 'wide-angle perspective',
  24: 'wide-angle dynamic perspective',
  35: 'natural cinematic perspective',
  50: 'standard portrait perspective',
  85: 'classic portrait perspective',
};

export const APERTURES = {
  'f/1.4': 'shallow depth of field, creamy bokeh',
  'f/4': 'balanced depth of field',
  'f/11': 'deep focus clarity, sharp foreground to background',
};

export const DEFAULT_CINEMA = {
  camera: 'Studio Digital S35',
  lens: 'Premium Modern Prime',
  focal: 35,
  aperture: 'f/1.4',
};

// The gateway refuses a prompt over 2000 characters (lib/modelCapabilities.js).
export const PROMPT_MAX = 2000;

/** The camera description appended to a prompt. Unknown values are dropped. */
export function cinemaSuffix({ camera, lens, focal, aperture }) {
  const parts = [];
  if (CAMERAS[camera]) parts.push(`shot on a ${CAMERAS[camera]}`);
  if (LENSES[lens]) {
    const perspective = FOCAL_LENGTHS[focal];
    parts.push(perspective
      ? `using a ${LENSES[lens]} at ${focal}mm (${perspective})`
      : `using a ${LENSES[lens]}`);
  }
  if (APERTURES[aperture]) parts.push(`aperture ${aperture}`, APERTURES[aperture]);
  parts.push('cinematic lighting', 'natural color science', 'high dynamic range');
  return parts.join(', ');
}

/**
 * The prompt with the camera description appended. The user's text is cut,
 * never the camera text, so the result always fits the gateway limit.
 */
export function buildCinemaPrompt(base, settings) {
  const suffix = `, ${cinemaSuffix(settings)}`;
  const text = String(base || '').trim().slice(0, PROMPT_MAX - suffix.length);
  return text ? `${text}${suffix}` : '';
}
