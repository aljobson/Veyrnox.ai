import { useEffect } from 'react';
import { AppState } from 'react-native';
import { startOfflineRecovery } from './offlineRecovery';
export function useOfflineRecovery() {
    useEffect(() => startOfflineRecovery({
        active: () => AppState.currentState === 'active',
        subscribe: listener => {
            const sub = AppState.addEventListener('change', state => listener(state === 'active'));
            return () => sub.remove();
        },
    }), []);
}
