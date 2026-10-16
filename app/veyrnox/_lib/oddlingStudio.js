import {
  CHARACTER_GROUPS,
  ODDLING_ARCHETYPES,
  buildCharacterPrompt,
  sanitizeOddlingPicks,
} from './character.js';

export const ODDLING_STUDIO_SECTIONS = [
  { id: 'signal', label: 'Character signal', hint: 'Human-first, with other beings optional', groupIds: ['character_type'] },
  { id: 'identity', label: 'Identity', hint: 'Adult age, gender, heritage and skin tone', groupIds: ['gender', 'ethnicity_origin_base', 'age', 'skin_tone'] },
  { id: 'build', label: 'Build & proportions', hint: 'Torso, body, height and limb sizes', groupIds: ['body_type', 'height', 'proportions', 'torso_size', 'arm_size', 'leg_size', 'hand_size', 'foot_size'] },
  { id: 'hair', label: 'Hair sculpture', hint: 'Geometry, scale and color', groupIds: ['hair', 'hair_color'] },
  { id: 'head', label: 'Head & eyes', hint: 'Head size and shape, neck size and styling, eye shape and color', groupIds: ['head_shape', 'head_size', 'neck_size', 'neck', 'eye_shape', 'eye_color'] },
  { id: 'features', label: 'Face details', hint: 'Eye, mouth, ear and nose sizes, makeup and expressive details', groupIds: ['eyes_type', 'eyes_details', 'eye_size', 'mouth', 'mouth_size', 'ears', 'ear_size', 'nose_size', 'horns', 'skin_conditions', 'face_features', 'facial_hair'] },
  { id: 'body-details', label: 'Body details', hint: 'Material, pattern and limb design', groupIds: ['face_skin_material', 'face_surface_pattern', 'left_arm', 'right_arm', 'left_leg', 'right_leg'] },
  { id: 'style', label: 'Style world', hint: 'Wardrobe, accessories, prop and finish', groupIds: ['wardrobe_style', 'accessories', 'distinctive_features', 'rendering_style'] },
];

export const ODDLING_DOLL_FACETS = [
  {
    id: 'body_type', label: 'Body', options: [
      ['Very Skinny', 'Needle'], ['Pear', 'Pear'], ['Fat', 'Bubble'], ['Hyper-Muscular', 'Power'],
    ],
  },
  {
    id: 'hair', label: 'Hair', options: [
      ['Short Hair', 'Short'], ['Sphere Cut', 'Sphere'], ['Sculptural Wave Tower', 'Tower'], ['Shelf Cut', 'Shelf'],
    ],
  },
  {
    id: 'wardrobe_style', label: 'Outfit', options: [
      ['Modern Basics', 'Tee + jeans'], ['Office Surrealist', 'Office'], ['Soft Sculpture', 'Puffer'], ['Tiny Formalwear', 'Tiny formal'],
    ],
  },
];

export function oddlingCreditState(balance, cost) {
  if (!Number.isFinite(balance) || !Number.isFinite(cost) || cost <= 0) return null;
  return {
    low: balance <= cost * 2,
    insufficient: balance < cost,
  };
}

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
  { image: '/oddlings/oddling-body-chaos.webp', aspectRatio: '1 / 2', ids: ['duchess-volume', 'major-minor', 'bughead-brenda', 'pam-bouffant'] },
  { image: '/oddlings/oddling-humans.webp', aspectRatio: '1 / 2', ids: ['vera-static', 'mister-monday', 'bloom-service', 'coupon-saint'] },
  { image: '/oddlings/oddling-silhouette-parade.webp', aspectRatio: '1 / 2', ids: ['olive-orbit', 'brick-picnic', 'madame-scissors', 'pocket-atlas'] },
  { image: '/oddlings/oddling-fashion-disasters.webp', aspectRatio: '1 / 2', ids: ['noodle-duke', 'taffy-tessa', 'tuesday-triangle', 'colonel-crumb'] },
  { image: '/oddlings/oddling-hair-parade.webp', aspectRatio: '1 / 2', ids: ['disco-anvil', 'cloudette-forecast', 'ziggy-receipt', 'baron-boucle'] },
  { image: '/oddlings/oddling-denim-basics.webp', aspectRatio: '3 / 8', ids: ['tall-order', 'bubble-barry', 'max-rep', 'shelf-life'] },
  { image: '/oddlings/oddling-cast.webp', aspectRatio: '1 / 2', ids: ['auntie-antenna', 'brine-minister', 'mossbyte', 'receipt-wraith'] },
];

export const ODDLING_PRESET_SOURCES = [
  { id: 'body', label: 'Character collection', ids: ODDLING_GALLERY_SHEETS[0].ids },
  { id: 'silhouettes', label: 'Distinctive silhouettes', ids: ODDLING_GALLERY_SHEETS[2].ids },
  { id: 'fashion', label: 'Statement fashion', ids: ODDLING_GALLERY_SHEETS[3].ids },
  { id: 'hair', label: 'Hair sculptures', ids: ODDLING_GALLERY_SHEETS[4].ids },
  { id: 'denim', label: 'Tee + tight jeans', ids: ODDLING_GALLERY_SHEETS[5].ids },
  { id: 'oddities', label: 'Surreal characters', ids: ODDLING_GALLERY_SHEETS[1].ids },
  { id: 'torsos', label: 'Torso sizes · New', ids: ['pip-parcel', 'mira-measure', 'arlo-archive', 'orla-overture'] },
  { id: 'humans', label: 'All human characters', kind: 'human' },
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
    const options = id === 'head_shape' && next.head_size
      ? group.options.filter(([value]) => !['Tiny Head', 'Oversized Head'].includes(value))
      : group.options;
    const index = Math.min(options.length - 1, Math.floor(Math.max(0, random()) * options.length));
    next[id] = options[index][0];
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
  if (!Number.isFinite(savedAt) || !Number.isFinite(new Date(savedAt).getTime())) return null;
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
  const character = ODDLING_ARCHETYPES.find((item) => item.id === oddling?.id);
  return character ? { image: `/oddlings/portraits/${character.id}.webp`, aspectRatio: '2 / 3' } : null;
}

export function oddlingPortrait(id) {
  const character = ODDLING_ARCHETYPES.find((item) => item.id === id);
  return character ? { id: character.id, name: character.name, ...gallerySource(character) } : null;
}

export function animationModel(models) {
  const eligible = models.filter((model) => model.kind === 'video' && !model.gated
    && model.media?.image?.required && (model.durations || [5]).includes(5)
    && !Object.entries(model.media).some(([slot, spec]) => slot !== 'image' && spec.required));
  return eligible.find((model) => model.id === 'kling-3.0-i2v') || eligible[0];
}

export function buildOddlingAnimationPrompt(id, motionId) {
  const portrait = oddlingPortrait(id);
  if (!portrait) return '';
  const motion = ODDLING_MOTIONS.find((item) => item.id === motionId) || ODDLING_MOTIONS[0];
  return `Animate ${portrait.name}, the exact single character in the start image. The character ${motion.phrase}. Preserve the face, body shape and size, outfit colors and fit, props, and exact sculptural hairstyle from the image throughout. Keep the whole silhouette and hairstyle in frame, stable camera, natural coherent movement, same background and lighting.`;
}

export function oddlingsForSource(sourceId) {
  const source = ODDLING_PRESET_SOURCES.find((item) => item.id === sourceId) || ODDLING_PRESET_SOURCES[0];
  if (source.ids) return source.ids.map((id) => ODDLING_ARCHETYPES.find((item) => item.id === id)).filter(Boolean);
  return ODDLING_ARCHETYPES.filter((item) => item.kind === source.kind);
}
