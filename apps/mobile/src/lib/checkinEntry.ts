import { getCacheUser, subscribeCacheUser } from './appCache';
import type { CheckinStatus } from './checkin';
const statuses = new Map<string, CheckinStatus>();
const listeners = new Set<() => void>();
const requests = new Set<() => void>();
subscribeCacheUser(() => { statuses.clear(); listeners.forEach(fn => fn()); });
export function announceCheckin(owner: string, status: CheckinStatus | null) {
    if (owner !== getCacheUser()) return;
    if (status) statuses.set(owner, status); else statuses.delete(owner);
    listeners.forEach(fn => fn());
}
export const peekCheckin = (owner: string | undefined) => owner ? statuses.get(owner) ?? null : null;
export function subscribeCheckin(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function requestCheckinOpen() { requests.forEach(fn => fn()); }
export function onCheckinOpenRequest(fn: () => void) { requests.add(fn); return () => { requests.delete(fn); }; }
