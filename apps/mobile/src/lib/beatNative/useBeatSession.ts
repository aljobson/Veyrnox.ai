import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { userIdFromToken } from '../appCache';
import { BeatCloudSync } from './cloudSync';
import { beatStore } from './store';

export function useBeatSession(id: string) {
    const { api, getAccessToken, generation } = useAuth();
    const sync = useMemo(() => new BeatCloudSync(api, beatStore, id), [api, id, generation]);
    const view = useSyncExternalStore(sync.subscribe, sync.snapshot, sync.snapshot);
    useEffect(() => {
        let live = true;
        void (async () => {
            await beatStore.hydrateBeats().catch(() => undefined);
            const token = await getAccessToken?.().catch(() => null);
            if (live) await sync.start(token ? userIdFromToken(token) : null);
        })();
        const subscription = AppState.addEventListener('change', state => {
            if (state !== 'active') {
                void sync.cycle('autosave', true);
            }
        });
        return () => {
            live = false; subscription.remove(); sync.dispose();
        };
    }, [sync, getAccessToken]);
    return { sync, view };
}
