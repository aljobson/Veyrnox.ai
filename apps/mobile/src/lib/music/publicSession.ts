import type { BlockRow } from './publicTypes';
export type PublicSessionState = { revision: number; account: number; availability: 'unknown' | 'on' | 'off'; blocks: readonly BlockRow[] };
// Memory only. A revision fences every read, page and playback intent, including across mounted screens.
export function createPublicSession() {
    let state: PublicSessionState = { revision: 0, account: 0, availability: 'unknown', blocks: [] };
    const listeners = new Set<() => void>();
    const emit = (patch: Partial<PublicSessionState>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
    return {
        snapshot: () => state,
        subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
        blocked: (id: string) => state.blocks.some(b => b.actor_id.toLowerCase() === id.toLowerCase()),
        reset() { emit({ revision: state.revision + 1, account: state.account + 1, availability: 'unknown', blocks: [] }); },
        unavailable() { if (state.availability !== 'off') emit({ revision: state.revision + 1, availability: 'off', blocks: [] }); },
        available() { if (state.availability !== 'on') emit({ availability: 'on' }); },
        replace(blocks: BlockRow[]) {
            const prior = state.blocks.map(b => b.actor_id.toLowerCase()).sort().join(',');
            const next = blocks.map(b => b.actor_id.toLowerCase()).sort().join(',');
            emit({ blocks, ...(prior !== next ? { revision: state.revision + 1 } : {}) });
        },
        acknowledge(id: string, blocked: boolean, name = '') {
            const rest = state.blocks.filter(b => b.actor_id.toLowerCase() !== id.toLowerCase());
            emit({ revision: state.revision + 1, blocks: blocked ? [...rest, { actor_id: id, display_name: name, created_at: new Date().toISOString() }] : rest });
        },
    };
}
export type PublicSession = ReturnType<typeof createPublicSession>;
