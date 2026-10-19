// Picture tiles for the hair catalog: one generated mannequin-head image per hairstyle, cut from contact sheets by scripts/slice-hair-sheets.mjs
// and kept in public/oddlings/hair. A style listed here has a file (pinned by a test); a style not listed keeps its drawn tile.

/** Hairstyles that have a picture tile. */
export const HAIR_TILE_STYLES = Object.freeze([
  'Bald', 'Short Hair', 'Sharp Bob', 'Sculpted Waves', 'Sculptural Wave Tower', 'Monumental Hair', 'Cube Cut', 'Sphere Cut',
  'Wedge Cut', 'Tabletop', 'Spiral Tower', 'Twin Discs', 'Zigzag Cut', 'Anvil Cut', 'Donut Halo',
  'Tube Tower', 'Shelf Cut', 'Long Hair', 'Afro', 'Punk', 'Buzz Cut', 'Bowl Cut', 'Mullet',
  'Braids', 'Pigtails', 'Perm', 'Beehive', 'Pixie Cut', 'Ponytail', 'Top Knot', 'Undercut',
  'Pompadour', 'Cornrows', 'Locs', 'Fur / Mane', 'Tentacles', 'Flowers', 'Crescent Cut', 'Spines', 'Antennae',
]);

const TILE_SET = new Set(HAIR_TILE_STYLES);

/** File-safe name of a hairstyle: lower case, runs of other characters become one dash ("Fur / Mane" is "fur-mane"). */
export const hairTileSlug = (style) => String(style).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The picture for a hairstyle, or '' when it has none yet. */
export const hairTileSrc = (style) => (TILE_SET.has(style) ? `/oddlings/hair/${hairTileSlug(style)}.webp` : '');
