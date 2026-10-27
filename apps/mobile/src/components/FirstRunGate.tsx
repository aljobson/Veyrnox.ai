import { useRootNavigationState, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { firstRunDestination, useFirstRunUser } from '../lib/firstRunPending';

// Inside the two-factor gate. firstRunDestination owns the launch-wide claim,
// consent-before-welcome order and SecureStore/appStorage fallback.
export function FirstRunGate() {
    const router = useRouter();
    const ready = !!useRootNavigationState()?.key;
    const user = useFirstRunUser();
    useEffect(() => {
        if (!ready || user === null) return;
        void firstRunDestination().then(destination => { if (destination) router.replace(destination); });
    }, [ready, router, user]);
    return null;
}
