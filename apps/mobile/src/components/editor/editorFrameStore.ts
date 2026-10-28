import { useSyncExternalStore } from 'react';

// Created once per editor session. A tick only notifies playback consumers.
export function createFrameStore(initial = 0) {
    let frame = initial;
    const listeners = new Set<() => void>();
    return {
        get: () => frame,
        set: (next: number) => {
            if (next === frame) return;
            frame = next;
            listeners.forEach(listener => listener());
        },
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
    };
}
export type FrameStore = ReturnType<typeof createFrameStore>;
export const useEditorFrame = (store: FrameStore) => useSyncExternalStore(store.subscribe, store.get, store.get);
