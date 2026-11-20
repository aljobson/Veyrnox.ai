import type { BlockRow, TrackPage } from './publicTypes';
export type PublicSessionState = { revision: number; account: number; availability: 'unknown' | 'on' | 'off'; blocks: readonly BlockRow[]; change: { actor_id: string; blocked: boolean } | null };
// Memory only. A revision fences every read, page and playback intent, including across mounted screens.
export function createPublicSession() {
    let state: PublicSessionState = { revision: 0, account: 0, availability: 'unknown', blocks: [], change: null };
    const tracks = new Map<string, { revision: number; page: TrackPage }>();
    const ownership = new Map<string, Promise<boolean | null>>();
    const listeners = new Set<() => void>();
    const emit = (patch: Partial<PublicSessionState>) => { if (patch.revision !== undefined && patch.revision !== state.revision) tracks.clear(); state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
    return {
        snapshot: () => state,
        rememberTrack(slug: string, page: TrackPage) { tracks.set(slug, { revision: state.revision, page }); },
        forgetTrack(slug: string) { tracks.delete(slug); },
        track(slug: string) { const cached = tracks.get(slug); return cached?.revision === state.revision ? cached.page : null; },
        ownership(id: string, read: () => Promise<boolean>) {
            const key = id.toLowerCase();
            let result = ownership.get(key);
            if (!result) {
                result = read().catch(() => { if (ownership.get(key) === result) ownership.delete(key); return null; });
                ownership.set(key, result);
            }
            return result;
        },
        subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
        blocked: (id: string) => state.blocks.some(b => b.actor_id.toLowerCase() === id.toLowerCase()),
        reset() { tracks.clear(); ownership.clear(); emit({ revision: state.revision + 1, account: state.account + 1, availability: 'unknown', blocks: [], change: null }); },
        unavailable() { tracks.clear(); if (state.availability !== 'off') emit({ revision: state.revision + 1, availability: 'off', blocks: [], change: null }); },
        available() { if (state.availability !== 'on') emit({ availability: 'on' }); },
        replace(blocks: BlockRow[]) {
            const prior = state.blocks.map(b => b.actor_id.toLowerCase()).sort().join(',');
            const next = blocks.map(b => b.actor_id.toLowerCase()).sort().join(',');
            emit({ blocks, ...(prior !== next ? { revision: state.revision + 1, change: null } : {}) });
        },
        acknowledge(id: string, blocked: boolean, name = '') {
            const rest = state.blocks.filter(b => b.actor_id.toLowerCase() !== id.toLowerCase());
            emit({ revision: state.revision + 1, change: { actor_id: id, blocked }, blocks: blocked ? [...rest, { actor_id: id, display_name: name, created_at: new Date().toISOString() }] : rest });
        },
    };
}
export type PublicSession = ReturnType<typeof createPublicSession>;
