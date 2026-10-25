// Where and when Vey moves on its own in the app: a hop as a list scrolls and a cheer when tapped. The same rules as
// the web (lib/veyMotion.js). Motion only: nothing here buys, grants or changes anything.
export type VeyMood = 'idle' | 'hop' | 'cheer' | 'worried';

// How far a list must scroll before Vey hops, and the pause between hops, so a long scroll is a few hops, not a buzz.
export const HOP_SCROLL_PX = 360;
export const HOP_COOLDOWN_MS = 1800;
export const HOP_MS = 900;
export const CHEER_MS = 1100;

export type ScrollState = { y: number; travelled: number; lastHopAt: number };
export const INITIAL_SCROLL: ScrollState = { y: 0, travelled: 0, lastHopAt: -HOP_COOLDOWN_MS };

// Direction does not matter, only how far the list moved since the last hop.
export function nextScrollState(state: ScrollState, y: number, now: number): { state: ScrollState; hop: boolean } {
    const travelled = state.travelled + Math.abs(y - state.y);
    if (travelled >= HOP_SCROLL_PX && now - state.lastHopAt >= HOP_COOLDOWN_MS) return { state: { y, travelled: 0, lastHopAt: now }, hop: true };
    return { state: { y, travelled, lastHopAt: state.lastHopAt }, hop: false };
}

// The floating Vey listens for reactions that screens ask for (a scroll, a tap) without knowing about each other.
type Reaction = (mood: VeyMood, ms: number) => void;
const listeners = new Set<Reaction>();

export function reactVey(mood: VeyMood, ms: number) {
    listeners.forEach((listener) => listener(mood, ms));
}

export function onVeyReaction(listener: Reaction) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
