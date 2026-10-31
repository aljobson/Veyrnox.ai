import { AppState } from 'react-native';
import { appCache, getCacheUser, subscribeCacheUser } from './appCache';
import { emitCelebration, celebrationBusy, onCelebrationIdle, type CelebrationEvent } from './veyMotion';
import { checkinDialogOpen, onCheckinVisibilityChange } from './checkinVisibility';
import { YOUR_WINS_ENABLED, winsSeenDiff, winsSeenPolicy, type YourWins } from './yourWins';
// Pure coordinator dependencies allow the race with legacy producers to be exercised without a screen.
export function createWinsCoordinator(deps: {
    owner: () => string | undefined; busy: () => boolean;
    read: (owner: string) => Promise<string[] | null>; write: (owner: string, seen: string[]) => Promise<unknown>;
    emit: (event: CelebrationEvent) => boolean;
}) {
    let latest: { owner: string; data: YourWins } | null = null;
    let used = false, epoch = 0;
    let serial = Promise.resolve();
    const memory = new Map<string, string[]>();
    function recheck() {
        serial = serial.then(async () => {
            const item = latest, ticket = epoch;
            if (!item || item.owner !== deps.owner()) return;
            const seen = memory.get(item.owner) ?? await deps.read(item.owner);
            if (ticket !== epoch || latest !== item || item.owner !== deps.owner()) return;
            const diff = winsSeenDiff(item.data.milestones, seen);
            const persist = (keys: string[]) => {
                memory.set(item.owner, keys);
                void deps.write(item.owner, keys).catch(() => undefined);
            };
            // Seed existing accounts and skip the milestones covered by legacy producers immediately.
            const silent = seen === null ? diff.seen : [...new Set([...seen, ...item.data.milestones
                .filter(m => m.reached_at && (m.key === 'first_image' || m.key === 'first_video')).map(m => m.key)])];
            if (seen === null || silent.length !== seen.length) persist(silent);
            if (!diff.newest || used) return;
            if (checkinDialogOpen() || deps.busy() || AppState.currentState === 'background' || AppState.currentState === 'inactive') return;
            // Admission reserves this candidate, but only the host's onShown acknowledges it.
            let shown = false;
            deps.emit({ kind: 'winsMilestone', milestone: diff.newest.key,
                onShown: () => {
                    if (shown || item.owner !== deps.owner()) return;
                    shown = true; used = true; persist(diff.seen);
                },
                onDone: () => { if (latest === item) latest = null; },
            });
        }).catch(() => undefined);
        return serial;
    }
    return {
        update(owner: string, data: YourWins | null) { latest = data ? { owner, data } : null; return recheck(); },
        recheck,
        foreground() { used = false; latest = null; epoch++; },
        clear() { latest = null; used = false; memory.clear(); epoch++; },
    };
}
export const winsCoordinator = createWinsCoordinator({
    owner: getCacheUser, busy: celebrationBusy, emit: emitCelebration,
    read: async owner => {
        const saved = (await appCache.read<string[]>(winsSeenPolicy, owner))?.value;
        return Array.isArray(saved) && saved.every(v => typeof v === 'string') ? saved : null;
    },
    write: async (owner, seen) => { if (owner === getCacheUser()) await appCache.write(winsSeenPolicy, seen, owner); },
});
if (YOUR_WINS_ENABLED) {
    let lastState = AppState.currentState;
    AppState.addEventListener('change', state => {
        if (state === 'active' && lastState !== 'active') void winsCoordinator.foreground();
        lastState = state;
    });
    // Let an existing producer finish its onDone chain before deciding what to show.
    onCelebrationIdle(() => { setTimeout(() => void winsCoordinator.recheck(), 0); });
    onCheckinVisibilityChange(() => { if (!checkinDialogOpen()) void winsCoordinator.recheck(); });
    subscribeCacheUser(() => winsCoordinator.clear());
}
