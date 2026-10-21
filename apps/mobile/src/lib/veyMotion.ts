// Where and when Vey moves on its own in the app: a hop as a list scrolls, a cheer when tapped, and the moods of the
// companion beside the credit packs and the unlock card. The same rules as the web (lib/veyMotion.js). Motion only:
// nothing here buys, grants or changes anything.
export type VeyMood = 'idle' | 'hop' | 'cheer' | 'worried';

// How far a list must scroll before Vey hops, and the pause between hops, so a long scroll is a few hops, not a buzz.
export const HOP_SCROLL_PX = 360;
export const HOP_COOLDOWN_MS = 1800;
export const HOP_MS = 900;
export const CHEER_MS = 1100;
// While a paywall is open and quiet, Vey hops now and then so the packs have company.
export const AMBIENT_HOP_MS = 9000;

export type ScrollState = { y: number; travelled: number; lastHopAt: number };
export const INITIAL_SCROLL: ScrollState = { y: 0, travelled: 0, lastHopAt: -HOP_COOLDOWN_MS };

// Direction does not matter, only how far the list moved since the last hop.
export function nextScrollState(state: ScrollState, y: number, now: number): { state: ScrollState; hop: boolean } {
    const travelled = state.travelled + Math.abs(y - state.y);
    if (travelled >= HOP_SCROLL_PX && now - state.lastHopAt >= HOP_COOLDOWN_MS) return { state: { y, travelled: 0, lastHopAt: now }, hop: true };
    return { state: { y, travelled, lastHopAt: state.lastHopAt }, hop: false };
}

export type PaywallEvent = 'welcomeFirst' | 'welcomeLow' | 'select' | 'checkout' | 'credited' | 'error' | 'ambient';

// What the companion does for each thing the reader does. `holdMs` is how long the mood lasts before Vey settles back
// to idle; 0 keeps it until the next event (a store sheet is open).
export const PAYWALL_MOODS: Record<PaywallEvent, { mood: VeyMood; holdMs: number }> = {
    welcomeFirst: { mood: 'cheer', holdMs: 2200 },
    welcomeLow: { mood: 'worried', holdMs: 2600 },
    select: { mood: 'hop', holdMs: HOP_MS },
    checkout: { mood: 'idle', holdMs: 0 },
    credited: { mood: 'cheer', holdMs: 2600 },
    error: { mood: 'worried', holdMs: 2600 },
    ambient: { mood: 'hop', holdMs: HOP_MS },
};

export const paywallMoodFor = (event: PaywallEvent) => PAYWALL_MOODS[event];

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
