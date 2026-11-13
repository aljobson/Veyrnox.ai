// Pure maths for the ruler-style dial (the Apple Photos "Adjust" control). Kept free of React so it can be tested alone.
export const TICKS = 50; // one tick per 2%
export const SPACING = 10; // points between ticks
export const RULER = TICKS * SPACING;
const HAPTIC_STEP = 0.05;

export const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);
/** Where the ruler's left edge sits so that `value` lies under the needle at the centre of a window `width` wide. */
export const offsetFor = (value: number, width: number): number => width / 2 - clamp01(value) * RULER;
/** Dragging the ruler to the right moves the needle towards lower values, like a physical ruler. */
export const valueAfterDrag = (start: number, dx: number): number => clamp01(start - dx / RULER);
export const percentOf = (value: number): number => Math.round(clamp01(value) * 100);
/** A haptic tick fires each time the value crosses a 5% line. */
export const crossedStep = (from: number, to: number): boolean => Math.floor(clamp01(from) / HAPTIC_STEP + 1e-9) !== Math.floor(clamp01(to) / HAPTIC_STEP + 1e-9);
export const isMajorTick = (index: number): boolean => index % 5 === 0;
/** Screen-reader and keyboard step: ten percent, same as the slider this replaces. */
export const nudge = (value: number, direction: 'increment' | 'decrement'): number => clamp01(value + (direction === 'increment' ? 0.1 : -0.1));
