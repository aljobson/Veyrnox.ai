import { useEffect } from 'react';
import { AppState } from 'react-native';
import { beatStore } from './store';

/** Local saving is independent of authentication and the cloud rollout. */
export function useLocalBeatLifecycle() {
    useEffect(() => {
        void beatStore.hydrateBeats().catch(() => undefined);
        const flush = () => { void beatStore.flushBeats().catch(() => undefined); };
        const subscription = AppState.addEventListener('change', state => { if (state !== 'active') flush(); });
        return () => { subscription.remove(); flush(); };
    }, []);
}
