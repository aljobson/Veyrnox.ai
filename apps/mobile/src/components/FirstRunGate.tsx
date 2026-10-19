import * as SecureStore from 'expo-secure-store';
import { useRootNavigationState, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { FIRST_RUN_SLOT, hasSeenWelcome } from '../lib/firstRun';

// Sends a person who has not seen the welcome to it, once per launch. It draws nothing and waits until navigation is
// ready, so the redirect is not lost on a cold start. If the stored flag cannot be read, the person is not held up.
export function FirstRunGate() {
    const router = useRouter();
    const ready = !!useRootNavigationState()?.key;
    const checked = useRef(false);
    useEffect(() => {
        if (!ready || checked.current) return;
        checked.current = true;
        SecureStore.getItemAsync(FIRST_RUN_SLOT)
            .then((raw) => {
                if (!hasSeenWelcome(raw)) router.replace('/welcome');
            })
            .catch(() => {});
    }, [ready, router]);
    return null;
}
