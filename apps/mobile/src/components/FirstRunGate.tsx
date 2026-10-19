import * as SecureStore from 'expo-secure-store';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { FIRST_RUN_SLOT, hasSeenWelcome } from '../lib/firstRun';

// Sends a person who has not seen the welcome to it, once per launch. It draws nothing. If the stored flag cannot be
// read, the person is not held up: the app opens as usual.
export function FirstRunGate() {
    const router = useRouter();
    useEffect(() => {
        let alive = true;
        SecureStore.getItemAsync(FIRST_RUN_SLOT)
            .then((raw) => {
                if (alive && !hasSeenWelcome(raw)) router.replace('/welcome');
            })
            .catch(() => {});
        return () => {
            alive = false;
        };
    }, [router]);
    return null;
}
