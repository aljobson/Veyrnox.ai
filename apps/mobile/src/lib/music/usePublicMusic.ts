import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../auth/AuthProvider';
import { subscribeCacheUser } from '../appCache';
import type { ApiClient } from '../api';
import { createPublicSession } from './publicSession';
import { createPublicFlow, type PublicTarget } from './publicFlow';
import { getBlocks } from './blocksClient';
const sessions = new WeakMap<ApiClient, ReturnType<typeof createPublicSession>>();
export function publicSessionFor(api: ApiClient) {
    let session = sessions.get(api);
    if (!session) { session = createPublicSession(); sessions.set(api, session); subscribeCacheUser(() => session!.reset()); }
    return session;
}
export function usePublicSession() {
    const { api } = useAuth(); const session = publicSessionFor(api);
    const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
    return { api, session, state };
}
export function usePublicMusic(target: PublicTarget) {
    const { api, session } = usePublicSession();
    const key = target.kind === 'track' ? target.slug : target.kind === 'creator' ? target.handle : '';
    const kind = target.kind, before = target.kind === 'track' ? target.before : undefined;
    const flow = useMemo(() => createPublicFlow(api, session, kind === 'track' ? { kind, slug: key, before } : kind === 'creator' ? { kind, handle: key } : { kind }), [api, session, kind, key, before]);
    const state = useSyncExternalStore(flow.subscribe, flow.snapshot, flow.snapshot);
    useEffect(() => () => flow.dispose(), [flow]);
    useFocusEffect(useCallback(() => { flow.focus(); void getBlocks(api, session).catch(() => {}); return () => flow.blur(); }, [flow, api, session]));
    return { api, flow, state, session };
}
