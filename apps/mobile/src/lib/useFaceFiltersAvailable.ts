import { useCallback, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { fetchCatalogCached } from './media';
import { faceFilters } from './faceFilters';

// One public catalog result for every entry point. Keep the last known value
// through focus/refetch; only a catalog response changes availability.
let available = false;
let pending: Promise<unknown> | null = null;
const listeners = new Set<() => void>();
const snapshot = () => available;
const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};
function refresh() {
    if (pending) return;
    pending = fetchCatalogCached(models => {
        const next = faceFilters(models).length > 0;
        if (next === available) return;
        available = next;
        listeners.forEach(listener => listener());
    }).catch(() => undefined).finally(() => { pending = null; });
}

export function useFaceFiltersAvailable() {
    const value = useSyncExternalStore(subscribe, snapshot, snapshot);
    useFocusEffect(useCallback(() => {
        refresh();
    }, []));
    return value;
}
