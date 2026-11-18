import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { getCacheUser, subscribeCacheUser } from '../appCache';
import type { ApiClient } from '../api';
import { createMusicCreateFlow } from './createFlow';
import { createGenerationTracker } from './queue';
let session: ReturnType<typeof createMusicCreateFlow> | null = null;
subscribeCacheUser(() => { session?.dispose(); session = null; });
function getSession(api: ApiClient) {
    if (!session) session = createMusicCreateFlow(api, createGenerationTracker({ api, initialAppState: AppState.currentState,
        subscribeAppState(fn) { const listener = AppState.addEventListener('change', fn); return () => listener.remove(); } }));
    return session;
}
export function useMusicCreate() {
    const { api } = useAuth();
    const user = useSyncExternalStore(subscribeCacheUser, getCacheUser, getCacheUser);
    const flow = getSession(api);
    const state = useSyncExternalStore(flow.subscribe, flow.snapshot, flow.snapshot);
    const pending = useSyncExternalStore(flow.attempts.subscribe, flow.attempts.snapshot, flow.attempts.snapshot);
    const queue = useSyncExternalStore(flow.tracker.subscribe, flow.tracker.snapshot, flow.tracker.snapshot);
    useEffect(() => { if (user) void flow.load(); }, [flow, user]);
    useEffect(() => { if (user && state.input.mode === 'custom') void flow.loadDraft(); }, [flow, user, state.input.mode]);
    return { flow, state, pending, queue };
}
