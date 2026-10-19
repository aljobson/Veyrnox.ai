// Oddling catalog: the same choices as the trait chips, laid out the way a character-creator game does it. Pure data and rules, no React.
// Every control edits the existing `picks` object (one value per group id), so prompts, saved passports and the Create handoff do not change.
import { CHARACTER_GROUPS } from './character.js';

/** Rail categories. Every character group sits in exactly one (pinned by a test), so nothing the old chips offered is lost. */
export const CATALOG_CATEGORIES = Object.freeze([
  { id: 'who', label: 'Who', hint: 'Kind of character, age and heritage',
    groupIds: ['character_type', 'exaggeration', 'gender', 'age', 'ethnicity_origin_base'] },
  { id: 'body', label: 'Body', hint: 'Build, height and sizes',
    groupIds: ['body_type', 'height', 'proportions', 'torso_size', 'neck_size', 'arm_size', 'leg_size', 'hand_size', 'foot_size'] },
  { id: 'skin', label: 'Skin', hint: 'Tone, texture and surface',
    groupIds: ['skin_tone', 'skin_conditions', 'face_skin_material', 'face_surface_pattern'] },
  { id: 'head', label: 'Head & face', hint: 'Head shape, brows, nose, mouth, ears',
    groupIds: ['head_shape', 'head_size', 'brows', 'nose_shape', 'nose_size', 'cheeks', 'lips', 'chin_jaw', 'mouth', 'mouth_size', 'ears', 'ear_size', 'horns', 'face_features', 'facial_hair'] },
  { id: 'eyes', label: 'Eyes', hint: 'Colour, shape and size',
    groupIds: ['eye_color', 'eye_shape', 'eye_size', 'eyes_type', 'eyes_details'] },
  { id: 'hair', label: 'Hair', hint: 'Style and colour',
    groupIds: ['hair', 'hair_color'] },
  { id: 'clothes', label: 'Clothes', hint: 'The outfit',
    groupIds: ['wardrobe_style'] },
  { id: 'extras', label: 'Hats & extras', hint: 'Headwear, accessories and props',
    groupIds: ['headwear', 'everyday_accessories', 'accessories', 'distinctive_features'] },
  { id: 'limbs', label: 'Limbs', hint: 'Neck, arms and legs',
    groupIds: ['neck', 'left_arm', 'right_arm', 'left_leg', 'right_leg'] },
  { id: 'finish', label: 'Finish', hint: 'How the picture is rendered',
    groupIds: ['rendering_style'] },
]);

// 24x24 line-icon paths for the rail and for tiles that cannot be drawn on the figure.
export const CATEGORY_ICONS = Object.freeze({
  who: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0',
  body: 'M12 4a2 2 0 1 0 0 .01ZM8 21l1.5-8L7 9l5-1 5 1-2.5 4 1.5 8',
  skin: 'M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11Z',
  head: 'M12 3a7 7 0 0 0-7 7c0 3 1.5 4.5 2 7h10c.5-2.5 2-4 2-7a7 7 0 0 0-7-7Zm-3 17h6',
  eyes: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  hair: 'M5 14c0-6 3-10 7-10s7 4 7 10M5 14c2 0 3-1 4-3 1 2 3 3 6 3M5 14v5m14-5v5',
  clothes: 'M8 4 4 7l2 3 2-1v11h8V9l2 1 2-3-4-3c-.5 1.5-2 2.500-4 2.500S8.500 5.500 8 4Z',
  extras: 'M4 14h16M7 14c0-5 2-8 5-8s5 3 5 8M3 14l1 5h16l1-5',
  limbs: 'M6 4l3 6-2 10m11-16-3 6 2 10M10 10h4',
  finish: 'M4 20 20 4M14 4h6v6M4 14l6 6',
});

// Colour groups show swatches. `swatch` is a CSS background (it may be a gradient); `fill` is the single flat colour the preview paints.
const flat = (hex) => ({ swatch: hex, fill: hex });
export const SWATCHES = Object.freeze({
  skin_tone: {
    Deep: flat('#4a2f22'), 'Rich Brown': flat('#6b4430'), 'Warm Brown': flat('#8d5b3d'), Olive: flat('#a98a5e'),
    Golden: flat('#c89a5b'), Light: flat('#dcb08a'), Fair: flat('#ebc6a6'), Porcelain: flat('#f4dccb'),
  },
  hair_color: {
    Black: flat('#1b1713'), Brown: flat('#5a3a22'), Blonde: flat('#d9b45f'), Ginger: flat('#c4572a'), Auburn: flat('#7b3321'),
    Platinum: flat('#e8e4d6'), Silver: flat('#b9bcc4'), White: flat('#f3f3f0'), Copper: flat('#b5652f'), 'Acid Green': flat('#9be21c'),
    'Electric Blue': flat('#2f7bff'), Burgundy: flat('#6e1230'), Pink: flat('#f06fb0'), Lilac: flat('#b79cf0'), Teal: flat('#16a39a'),
    'Split Color': { swatch: 'linear-gradient(90deg,#1b1713 50%,#f06fb0 50%)', fill: '#7a3f5c' },
    'Rainbow Stripe': { swatch: 'linear-gradient(90deg,#ff5a5a,#ffd24a,#58d68d,#4aa8ff,#a56bff)', fill: '#58d68d' },
  },
  eye_color: {
    Blue: flat('#3f7fd0'), Brown: flat('#7a4a2a'), Green: flat('#3f9a5a'), Amber: flat('#d49a2a'), Hazel: flat('#8a6a32'), Grey: flat('#8a94a0'),
    Red: flat('#c8323a'), Purple: flat('#7a4ac0'), Black: flat('#1a1a1c'), 'Deep Brown': flat('#3a2418'), White: flat('#f1f1ee'),
    'Solid Black': flat('#0a0a0b'), 'Blind / Empty': { swatch: 'repeating-linear-gradient(45deg,#f1f1ee 0 4px,#d9d9d4 4px 8px)', fill: '#f1f1ee' },
  },
});

// Ordered scales show a stepped slider. Position 0 is "Any" (no pick); positions 1..n are these values in this order, smallest first.
export const SLIDER_SCALES = Object.freeze({
  age: ['20s', '30s', '40s', '50s', '60s', '70+'],
  height: ['Very Short', 'Short', 'Average', 'Tall', 'Very Tall'],
  head_size: ['Small', 'Medium', 'Large', 'Extra Large'],
  torso_size: ['Small', 'Medium', 'Large', 'Extra Large'],
  neck_size: ['Small', 'Medium', 'Large', 'Extra Large'],
  arm_size: ['Small', 'Medium', 'Large', 'Extra Large'],
  leg_size: ['Small', 'Medium', 'Large', 'Extra Large'],
  hand_size: ['Small', 'Medium', 'Large', 'Extra Large'],
  foot_size: ['Small', 'Medium', 'Large', 'Extra Large'],
  eye_size: ['Small', 'Medium', 'Large', 'Extra Large'],
  mouth_size: ['Small', 'Medium', 'Large', 'Extra Large'],
  ear_size: ['Small', 'Medium', 'Large', 'Extra Large'],
  nose_size: ['Small', 'Medium', 'Large', 'Extra Large'],
});

// Groups whose tile is a picture of the figure with that option applied, and how closely the tile is cropped: 'face', 'head' (with hair and
// hats) or 'body'. Every other group still shows an icon tile until it gets a drawing.
export const TILE_FOCUS = Object.freeze({
  hair: 'head', headwear: 'head', wardrobe_style: 'body', body_type: 'body',
  head_shape: 'face', chin_jaw: 'face', eye_shape: 'face', eyes_type: 'face', eyes_details: 'face', brows: 'face', nose_shape: 'face', cheeks: 'face', lips: 'face',
  mouth: 'face', ears: 'face', horns: 'face', face_features: 'face', facial_hair: 'face',
  skin_conditions: 'face', face_skin_material: 'face', face_surface_pattern: 'face',
  character_type: 'head', exaggeration: 'body',
  proportions: 'body', neck: 'neck', left_arm: 'armLeft', right_arm: 'armRight', left_leg: 'legLeft', right_leg: 'legRight',
});

/** How the big preview is cropped while a category is open: close on the face for face work, on the head for hair, whole body otherwise. */
export const CATEGORY_FOCUS = Object.freeze({ head: 'face', eyes: 'face', hair: 'head', who: 'body', body: 'body', skin: 'body', clothes: 'body', extras: 'head', limbs: 'body', finish: 'body' });

const byId = new Map(CHARACTER_GROUPS.map((group) => [group.id, group]));
export const catalogGroup = (id) => byId.get(id) || null;

/** 'swatch' | 'slider' | 'tiles'. */
export function controlKind(groupId) {
  if (Object.hasOwn(SWATCHES, groupId)) return 'swatch';
  if (Object.hasOwn(SLIDER_SCALES, groupId)) return 'slider';
  return 'tiles';
}

/** 'mannequin' when the preview can draw this option on the figure, otherwise 'icon'. */
export const tileKind = (groupId) => (Object.hasOwn(TILE_FOCUS, groupId) ? 'mannequin' : 'icon');

/** The crop a tile of this group uses. */
export const tileFocus = (groupId) => TILE_FOCUS[groupId] || 'body';

export function categoryById(id) {
  return CATALOG_CATEGORIES.find((category) => category.id === id) || CATALOG_CATEGORIES[0];
}

/** The groups of a category, in order, as full group objects (ids that do not exist are skipped). */
export const categoryGroups = (category) => category.groupIds.map(catalogGroup).filter(Boolean);

/** How many of a category's groups have a pick, for the rail badge. */
export function categoryProgress(category, picks) {
  const groups = categoryGroups(category);
  return { picked: groups.filter((group) => picks?.[group.id]).length, total: groups.length };
}

/** Slider position (0 = Any) for the current pick; an unknown stored value reads as Any. */
export function sliderPosition(groupId, picks) {
  const scale = SLIDER_SCALES[groupId];
  const at = scale ? scale.indexOf(picks?.[groupId]) : -1;
  return at + 1;
}

/** The value a slider position stands for ('' for Any). Out-of-range or non-integer positions clamp to the nearest step. */
export function sliderValue(groupId, position) {
  const scale = SLIDER_SCALES[groupId];
  if (!scale) return '';
  const step = Math.max(0, Math.min(scale.length, Math.round(Number(position) || 0)));
  return step === 0 ? '' : scale[step - 1];
}
