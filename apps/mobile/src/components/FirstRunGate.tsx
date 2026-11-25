import { usePathname, useRootNavigationState, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { firstRunDestination, isFirstRunPending, useFirstRunUser } from '../lib/firstRunPending';
import { loadFirstOnboarding } from '../lib/firstProfileStore';
import { markWelcomeSeen } from '../lib/markWelcomeSeen';
import { applyPendingPreAuthOnboarding } from '../lib/preAuthOnboarding';

const OWNED_FIRST_RUN_ROUTES = new Set(['/analytics-consent', '/welcome', '/first-run']);

// Inside the two-factor gate. firstRunDestination owns the launch-wide claim,
// consent-before-welcome order and SecureStore/appStorage fallback.
export function FirstRunGate() {
    const router = useRouter();
    const pathname = usePathname();
    const ready = !!useRootNavigationState()?.key;
    const user = useFirstRunUser();
    const { api, beginSessionTask } = useAuth();
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        // These screens own their own transition. A foreground event must not let the background account gate replace
        // consent, welcome, or the active first-run journey.
        if (!ready || user === null || OWNED_FIRST_RUN_ROUTES.has(pathname)) return;
        let alive = true;
        let retryTimer: ReturnType<typeof setTimeout> | undefined;
        const task = beginSessionTask();
        void (async () => {
            if (await applyPendingPreAuthOnboarding(api, task)) {
                if (!alive || !task.current()) return;
                await markWelcomeSeen();
                const consentDestination = await firstRunDestination();
                if (alive && task.current()) router.replace(consentDestination ?? '/');
                return;
            }
            const destination = await firstRunDestination();
            if (!alive || !task.current()) return;
            if (destination) { router.replace(destination); return; }
            // A checked consent/welcome phase returns null on later foreground passes but remains pending until its
            // owning screen finishes. Do not let account onboarding replace that screen or one of its legal routes.
            if (isFirstRunPending()) return;
            const onboarding = await loadFirstOnboarding(api, task);
            if (!alive || !task.current()) return;
            if (onboarding && !onboarding.completed && !onboarding.completeRequested) router.replace('/first-run');
            // A broken/offline account read must not leave launch in a permanent retry loop. Three bounded
            // attempts are enough for the ordinary token-refresh window; the next foreground event tries again.
            else if (!onboarding && retry < 3) retryTimer = setTimeout(() => setRetry(value => value + 1), Math.min(15000, 2000 * (retry + 1)));
        })();
        return () => { alive = false; clearTimeout(retryTimer); };
    }, [api, beginSessionTask, pathname, ready, retry, router, user]);
    useEffect(() => {
        const subscription = AppState.addEventListener('change', state => {
            if (state === 'active') setRetry(value => value + 1);
        });
        return () => subscription.remove();
    }, []);
    return null;
}
