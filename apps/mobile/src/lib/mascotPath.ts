// Geometry for the onboarding mascot: it runs along the capitals of "VEYRNOX" one letter at a time (each letter sinks
// under its weight), steps over the dot onto the "a", then jumps onto a dotless i and stays there as the dot of the "i"
// in ".ai". Pure numbers, so the path is testable without rendering.

export const WORD = ['V', 'E', 'Y', 'R', 'N', 'O', 'X', '.', 'a', 'ı'] as const;
export const CAPS = 7; // letters 0..6 are capitals; 7 is the full stop; 8 is the a; 9 is the dotless i
export const A_INDEX = 8;
export const I_INDEX = 9;

export const MASCOT_ASPECT = 108 / 102; // assets/mascot.png (cropped to the figure), width / height

// The layered pictures in assets/vey sit on one 480 x 510 canvas; FIGURE is where the drawn figure sits on it (left, top,
// right, bottom), which is what mascot.png was cropped to. RUN is the run cycle in source pixels: how high a foot lifts,
// how far the feet scissor, how much the body bobs, and how far the arms swing (degrees), over one left-right step.
export const SOURCE = { width: 480, height: 510 } as const;
export const FIGURE = { left: 12, top: 39, right: 478, bottom: 492 } as const;
export const RUN = { lift: 48, reach: 32, bob: 11, armSwing: 64 } as const;
export const STRIDE_MS = 370; // one full left-right step; the strides land every HOP_MS, two to a step
export const DOT_SCALE = 0.55; // the mascot's size once it is the dot, against its running size
export const HOP_MS = 185; // one quick stride from letter to letter
export const LEAP_IN_MS = 520; // the first leap, in from off the left edge
export const PRESS_MS = 45; // the letter takes the weight
export const JUMP_MS = 360; // the last jump onto the i
export const HOP_HEIGHT_RATIO = 0.12; // stride height above the higher of the two perches: low, so it reads as a run
export const JUMP_HEIGHT_RATIO = 0.75;
export const SINK_RATIO = 0.075; // how far a letter sinks, against the font size
export const STEM_GAP_RATIO = 0.06; // air between the stem and the dot, in mascot heights

export type Box = { x: number; width: number };

export type WordLayout = {
    /** One box per entry of WORD, inside the row that holds the letters. */
    letters: Box[];
    /** Distances from the top of the row to the top of the capitals and to the top of the lowercase letters. */
    capTop: number;
    stemTop: number;
};

export type Stop = {
    /** Which WORD letter this stop stands on. */
    letter: number;
    x: number;
    /** Feet height before the letter takes the weight. */
    y: number;
    apexY: number;
    durationMs: number;
};

export type MascotPath = {
    mascotWidth: number;
    mascotHeight: number;
    start: { x: number; y: number };
    /** Letters the mascot stands on, in order, ending with the a. */
    stops: Stop[];
    sink: number;
    jump: { x: number; apexY: number; dotY: number };
};

const centre = (b: Box): number => b.x + b.width / 2;

export function mascotPath(layout: WordLayout, mascotHeight: number, fontSize: number): MascotPath {
    const mascotWidth = mascotHeight * MASCOT_ASPECT;
    const { letters, capTop, stemTop } = layout;
    const stands = [0, 1, 2, 3, 4, 5, 6, A_INDEX];
    let prevY = capTop;
    const stops = stands.map((letter, n): Stop => {
        const y = letter === A_INDEX ? stemTop : capTop;
        const stop: Stop = {
            letter,
            x: centre(letters[letter]),
            y,
            apexY: Math.min(prevY, y) - mascotHeight * HOP_HEIGHT_RATIO,
            durationMs: n === 0 ? LEAP_IN_MS : HOP_MS,
        };
        prevY = y;
        return stop;
    });
    return {
        mascotWidth,
        mascotHeight,
        start: { x: letters[0].x - mascotWidth * 1.6, y: capTop },
        stops,
        sink: fontSize * SINK_RATIO,
        jump: {
            x: centre(letters[I_INDEX]),
            apexY: stemTop - mascotHeight * JUMP_HEIGHT_RATIO,
            dotY: stemTop - mascotHeight * STEM_GAP_RATIO,
        },
    };
}

// Fallbacks until the text reports its real metrics (capital and x-height as a share of the font size).
export const FALLBACK_CAP_TOP = 0.2;
export const FALLBACK_STEM_TOP = 0.42;
