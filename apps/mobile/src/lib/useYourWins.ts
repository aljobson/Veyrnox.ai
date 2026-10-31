import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../auth/AuthProvider';
import { getCacheUser, subscribeCacheUser } from './appCache';
import { fetchYourWins, YOUR_WINS_ENABLED, type YourWins } from './yourWins';
import { cancelWinsCelebrations } from './veyMotion';
import { winsCoordinator } from './yourWinsCelebrations';
const useWinsFocus = YOUR_WINS_ENABLED ? useFocusEffect : useEffect;
export function useYourWins(celebrate = false) {
    const { api } = useAuth();
    const owner = useSyncExternalStore(subscribeCacheUser, getCacheUser, getCacheUser);
    const [state, setState] = useState<{ owner: string; data: YourWins | null } | null>(null);
    useWinsFocus(useCallback(() => {
        if (!YOUR_WINS_ENABLED || !owner) return;
        let live = true;
        const read = async () => {
            const data = await fetchYourWins(api, fresh => {
                if (live && owner === getCacheUser() && celebrate) void winsCoordinator.update(owner, fresh);
            });
            if (!live || owner !== getCacheUser()) return;
            setState({ owner, data });
            if (celebrate) {
                if (!data) cancelWinsCelebrations();
            }
        };
        void read();
        const off = AppState.addEventListener('change', state => { if (state === 'active') void read(); });
        return () => { live = false; off.remove(); };
    }, [api, owner, celebrate]));
    const current = state?.owner === owner ? state : null;
    return { data: YOUR_WINS_ENABLED ? current?.data ?? null : null,
        loading: Boolean(YOUR_WINS_ENABLED && owner && !current) };
}
