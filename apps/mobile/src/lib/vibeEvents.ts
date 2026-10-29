const changes = new Set<() => void>();
const idle = new Set<() => void>();
export function subscribeVibe(listener: () => void): () => void {
    changes.add(listener);
    return () => { changes.delete(listener); };
}
export function notifyVibeChanged(): void { changes.forEach(listener => listener()); }
export function subscribeVibeIdle(listener: () => void): () => void {
    idle.add(listener);
    return () => { idle.delete(listener); };
}
export function notifyVibeIdle(): void { idle.forEach(listener => listener()); }
