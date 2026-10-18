// Picture tiles for the catalog groups that have generated pictures: hair (one head per style), outfits (one full-body figure per outfit),
// headwear (one head with the item) and some face groups (head shape, eye shape, nose shape, mouth). A listed option has a file (pinned by a test); any other option keeps its drawn tile.
import { HAIR_TILE_STYLES, hairTileSlug, hairTileSrc } from './oddlingHairTiles.js';

/** Outfits with a picture. Ceremonial Sportswear, Tiny Formalwear, Soft Sculpture and Weather Couture are not generated yet. */
export const OUTFIT_TILE_STYLES = Object.freeze([
  'Office Surrealist', 'Quilted Royalty', 'Utility Pop', 'Domestic Futurist', 'Modern Basics', 'Streetwear', 'Y2K', 'Goth', 'Retro', 'Sporty', 'Business Suit',
]);
export const HEADWEAR_TILE_STYLES = Object.freeze(['Baseball Cap', 'Beanie', 'Wide-Brim Hat', 'Bucket Hat', 'Headphones']);

// Face options with a picture. Only the ones that read clearly at tile size are listed: most eye and nose shapes, Tiny Head, Oversized Head,
// Small Mouth and Crooked Teeth looked the same as their neighbours on the generated sheets, so they keep the drawn tile.
export const HEAD_SHAPE_TILE_STYLES = Object.freeze(['Long Oval', 'Perfect Round', 'Square', 'Heart', 'Diamond']);
export const EYE_SHAPE_TILE_STYLES = Object.freeze(['Round', 'Monolid', 'Graphic Liner']);
export const NOSE_SHAPE_TILE_STYLES = Object.freeze(['Straight', 'Button', 'Wide']);
export const MOUTH_TILE_STYLES = Object.freeze(['Large Mouth', 'No Teeth', 'Unique Teeth', 'Gap Teeth', 'Gold Tooth', 'Bright Smile', 'Sharp Teeth', 'Forked Tongue', 'Two Tongues']);

/** Catalog group id -> folder under /oddlings and the options that have a file there. */
export const PICTURE_TILES = Object.freeze({
  hair: { dir: 'hair', styles: HAIR_TILE_STYLES },
  wardrobe_style: { dir: 'outfits', styles: OUTFIT_TILE_STYLES },
  headwear: { dir: 'headwear', styles: HEADWEAR_TILE_STYLES },
  head_shape: { dir: 'face/head_shape', styles: HEAD_SHAPE_TILE_STYLES },
  eye_shape: { dir: 'face/eye_shape', styles: EYE_SHAPE_TILE_STYLES },
  nose_shape: { dir: 'face/nose_shape', styles: NOSE_SHAPE_TILE_STYLES },
  mouth: { dir: 'face/mouth', styles: MOUTH_TILE_STYLES },
});

/** The picture for an option of a group, or '' when it has none (the drawn tile is used). */
export function pictureTileSrc(groupId, option) {
  if (groupId === 'hair') return hairTileSrc(option);
  const set = Object.hasOwn(PICTURE_TILES, groupId) ? PICTURE_TILES[groupId] : null;
  return set && set.styles.includes(option) ? `/oddlings/${set.dir}/${hairTileSlug(option)}.webp` : '';
}
