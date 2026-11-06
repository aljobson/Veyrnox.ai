import { useSyncExternalStore } from 'react';

// Whether the side menu is open. The tab screens read it to hide themselves from VoiceOver/TalkBack while the
// menu covers them, so the same link is never reachable twice (QA-A1).
let open = false;
const listeners = new Set<() => void>();

export function setMenuOpen(next: boolean): void {
    if (open === next) return;
    open = next;
    for (const listener of [...listeners]) listener();
}

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

export const useMenuOpen = (): boolean => useSyncExternalStore(subscribe, () => open, () => false);
