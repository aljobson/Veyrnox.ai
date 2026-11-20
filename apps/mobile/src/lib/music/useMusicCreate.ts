import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../auth/AuthProvider';
import { getCacheUser, subscribeCacheUser } from '../appCache';
import { getMusicCreateSession } from './createSession';
export function useMusicCreate() {
    const { api } = useAuth();
    const user = useSyncExternalStore(subscribeCacheUser, getCacheUser, getCacheUser);
    const flow = getMusicCreateSession(api);
    const state = useSyncExternalStore(flow.subscribe, flow.snapshot, flow.snapshot);
    const pending = useSyncExternalStore(flow.attempts.subscribe, flow.attempts.snapshot, flow.attempts.snapshot);
    const queue = useSyncExternalStore(flow.tracker.subscribe, flow.tracker.snapshot, flow.tracker.snapshot);
    useEffect(() => { if (user) void flow.load(); }, [flow, user]);
    useFocusEffect(useCallback(() => { if (user) void flow.refreshEntitlements(); }, [flow, user]));
    useEffect(() => { if (user && state.input.mode === 'custom') void flow.loadDraft(); }, [flow, user, state.input.mode]);
    return { flow, state, pending, queue };
}
