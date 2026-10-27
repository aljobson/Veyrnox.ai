// Vey's moods, and the one-time celebration events the CelebrationHost shows. Motion only: nothing here buys, grants
// or changes anything.
export type VeyMood = 'idle' | 'hop' | 'cheer' | 'clap' | 'worried';

export type CelebrationKind = 'firstCreation' | 'firstVideo' | 'afterOnboarding';
export type CelebrationEvent = { kind: CelebrationKind; onShown: () => void; onDone: () => void };
const celebrations = new Set<(event: CelebrationEvent) => void>();
export function emitCelebration(event: CelebrationEvent): boolean {
    if (!celebrations.size) return false;
    celebrations.forEach((listener) => listener(event));
    return true;
}
export function onCelebrate(listener: (event: CelebrationEvent) => void): () => void {
    celebrations.add(listener);
    return () => {
        celebrations.delete(listener);
    };
}
