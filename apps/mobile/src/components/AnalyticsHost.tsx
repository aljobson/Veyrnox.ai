import { useEffect } from 'react';
import { AppState } from 'react-native';
import { captureEvent, startAnalytics } from '../lib/analytics';
import { useScreenTracking } from '../lib/analytics/useScreenTracking';
export function AnalyticsHost() {
    useScreenTracking();
    useEffect(() => {
        void startAnalytics();
        let previous = AppState.currentState;
        const sub = AppState.addEventListener('change', state => {
            if (state === previous) return;
            if (state === 'background') captureEvent('app_backgrounded');
            if (state === 'active') captureEvent('app_opened', { cold: false });
            previous = state;
        });
        return () => sub.remove();
    }, []);
    return null;
}
