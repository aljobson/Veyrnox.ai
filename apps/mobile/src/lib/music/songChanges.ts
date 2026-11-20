// Notifications only: no song, account, or audio data is cached here.
const listeners = new Set<() => void>();
export const notifySongChanged = () => listeners.forEach(fn => fn());
export function subscribeSongChanges(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
