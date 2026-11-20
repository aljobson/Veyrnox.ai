import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../auth/AuthProvider';
import { subscribeCacheUser } from '../appCache';
import { createPlaylistFlow } from './playlistFlow';
export function usePlaylists(id?: string) {
    const { api } = useAuth();
    const [flow, setFlow] = useState(() => createPlaylistFlow(api, id));
    const [state, setState] = useState(flow.snapshot);
    const ref = useRef(flow);
    useEffect(() => {
        let active = true, current = createPlaylistFlow(api, id), unsubscribe = () => {};
        const bind = () => {
            ref.current = current; setFlow(current); setState(current.snapshot());
            unsubscribe = current.subscribe(() => { if (active) setState(current.snapshot()); });
        };
        bind();
        const off = subscribeCacheUser(() => {
            unsubscribe(); current.dispose(); current = createPlaylistFlow(api, id); bind(); void current.load();
        });
        return () => { active = false; off(); unsubscribe(); current.dispose(); };
    }, [api, id]);
    useFocusEffect(useCallback(() => {
        void ref.current.load();
        // Keep write attempts across navigation, but never keep a cleanup scan after leaving.
        return () => ref.current.invalidateScan();
    }, [api, id]));
    return { flow, state };
}
