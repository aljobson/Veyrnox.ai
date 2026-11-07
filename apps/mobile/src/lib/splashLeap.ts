// Where the little Vey goes after it has become the dot of the i: it hops off the i and lands in the slot where the large Vey
// stands. Pure numbers (window coordinates in, screen-point displacements out), so the jump is testable without rendering.
export type Point = { x: number; y: number };
export type Slot = { x: number; y: number; width: number; height: number };
/** dx and dy move the mascot's feet from the dot to the slot; scale multiplies its dot size up to the large size. */
export type Leap = { dx: number; dy: number; scale: number };

const FEET_IN_SLOT = 0.96; // the large Vey's feet sit just above the bottom of its slot
const FIGURE_IN_SLOT = 0.86; // the drawn figure fills this much of the slot's height

export function leapTarget(feet: Point, slot: Slot, dotHeight: number): Leap {
    return {
        dx: slot.x + slot.width / 2 - feet.x,
        dy: slot.y + slot.height * FEET_IN_SLOT - feet.y,
        scale: (slot.height * FIGURE_IN_SLOT) / dotHeight,
    };
}
