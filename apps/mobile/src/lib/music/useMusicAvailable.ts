import { useCallback, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../auth/AuthProvider';
import { getCacheUser, subscribeCacheUser } from '../appCache';
import { listSongs } from './client';
import { probeMusic } from './probe';

// One in-memory value for the current account, retained across screen mounts/focuses.
// appCache broadcasts sign-out/account changes even while no music entry is mounted.
let owner = getCacheUser();
let available = false;
let generation = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
subscribeCacheUser(() => {
    owner = getCacheUser(); available = false; generation++;
    notify();
});
const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};
const snapshot = () => Boolean(owner && owner === getCacheUser() && available);

export function useMusicAvailable(): boolean {
    const { api } = useAuth();
    const user = useSyncExternalStore(subscribeCacheUser, getCacheUser, getCacheUser);
    const visible = useSyncExternalStore(subscribe, snapshot, snapshot);
    useFocusEffect(useCallback(() => {
        if (!user) return;
        let live = true;
        const ticket = generation;
        void probeMusic(() => listSongs(api, { limit: 1 })).then(result => {
            if (!live || ticket !== generation || user !== getCacheUser()) return;
            if (result.state === 'on') available = true;
            else if (result.state === 'off') { available = false; generation++; }
            else return; // An error says nothing new about the last known availability.
            notify();
        });
        return () => { live = false; };
    }, [api, user]));
    return visible;
}
