import { subscribeCacheUser } from '../appCache';
let state = { editing: true, reverse: true };
const listeners = new Set<() => void>();
export const renderAvailability = () => state;
export const subscribeRenderAvailability = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function markRenderUnavailable(kind: 'editing' | 'reverse') {
    state = { ...state, [kind]: false }; listeners.forEach(fn => fn());
}
subscribeCacheUser(() => { state = { editing: true, reverse: true }; listeners.forEach(fn => fn()); });
