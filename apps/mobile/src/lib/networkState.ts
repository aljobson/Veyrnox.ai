// Separate from the API transport to avoid an api/network import cycle.
let offline = false;
const listeners = new Set<() => void>();
function set(next: boolean) {
    if (offline === next) return;
    offline = next;
    listeners.forEach(fn => fn());
}
export const markOffline = () => set(true);
export const markOnline = () => set(false);
export const isOffline = () => offline;
export function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
export function resetNetworkState() { offline = false; listeners.clear(); }
