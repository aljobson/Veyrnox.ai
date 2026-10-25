// Vey, the web's character (app/veyrnox/_components/VeyCharacter.jsx), drawn once as seven pictures on the same
// 160 x 170 canvas so they line up when stacked. Each moving part turns about a point; the points below are the ones
// the web uses (the neck for the head, the shoulders for the arms, the middle for the eyes and the glowing core).
export const CANVAS = { width: 160, height: 170 } as const;

export const LAYERS = ['base', 'left-arm', 'right-arm', 'body', 'core', 'head', 'eyes'] as const;

export const PIVOTS = {
    head: { x: 80, y: 96 },
    leftArm: { x: 51, y: 98 },
    rightArm: { x: 108, y: 67 },
    eyes: { x: 80, y: 56 },
    core: { x: 80, y: 112 },
} as const;

export type Pivot = keyof typeof PIVOTS;

// The canvas row where a card's top edge cuts a peeking Vey: the paws rest here, the chin stays behind the card.
export const PEEK_CROP = 79;

export const heightFor = (width: number) => (width * CANVAS.height) / CANVAS.width;

// The turning point at the size the character is drawn at, as a style.
export function pivotStyle(part: Pivot, width: number) {
    const k = width / CANVAS.width;
    return { transformOrigin: `${PIVOTS[part].x * k}px ${PIVOTS[part].y * k}px` } as const;
}
