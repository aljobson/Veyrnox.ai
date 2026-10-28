// Catalog values ported from the web; drift tests cover every phone option.
import { GROUPS, swatchOf, type Picks } from './oddlingsBuilder';
import { PORTRAIT_HOST } from './oddlings';

export const HAIR_TILE_STYLES = Object.freeze([
  'Bald', 'Short Hair', 'Sharp Bob', 'Sculpted Waves', 'Sculptural Wave Tower', 'Monumental Hair', 'Cube Cut', 'Sphere Cut',
  'Wedge Cut', 'Tabletop', 'Spiral Tower', 'Twin Discs', 'Zigzag Cut', 'Anvil Cut', 'Donut Halo',
  'Tube Tower', 'Shelf Cut', 'Long Hair', 'Afro', 'Punk', 'Buzz Cut', 'Bowl Cut', 'Mullet',
  'Braids', 'Pigtails', 'Perm', 'Beehive', 'Pixie Cut', 'Ponytail', 'Top Knot', 'Undercut',
  'Pompadour', 'Cornrows', 'Locs', 'Fur / Mane', 'Tentacles', 'Flowers', 'Crescent Cut', 'Spines', 'Antennae',
]);

export const OUTFIT_TILE_STYLES = Object.freeze([
  'Office Surrealist', 'Quilted Royalty', 'Utility Pop', 'Domestic Futurist', 'Ceremonial Sportswear', 'Soft Sculpture', 'Modern Basics', 'Streetwear', 'Y2K', 'Goth', 'Retro', 'Sporty', 'Business Suit', 'Weather Couture', 'Tiny Formalwear',
]);
// Rendering style: the same fictional character in each style. Hyper-Realistic is a photographic portrait of a fictional person.
export const RENDERING_STYLE_TILE_STYLES = Object.freeze(['Anime', 'Cartoon', '2D Illustration', 'Hyper-Realistic']);
export const HEADWEAR_TILE_STYLES = Object.freeze(['Baseball Cap', 'Beanie', 'Wide-Brim Hat', 'Bucket Hat', 'Headphones']);

// Face options with a picture. Every option now has one.
export const HEAD_SHAPE_TILE_STYLES = Object.freeze(['Long Oval', 'Perfect Round', 'Square', 'Heart', 'Diamond', 'Tiny Head', 'Oversized Head']);
export const EYE_SHAPE_TILE_STYLES = Object.freeze(['Round', 'Monolid', 'Graphic Liner', 'Hooded', 'Upturned', 'Uneven', 'Almond', 'Narrow', 'Downturned', 'Wide Set', 'Close Set']);
export const NOSE_SHAPE_TILE_STYLES = Object.freeze(['Straight', 'Aquiline', 'Snub', 'Wide', 'Narrow', 'Round Tip', 'Button']);
export const BROWS_TILE_STYLES = Object.freeze(['Thick', 'Thin', 'Arched', 'Straight', 'Bushy', 'Bleached']);
export const LIPS_TILE_STYLES = Object.freeze(['Full', 'Thin', 'Cupid Bow', 'Glossy', 'Matte Dark']);
export const CHIN_JAW_TILE_STYLES = Object.freeze(['Strong Jaw', 'Pointed Chin', 'Round Chin', 'Soft Jaw', 'Prominent Chin', 'Cleft Chin']);
export const CHEEKS_TILE_STYLES = Object.freeze(['Dimples', 'Hollow Cheeks', 'Full Cheeks', 'High Cheekbones']);
export const EARS_TILE_STYLES = Object.freeze(['Human', 'Elf Ears', 'Wing Ears', 'No Ears']);
export const FACIAL_HAIR_TILE_STYLES = Object.freeze(['Clean Shaven', 'Stubble', 'Full Beard', 'Goatee', 'Pencil Moustache', 'Giant Moustache', 'Forked Beard', 'Beard Cube', 'Single Chin Curl']);
export const HORNS_TILE_STYLES = Object.freeze(['Small Horns', 'Big Horns', 'Antlers']);
export const FACE_FEATURES_TILE_STYLES = Object.freeze(['Tiny Brows', 'One Brow', 'Huge Lashes', 'Glossy Cheeks', 'Painted Blush', 'Metallic Freckles', 'Beauty Mark Constellation']);
export const EYES_TYPE_TILE_STYLES = Object.freeze(['Human', 'Reptile', 'Mechanical']);
export const EYES_DETAILS_TILE_STYLES = Object.freeze(['Heterochromia', 'Blind Eye', 'Scarred Eye', 'Glowing Eye']);
// Neck styling (all six) and limbs. A right arm or leg picture is the left one mirrored.
export const NECK_TILE_STYLES = Object.freeze(['Bare', 'Tower Collar', 'Ruff', 'Stacked Rings', 'Bow Sculpture', 'Feather Halo']);
export const LIMB_TILE_STYLES = Object.freeze(['Normal', 'Cute Prosthetic', 'Robotic', 'Prosthetic', 'Mechanical', 'None']);
// Skin: conditions, materials and surface patterns on warm beige mannequin heads. Every skin option now has a picture.
export const SKIN_CONDITIONS_TILE_STYLES = Object.freeze(['Vitiligo', 'Pigmentation', 'Freckles', 'Birthmarks', 'Scars', 'Albinism', 'Cracked Skin', 'Wrinkled', 'Burns']);
export const SKIN_MATERIAL_TILE_STYLES = Object.freeze(['Human Skin', 'Scales', 'Amphibian', 'Fish Skin', 'Porcelain', 'Glass', 'Fur', 'Metallic']);
export const SKIN_PATTERN_TILE_STYLES = Object.freeze(['Solid', 'Stripes', 'Spots', 'Chess', 'Veins', 'Gradient', 'Cracked', 'Giraffe']);
// Creature types: every one of the 20 has a picture (stylised 3D character heads with neck and shoulders).
export const SPECIES_TILE_STYLES = Object.freeze([
  'Human', 'Elf', 'Alien', 'Moth', 'Spectre', 'Fungus', 'Amphibian', 'Reptile', 'Mantis', 'Bee', 'Octopus', 'Crocodile', 'Iguana', 'Lizard', 'Beetle', 'Ant', 'Cat', 'Dog', 'Rodent', 'Bird',
]);
// Accessories: three catalog groups; every option has a picture.
export const EVERYDAY_ACCESSORIES_TILE_STYLES = Object.freeze(['Glasses', 'Round Glasses', 'Sunglasses', 'Jewellery', 'Everyday Bag', 'Tote Bag']);
export const ACCESSORIES_TILE_STYLES = Object.freeze([
  'Geometric Veil', 'Object Jewellery', 'Chrome Brows', 'Receipt Ribbons', 'Tiny Teacup', 'Bug Head Mask', 'Tiny Monocle', 'Impossible Handbag', 'Tattoos', 'Scarification', 'Symbols / Markings',
  'Tiny Sunglasses', 'Piercings', 'Cyber Markings', 'Tiny Handbag',
]);
export const DISTINCTIVE_FEATURES_TILE_STYLES = Object.freeze([
  'Tiny Microphone', 'Pocket Weather Station', 'Giant Comb', 'Sacred Stapler', 'Snack Sceptre', 'Miniature Chair', 'Impossible Handbag', 'Receipt Train', 'Miniature Thermos', 'Miniature Cake',
]);
// Body: fully clothed full-body figures. Only options that stay distinguishable once each figure is fitted to its tile have a picture.
export const BODY_TYPE_TILE_STYLES = Object.freeze(['Curvy', 'Heavy', 'Fat', 'Athletic', 'Muscular', 'Hyper-Muscular', 'Pear', 'Barrel', 'Skinny', 'Long Torso', 'Slim', 'Lean', 'Very Skinny', 'Lanky', 'Compact', 'Inverted Triangle', 'Long Legs']);
export const PROPORTIONS_TILE_STYLES = Object.freeze(['Natural', 'Tiny Torso', 'Huge Hands', 'No Visible Neck', 'Long Neck', 'Wide Shoulders', 'Narrow Shoulders', 'Long Torso', 'Tiny Hands']);
export const EXAGGERATION_TILE_STYLES = Object.freeze(['Natural', 'Bold', 'Extreme']);
// Heritage: stylised 3D busts. Every option has a picture.
// Gender: grey mannequin busts; Trans Man and Trans Woman carry a small trans-flag pin so they differ from Male and Female.
export const GENDER_TILE_STYLES = Object.freeze(['Female', 'Male', 'Non-binary', 'Trans Man', 'Trans Woman']);
export const ETHNICITY_TILE_STYLES = Object.freeze(['African', 'Asian', 'European', 'Indian', 'Middle Eastern', 'Mixed']);
export const MOUTH_TILE_STYLES = Object.freeze(['Large Mouth', 'No Teeth', 'Unique Teeth', 'Gap Teeth', 'Gold Tooth', 'Bright Smile', 'Sharp Teeth', 'Forked Tongue', 'Two Tongues', 'Crooked Teeth', 'Small Mouth']);

/** Catalog group id -> folder under /oddlings and the options that have a file there. */
export const PICTURE_TILES: Readonly<Record<string, { dir: string; styles: readonly string[] }>> = Object.freeze({
  hair: { dir: 'hair', styles: HAIR_TILE_STYLES },
  wardrobe_style: { dir: 'outfits', styles: OUTFIT_TILE_STYLES },
  headwear: { dir: 'headwear', styles: HEADWEAR_TILE_STYLES },
  head_shape: { dir: 'face/head_shape', styles: HEAD_SHAPE_TILE_STYLES },
  eye_shape: { dir: 'face/eye_shape', styles: EYE_SHAPE_TILE_STYLES },
  nose_shape: { dir: 'face/nose_shape', styles: NOSE_SHAPE_TILE_STYLES },
  mouth: { dir: 'face/mouth', styles: MOUTH_TILE_STYLES },
  brows: { dir: 'face/brows', styles: BROWS_TILE_STYLES },
  lips: { dir: 'face/lips', styles: LIPS_TILE_STYLES },
  chin_jaw: { dir: 'face/chin_jaw', styles: CHIN_JAW_TILE_STYLES },
  cheeks: { dir: 'face/cheeks', styles: CHEEKS_TILE_STYLES },
  ears: { dir: 'face/ears', styles: EARS_TILE_STYLES },
  neck: { dir: 'neck', styles: NECK_TILE_STYLES },
  left_arm: { dir: 'limbs/left_arm', styles: LIMB_TILE_STYLES },
  right_arm: { dir: 'limbs/right_arm', styles: LIMB_TILE_STYLES },
  left_leg: { dir: 'limbs/left_leg', styles: LIMB_TILE_STYLES },
  right_leg: { dir: 'limbs/right_leg', styles: LIMB_TILE_STYLES },
  rendering_style: { dir: 'rendering', styles: RENDERING_STYLE_TILE_STYLES },
  skin_conditions: { dir: 'skin/skin_conditions', styles: SKIN_CONDITIONS_TILE_STYLES },
  face_skin_material: { dir: 'skin/face_skin_material', styles: SKIN_MATERIAL_TILE_STYLES },
  face_surface_pattern: { dir: 'skin/face_surface_pattern', styles: SKIN_PATTERN_TILE_STYLES },
  character_type: { dir: 'species', styles: SPECIES_TILE_STYLES },
  everyday_accessories: { dir: 'accessories/everyday_accessories', styles: EVERYDAY_ACCESSORIES_TILE_STYLES },
  accessories: { dir: 'accessories/accessories', styles: ACCESSORIES_TILE_STYLES },
  distinctive_features: { dir: 'accessories/distinctive_features', styles: DISTINCTIVE_FEATURES_TILE_STYLES },
  body_type: { dir: 'body/body_type', styles: BODY_TYPE_TILE_STYLES },
  proportions: { dir: 'body/proportions', styles: PROPORTIONS_TILE_STYLES },
  exaggeration: { dir: 'body/exaggeration', styles: EXAGGERATION_TILE_STYLES },
  facial_hair: { dir: 'face/facial_hair', styles: FACIAL_HAIR_TILE_STYLES },
  horns: { dir: 'face/horns', styles: HORNS_TILE_STYLES },
  face_features: { dir: 'face/face_features', styles: FACE_FEATURES_TILE_STYLES },
  eyes_type: { dir: 'face/eyes_type', styles: EYES_TYPE_TILE_STYLES },
  gender: { dir: 'identity/gender', styles: GENDER_TILE_STYLES },
  ethnicity_origin_base: { dir: 'identity/ethnicity_origin_base', styles: ETHNICITY_TILE_STYLES },
  eyes_details: { dir: 'face/eyes_details', styles: EYES_DETAILS_TILE_STYLES },
});

export const SLIDER_SCALES: Readonly<Record<string, readonly string[]>> = Object.freeze({
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

export function controlKind(groupId: string): 'swatch' | 'slider' | 'tiles' {
    if (GROUPS.find(g => g.id === groupId)?.options.some(([value]) => swatchOf(groupId, value))) return 'swatch';
    return Object.hasOwn(SLIDER_SCALES, groupId) ? 'slider' : 'tiles';
}
export function sliderPosition(groupId: string, picks: Picks): number {
    return (SLIDER_SCALES[groupId]?.indexOf(picks?.[groupId]) ?? -1) + 1;
}
export function sliderValue(groupId: string, position: number): string {
    const scale = SLIDER_SCALES[groupId];
    if (!scale) return '';
    const step = Math.max(0, Math.min(scale.length, Math.round(Number(position) || 0)));
    return step === 0 ? '' : scale[step - 1];
}
export const hairTileSlug = (style: string): string => String(style).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export function pictureTileUrl(groupId: string, option: string): string | null {
    const set = Object.hasOwn(PICTURE_TILES, groupId) ? PICTURE_TILES[groupId] : null;
    return set?.styles.includes(option) ? `${PORTRAIT_HOST}/oddlings/${set.dir}/${hairTileSlug(option)}.webp` : null;
}
export const swatchBands = (swatch: string): string[] => swatch.match(/#[a-fA-F0-9]{3,8}\b/g) ?? [];
