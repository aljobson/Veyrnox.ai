import { type ApiClient } from './api';
import { getCheckinStatus, type CheckinStatus } from './checkin';

type ReadState = {
    day: string; value: CheckinStatus | null; complete: boolean;
    failures: number; next: number; pending: Promise<CheckinStatus | null> | null;
};
// Matches the web: at most three retries, after 1/2/4 minutes, and only for
// network/5xx failures. A 403/404 (or other client refusal) stops for the UTC day.
export function createCheckinStatusReader(fetchStatus: () => Promise<CheckinStatus | null>, now = Date.now) {
    let state: ReadState | undefined;
    function current(): ReadState {
        const day = new Date(now()).toISOString().slice(0, 10);
        if (state?.day !== day) state = { day, value: null, complete: false, failures: 0, next: 0, pending: null };
        return state;
    }
    const due = () => { const s = current(); return !s.complete && !s.pending && now() >= s.next; };
    function update(value: CheckinStatus | null) { state = { ...current(), value, complete: true, pending: null }; }
    async function read(): Promise<CheckinStatus | null> {
        const s = current();
        if (s.pending) return s.pending;
        if (!due()) return s.value;
        s.pending = (async () => {
            try { s.value = await Promise.resolve().then(fetchStatus); s.complete = true; }
            catch (error) {
                s.value = null;
                const e = error as { status?: number; code?: string } | null;
                const retryable = (e?.status ?? 0) >= 500 || e?.code === 'network' || e?.code === 'network_error' || error instanceof TypeError;
                if (retryable && s.failures < 3) s.next = now() + 60_000 * 2 ** s.failures++;
                else s.complete = true;
            } finally { s.pending = null; }
            return current() === s ? s.value : current().value;
        })();
        return s.pending;
    }
    return { due, read, peek: () => current().value, update, stop: () => update(null) };
}
const readers = new WeakMap<ApiClient, Map<string, ReturnType<typeof createCheckinStatusReader>>>();
export function checkinStatusReader(api: ApiClient, owner: string) {
    let users = readers.get(api);
    if (!users) { users = new Map(); readers.set(api, users); }
    let reader = users.get(owner);
    if (!reader) { reader = createCheckinStatusReader(() => getCheckinStatus(api)); users.set(owner, reader); }
    return reader;
}
