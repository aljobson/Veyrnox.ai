import { useRootNavigationState, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { firstRunDestination, useFirstRunUser } from '../lib/firstRunPending';
import { useAuth } from '../auth/AuthProvider';
import { loadFirstOnboarding } from '../lib/firstProfileStore';

// Inside the two-factor gate. firstRunDestination owns the launch-wide claim,
// consent-before-welcome order and SecureStore/appStorage fallback.
export function FirstRunGate() {
    const router = useRouter();
    const ready = !!useRootNavigationState()?.key;
    const user = useFirstRunUser();
    const { api, beginSessionTask } = useAuth();
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        if (!ready || user === null) return;
        let retryTimer: ReturnType<typeof setTimeout> | undefined;
        const task = beginSessionTask();
        void firstRunDestination().then(async destination => {
            if (!task.current()) return;
            if (destination) { router.replace(destination); return; }
            const onboarding = await loadFirstOnboarding(api, task);
            if (task.current() && onboarding && !onboarding.completed && !onboarding.completeRequested) router.replace('/first-run');
            // A broken/offline account read must not leave launch in a permanent retry loop. Three bounded
            // attempts are enough for the ordinary token-refresh window; the next foreground event tries again.
            else if (task.current() && !onboarding && retry < 3) retryTimer = setTimeout(() => setRetry(value => value + 1), Math.min(15000, 2000 * (retry + 1)));
        });
        return () => clearTimeout(retryTimer);
    }, [api, beginSessionTask, ready, retry, router, user]);
    useEffect(() => {
        const subscription = AppState.addEventListener('change', state => {
            if (state === 'active') setRetry(value => value + 1);
        });
        return () => subscription.remove();
    }, []);
    return null;
}
