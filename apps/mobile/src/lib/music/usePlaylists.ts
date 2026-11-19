import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../auth/AuthProvider';
import { subscribeCacheUser } from '../appCache';
import { createPlaylistFlow } from './playlistFlow';
export function usePlaylists(id?: string) {
    const { api } = useAuth();
    const [flow, setFlow] = useState(() => createPlaylistFlow(api, id));
    const [state, setState] = useState(flow.snapshot);
    useFocusEffect(useCallback(() => {
        let active = true, current = createPlaylistFlow(api, id), unsubscribe = () => {};
        const bind = () => {
            setFlow(current); setState(current.snapshot());
            unsubscribe = current.subscribe(() => { if (active) setState(current.snapshot()); });
            void current.load();
        };
        bind();
        const off = subscribeCacheUser(() => { unsubscribe(); current.dispose(); current = createPlaylistFlow(api, id); bind(); });
        return () => { active = false; off(); unsubscribe(); current.dispose(); };
    }, [api, id]));
    return { flow, state };
}
