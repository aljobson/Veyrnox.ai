import { getCacheUser, subscribeCacheUser } from '../appCache';
let unavailable = false;
let unavailableOwner: string | undefined;
const listeners = new Set<() => void>();
export const isTrackAddUnavailable = () => {
    if (unavailable && unavailableOwner !== getCacheUser()) {
        unavailable = false;
        unavailableOwner = undefined;
    }
    return unavailable;
};
export const subscribeTrackAddAvailability = (fn: () => void) => {
    listeners.add(fn);
    const unsubscribeOwner = subscribeCacheUser(() => fn());
    return () => { listeners.delete(fn); unsubscribeOwner(); };
};
export function markTrackAddUnavailable() {
    unavailable = true;
    unavailableOwner = getCacheUser();
    listeners.forEach(fn => fn());
}
