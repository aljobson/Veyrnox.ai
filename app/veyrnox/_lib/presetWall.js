// Bento layout for the landing preset wall. Kept out of the component so the
// "no empty cell" rule is unit-tested (tests/presetWall.test.mjs).
//
// Seven presets: one hero (2x2) leading, four tiles filling the rest of the
// top two rows, then two wide tiles closing the grid. 4+4+4 = 12 cells = 3
// full rows of 4. On a phone (2 columns) the hero takes a full row, and the
// six others pair up, so nothing is left over.
//
// Any other count falls back to a uniform grid. That is only a safety net: the
// test fails for a count that leaves a hole, so adding or removing a preset
// means reshaping this on purpose.

export const LG_COLUMNS = 4;
export const SM_COLUMNS = 2;

const HERO = { kind: 'hero', lgCols: 2, lgRows: 2, smCols: 2 };
const TILE = { kind: 'tile', lgCols: 1, lgRows: 1, smCols: 1 };
const WIDE = { kind: 'wide', lgCols: 2, lgRows: 1, smCols: 1 };

export function wallShapes(count) {
  if (count === 7) return [HERO, TILE, TILE, TILE, TILE, WIDE, WIDE];
  return Array.from({ length: count }, () => TILE);
}

// Full class strings, not built from parts: Tailwind only ships classes it can
// read literally in the source.
// On desktop the rows have a fixed height (see PresetWall's auto-rows) and every
// tile fills its area, so the hero is two rows tall and the wall stays about
// 680 px instead of growing with the width. On a phone tiles keep an aspect.
const TILE_CLASSES = {
  hero: {
    link: 'col-span-2 lg:col-span-2 lg:row-span-2 lg:h-full',
    media: 'aspect-[16/9] lg:aspect-auto lg:h-full',
  },
  tile: { link: 'col-span-1 lg:h-full', media: 'aspect-[4/3] lg:aspect-auto lg:h-full' },
  wide: { link: 'col-span-1 lg:col-span-2 lg:h-full', media: 'aspect-[4/3] lg:aspect-auto lg:h-full' },
};

export function tileClasses(shape) {
  return TILE_CLASSES[shape.kind];
}
