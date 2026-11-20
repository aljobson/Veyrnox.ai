import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { createSongActionFlow } from '../../lib/music/actionFlow';
import type { ActionSpec } from '../../lib/music/actionTypes';

export function useSongActionScreen<R extends { balance_after?: number }, S>(id: string, makeSpec: (id: string) => ActionSpec<R, S>) {
    const { api } = useAuth();
    const user = useSyncExternalStore(subscribeCacheUser, getCacheUser, getCacheUser);
    // Disposed flows never revive: StrictMode and Fast Refresh need a fresh generation.
    const [generation, setGeneration] = useState(0);
    const flow = useMemo(() => createSongActionFlow(api, makeSpec(id), id), [api, id, user, generation, makeSpec]);
    const state = useSyncExternalStore(flow.subscribe, flow.snapshot, flow.snapshot);
    const pending = useSyncExternalStore(flow.attempts.subscribe, flow.attempts.snapshot, flow.attempts.snapshot);
    useEffect(() => {
        if (!flow.isLive()) { setGeneration(g => g + 1); return; }
        if (user) void flow.load();
        return flow.dispose;
    }, [flow, user]);
    return { api, user, flow, state, pending };
}
