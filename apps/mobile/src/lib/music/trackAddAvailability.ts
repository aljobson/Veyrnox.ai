import { subscribeCacheUser } from '../appCache';
let unavailable = false;
const listeners = new Set<() => void>();
export const isTrackAddUnavailable = () => unavailable;
export const subscribeTrackAddAvailability = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function markTrackAddUnavailable() { unavailable = true; listeners.forEach(fn => fn()); }
subscribeCacheUser(() => { unavailable = false; listeners.forEach(fn => fn()); });
