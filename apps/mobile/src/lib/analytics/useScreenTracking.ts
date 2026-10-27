import { useEffect, useSyncExternalStore } from 'react';
import { useSegments } from 'expo-router';
import { getAnalyticsChoice, subscribeConsent } from './consent';
import { captureScreen, startAnalytics } from './client';
import { routePattern } from './events';
export function useScreenTracking() {
    const pattern = routePattern(useSegments());
    const choice = useSyncExternalStore(subscribeConsent, getAnalyticsChoice);
    useEffect(() => {
        let live = true;
        if (choice === 'granted') void startAnalytics().then(() => { if (live) captureScreen(pattern); });
        return () => { live = false; };
    }, [pattern, choice]);
}
