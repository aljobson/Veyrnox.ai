import {
  CHARACTER_GROUPS,
  ODDLING_ARCHETYPES,
  buildCharacterPrompt,
  sanitizeOddlingPicks,
} from './character.js';

export const ODDLING_STUDIO_SECTIONS = [
  { id: 'signal', label: 'Character signal', hint: 'Human-first, with other beings optional', groupIds: ['character_type'] },
  { id: 'identity', label: 'Identity', hint: 'Adult age, gender, heritage and skin tone', groupIds: ['gender', 'ethnicity_origin_base', 'age', 'skin_tone'] },
  { id: 'build', label: 'Build & proportions', hint: 'Shape, size, height and graphic proportions', groupIds: ['body_type', 'height', 'proportions'] },
  { id: 'hair', label: 'Hair sculpture', hint: 'Geometry, scale and color', groupIds: ['hair', 'hair_color'] },
  { id: 'head', label: 'Head & eyes', hint: 'Face silhouette, neck, eye shape and color', groupIds: ['head_shape', 'neck', 'eye_shape', 'eye_color'] },
  { id: 'features', label: 'Face details', hint: 'Makeup, facial hair and expressive details', groupIds: ['eyes_type', 'eyes_details', 'mouth', 'ears', 'horns', 'skin_conditions', 'face_features', 'facial_hair'] },
  { id: 'body-details', label: 'Body details', hint: 'Material, pattern and limb design', groupIds: ['face_skin_material', 'face_surface_pattern', 'left_arm', 'right_arm', 'left_leg', 'right_leg'] },
  { id: 'style', label: 'Style world', hint: 'Wardrobe, wearable oddity, prop and finish', groupIds: ['wardrobe_style', 'accessories', 'distinctive_features', 'rendering_style'] },
];

export const ODDLING_MOTIONS = [
  { id: 'deadpan-turn', name: 'Deadpan turn', phrase: 'slowly turns to camera, waits one beat, then delivers a perfectly deadpan look' },
  { id: 'tiny-reveal', name: 'Tiny object reveal', phrase: 'ceremoniously reveals one comically tiny object to the camera' },
  { id: 'hair-weather', name: 'Hair weather test', phrase: 'stands in artificial wind while the sculptural hair reacts with dramatic physical motion' },
  { id: 'prop-malfunction', name: 'Prop malfunction', phrase: 'tries to demonstrate the signature prop as it gently and harmlessly malfunctions' },
  { id: 'impossible-runway', name: 'Impossible runway', phrase: 'walks a short surreal runway turn that makes the whole silhouette readable' },
  { id: 'five-second-verdict', name: 'Five-second verdict', phrase: 'holds an everyday object up, considers it gravely, then gives a sharp silent verdict' },
  { id: 'micro-dance', name: 'One-move dance', phrase: 'performs one simple repeatable dance move designed for a looping social clip' },
  { id: 'slow-confession', name: 'Slow zoom confession', phrase: 'leans toward camera during a slow zoom as if sharing an absurdly serious secret' },
];

export const ODDLING_SCENES = [
  'Full-body studio introduction, neutral backdrop, silhouette completely visible',
  'Vertical creator profile portrait with the signature prop held clearly',
  'At a miniature talk-show desk built around the character proportions',
  'Reporting live from an ordinary supermarket aisle as if it were historic',
  'Inside a domestic room whose furniture is the wrong scale for the character',
  'Walking into frame for the first episode of a strange recurring show',
];

const ODDLING_GALLERY_SHEETS = [
  { image: '/oddlings/oddling-body-chaos.webp', ids: ['duchess-volume', 'major-minor', 'bughead-brenda', 'pam-bouffant'] },
  { image: '/oddlings/oddling-humans.webp', ids: ['vera-static', 'mister-monday', 'bloom-service', 'coupon-saint'] },
  { image: '/oddlings/oddling-silhouette-parade.webp', ids: ['olive-orbit', 'brick-picnic', 'madame-scissors', 'pocket-atlas'] },
  { image: '/oddlings/oddling-fashion-disasters.webp', ids: ['noodle-duke', 'taffy-tessa', 'tuesday-triangle', 'colonel-crumb'] },
  { image: '/oddlings/oddling-hair-parade.webp', ids: ['disco-anvil', 'cloudette-forecast', 'ziggy-receipt', 'baron-boucle'] },
  { image: '/oddlings/oddling-denim-basics.webp', ids: ['tall-order', 'bubble-barry', 'max-rep', 'shelf-life'] },
  { image: '/oddlings/oddling-cast.webp', ids: ['auntie-antenna', 'brine-minister', 'mossbyte', 'receipt-wraith'] },
];

export const ODDLING_PRESET_SOURCES = [
  { id: 'body', label: 'Body chaos', ids: ODDLING_GALLERY_SHEETS[0].ids },
  { id: 'silhouettes', label: 'Extreme silhouettes', ids: ODDLING_GALLERY_SHEETS[2].ids },
  { id: 'fashion', label: 'Fashion disasters', ids: ODDLING_GALLERY_SHEETS[3].ids },
  { id: 'hair', label: 'Hair sculptures', ids: ODDLING_GALLERY_SHEETS[4].ids },
  { id: 'denim', label: 'Tee + tight jeans', ids: ODDLING_GALLERY_SHEETS[5].ids },
  { id: 'oddities', label: 'Human oddities', ids: ODDLING_GALLERY_SHEETS[1].ids },
  { id: 'humans', label: 'All weird humans', kind: 'human' },
  { id: 'beings', label: 'Other beings', kind: 'creature' },
];

export const ODDLING_LIBRARY_KEY = 'veyrnox_oddling_library_v1';
const LIBRARY_LIMIT = 24;
const RANDOM_STYLE_GROUPS = [
  'hair', 'hair_color', 'head_shape', 'neck', 'eye_shape', 'eye_color',
  'face_features', 'facial_hair', 'wardrobe_style', 'accessories',
  'distinctive_features', 'rendering_style',
];

export function groupById(id) {
  return CHARACTER_GROUPS.find((group) => group.id === id) || null;
}

export function randomizeOddlingStyle(picks, random = Math.random) {
  const next = { ...sanitizeOddlingPicks(picks), character_type: picks?.character_type || 'Human' };
  for (const id of RANDOM_STYLE_GROUPS) {
    const group = groupById(id);
    if (!group?.options.length) continue;
    const index = Math.min(group.options.length - 1, Math.floor(Math.max(0, random()) * group.options.length));
    next[id] = group.options[index][0];
  }
  return next;
}

export function buildOddlingStudioPrompt({ picks, mode = 'portrait', motionId = '', scene = '', referenceNote = '' }) {
  const motion = ODDLING_MOTIONS.find((item) => item.id === motionId);
  const direction = [
    mode === 'motion'
      ? 'vertical short-form creator video, full body visible at the opening, consistent identity throughout the shot'
      : 'full-body editorial creator portrait, complete silhouette visible, character-sheet clarity',
    motion?.phrase,
    String(referenceNote || '').trim() ? `visual reference direction: ${String(referenceNote).trim()}` : '',
    String(scene || '').trim(),
  ].filter(Boolean).join(', ');
  return buildCharacterPrompt(direction, picks);
}

function cleanLibraryItem(item) {
  if (!item || typeof item !== 'object') return null;
  const savedAt = Number(item.savedAt);
  if (!Number.isFinite(savedAt)) return null;
  const picks = sanitizeOddlingPicks(item.picks);
  const name = picks.oddling_name || 'Untitled Oddling';
  return {
    id: String(item.id || `oddling-${savedAt}`).slice(0, 80),
    savedAt,
    name,
    picks,
    motionId: ODDLING_MOTIONS.some((motion) => motion.id === item.motionId) ? item.motionId : '',
  };
}

export function readOddlingLibrary(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(ODDLING_LIBRARY_KEY));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(cleanLibraryItem).filter(Boolean).sort((a, b) => b.savedAt - a.savedAt).slice(0, LIBRARY_LIMIT);
  } catch {
    return [];
  }
}

export function saveOddlingToLibrary(storage, picks, motionId = '', now = Date.now()) {
  try {
    const current = readOddlingLibrary(storage);
    const clean = sanitizeOddlingPicks(picks);
    const item = cleanLibraryItem({
      id: `oddling-${now}-${Math.random().toString(36).slice(2, 8)}`,
      savedAt: now,
      picks: clean,
      motionId,
    });
    const next = [item, ...current].slice(0, LIBRARY_LIMIT);
    storage.setItem(ODDLING_LIBRARY_KEY, JSON.stringify(next));
    return { ok: true, item, items: next };
  } catch {
    return { ok: false, item: null, items: [] };
  }
}

export function gallerySource(oddling) {
  for (const sheet of ODDLING_GALLERY_SHEETS) {
    const panel = sheet.ids.indexOf(oddling?.id);
    if (panel >= 0) return { image: sheet.image, panel };
  }
  return { image: '/oddlings/oddling-cast.webp', panel: 0 };
}

export function oddlingsForSource(sourceId) {
  const source = ODDLING_PRESET_SOURCES.find((item) => item.id === sourceId) || ODDLING_PRESET_SOURCES[0];
  if (source.ids) return source.ids.map((id) => ODDLING_ARCHETYPES.find((item) => item.id === id)).filter(Boolean);
  return ODDLING_ARCHETYPES.filter((item) => item.kind === source.kind);
}
