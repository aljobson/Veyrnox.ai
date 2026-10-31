// Vey's moods, and the one-time celebration events the CelebrationHost shows. Motion only: nothing here buys, grants
// or changes anything.
export type VeyMood = 'idle' | 'hop' | 'cheer' | 'clap' | 'worried' | 'working' | 'wave';

export type CelebrationKind = 'firstCreation' | 'firstVideo' | 'afterOnboarding';
export type CelebrationEvent = { onShown: () => void; onDone: () => void } & (
    { kind: CelebrationKind } | { kind: 'winsMilestone'; milestone: import('./yourWins').MilestoneKey }
);
let outstanding = 0;
const idleListeners = new Set<() => void>();
export const celebrationBusy = () => outstanding > 0;
export function onCelebrationIdle(listener: () => void): () => void {
    idleListeners.add(listener);
    return () => { idleListeners.delete(listener); };
}
const celebrations = new Set<(event: CelebrationEvent) => void>();
export function emitCelebration(event: CelebrationEvent): boolean {
    if (!celebrations.size) return false;
    outstanding++;
    let finished = false;
    const tracked = { ...event, onDone: () => {
        if (finished) return;
        finished = true;
        outstanding--;
        event.onDone();
        if (!outstanding) idleListeners.forEach(listener => listener());
    } };
    celebrations.forEach((listener) => listener(tracked));
    return true;
}
export function onCelebrate(listener: (event: CelebrationEvent) => void): () => void {
    celebrations.add(listener);
    return () => {
        celebrations.delete(listener);
    };
}

const winsCancellations = new Set<() => void>();
export function onCancelWinsCelebrations(listener: () => void): () => void {
    winsCancellations.add(listener);
    return () => { winsCancellations.delete(listener); };
}
export function cancelWinsCelebrations(): void {
    winsCancellations.forEach(listener => listener());
}

// Isolate event-bus state between tests after unmounting every host.
export function resetCelebrationsForTests(): void {
    outstanding = 0;
    celebrations.clear();
    idleListeners.clear();
    winsCancellations.clear();
}
