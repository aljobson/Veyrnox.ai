// Picture tiles for the catalog groups that have generated pictures: hair (one head per style), outfits (one full-body figure per outfit) and
// headwear (one head with the item). A listed option has a file (pinned by a test); any other option keeps its drawn tile.
import { HAIR_TILE_STYLES, hairTileSlug, hairTileSrc } from './oddlingHairTiles.js';

/** Outfits with a picture. Ceremonial Sportswear, Tiny Formalwear, Soft Sculpture and Weather Couture are not generated yet. */
export const OUTFIT_TILE_STYLES = Object.freeze([
  'Office Surrealist', 'Quilted Royalty', 'Utility Pop', 'Domestic Futurist', 'Modern Basics', 'Streetwear', 'Y2K', 'Goth', 'Retro', 'Sporty', 'Business Suit',
]);
export const HEADWEAR_TILE_STYLES = Object.freeze(['Baseball Cap', 'Beanie', 'Wide-Brim Hat', 'Bucket Hat', 'Headphones']);

/** Catalog group id -> folder under /oddlings and the options that have a file there. */
export const PICTURE_TILES = Object.freeze({
  hair: { dir: 'hair', styles: HAIR_TILE_STYLES },
  wardrobe_style: { dir: 'outfits', styles: OUTFIT_TILE_STYLES },
  headwear: { dir: 'headwear', styles: HEADWEAR_TILE_STYLES },
});

/** The picture for an option of a group, or '' when it has none (the drawn tile is used). */
export function pictureTileSrc(groupId, option) {
  if (groupId === 'hair') return hairTileSrc(option);
  const set = Object.hasOwn(PICTURE_TILES, groupId) ? PICTURE_TILES[groupId] : null;
  return set && set.styles.includes(option) ? `/oddlings/${set.dir}/${hairTileSlug(option)}.webp` : '';
}
