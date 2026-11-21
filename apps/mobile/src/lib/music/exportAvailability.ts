import { subscribeCacheUser } from '../appCache';
let unavailable = false;
const listeners = new Set<() => void>();
export const isExportUnavailable = () => unavailable;
export const subscribeExportAvailability = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function markExportUnavailable() { unavailable = true; listeners.forEach(fn => fn()); }
// Share links retain their existing independent call-time distribution probe.
subscribeCacheUser(() => { unavailable = false; listeners.forEach(fn => fn()); });
