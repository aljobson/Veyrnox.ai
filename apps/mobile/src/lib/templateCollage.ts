// Layout for the Explore templates collage: overlapping tiles of mixed sizes in one swipeable row. As a tile passes the
// middle of the screen it grows and squares up; the ones either side shrink, fade and turn away, like a rolodex. Pure
// numbers, so the shapes and the curves are testable without rendering.

// How far one swipe step moves, in points. Tiles are wider than this, so neighbours overlap.
export const STEP = 100;
// Height of the band the collage lives in: room for the tallest tile and its stagger.
export const BAND_HEIGHT = 372;

export type TileShape = { readonly width: number; readonly height: number; readonly top: number };

// An unavailable template stays in the collage, but its preview is subdued before the card explains why it cannot open Create.
export const posterOpacity = (available: boolean): number => (available ? 1 : 0.55);

// A few shapes, cycled by position so the row looks like a collage and not a strip. A video is always one of the tall
// shapes, because it is shown in portrait.
const WIDE: readonly TileShape[] = [
    { width: 188, height: 214, top: 74 },
    { width: 168, height: 190, top: 96 },
    { width: 176, height: 232, top: 56 },
];
const TALL: readonly TileShape[] = [
    { width: 164, height: 300, top: 36 },
    { width: 180, height: 330, top: 14 },
    { width: 158, height: 278, top: 52 },
];

export function tileShape(index: number, tall: boolean): TileShape {
    const set = tall ? TALL : WIDE;
    return set[((index % set.length) + set.length) % set.length];
}

// What a tile does at a distance from the middle, in steps (0 is centred, 1 is the next one along, and so on).
// Both sides use the same numbers; the turn flips sign by side.
export const TILE_CURVE = {
    distances: [-2, -1, 0, 1, 2],
    scale: [0.76, 0.88, 1, 0.88, 0.76],
    opacity: [0.5, 0.82, 1, 0.82, 0.5],
    turnDeg: [40, 26, 0, -26, -40],
    lift: [20, 8, 0, 8, 20],
} as const;

// The scroll offsets at which tile `index` sits at each distance in TILE_CURVE.
export const offsetsFor = (index: number, step: number = STEP): number[] => TILE_CURVE.distances.map((d) => (index + d) * step);

// Which tile is nearest the middle for a scroll offset, kept inside the list.
export function centredIndex(offset: number, count: number, step: number = STEP): number {
    if (count <= 0) return 0;
    return Math.min(count - 1, Math.max(0, Math.round(offset / step)));
}

// Draw order: the centred tile on top, then the ones next to it, so the stack reads as a fan.
export const stackOrder = (index: number, centred: number): number => 1000 - Math.abs(index - centred) * 10;
