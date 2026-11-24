import { AppState } from 'react-native';
import { subscribeCacheUser } from '../appCache';
import { isMusicOff } from './probe';
export type PollState<T> = Readonly<{ state: 'polling' | 'done' | 'waiting' | 'off'; value: T | null }>;
export type PollOptions<T> = {
    read(): Promise<T>; terminal(value: T): boolean; onChange(state: PollState<T>): void;
    ceilingMs?: number; initialAppState?: string | null;
    subscribeAppState?: (fn: (state: string | null | undefined) => void) => () => void;
    subscribeAccount?: (fn: () => void) => () => void;
};
// A ceiling bounds automatic polling even when a request hangs. Manual refresh is one read.
export function pollUntil<T>(o: PollOptions<T>) {
    const limit = o.ceilingMs ?? 300000;
    let active = (o.initialAppState === undefined ? AppState.currentState : o.initialAppState) === 'active';
    let disposed = false, flight = false, followUp = false, delay = 1500, epoch = 0;
    // Only time spent in the foreground counts toward the ceiling: backgrounded time did no polling.
    let spent = 0, since: number | null = active ? Date.now() : null;
    const remainingMs = () => limit - spent - (since === null ? 0 : Date.now() - since);
    let snapshot: PollState<T> = { state: 'polling', value: null };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => { clearTimeout(timer); clearTimeout(deadline); timer = undefined; deadline = undefined; };
    const emit = (patch: Partial<PollState<T>>) => { snapshot = { ...snapshot, ...patch }; o.onChange(snapshot); };
    function schedule() {
        cancel();
        if (disposed || !active || snapshot.state !== 'polling') return;
        const remaining = remainingMs();
        if (remaining <= 0) { emit({ state: 'waiting' }); return; }
        deadline = setTimeout(() => { clearTimeout(timer); emit({ state: 'waiting' }); }, remaining);
        if (!flight) timer = setTimeout(() => void read(), Math.min(delay, remaining));
    }
    async function read() {
        if (disposed || !active || snapshot.state === 'done' || snapshot.state === 'off') return;
        if (flight) { followUp = true; return; }
        flight = true; const ticket = epoch;
        try {
            const value = await o.read();
            if (disposed || ticket !== epoch) return;
            emit({ value, state: o.terminal(value) ? 'done' : remainingMs() <= 0 ? 'waiting' : 'polling' });
        } catch (error) {
            if (disposed || ticket !== epoch) return;
            if (isMusicOff(error)) emit({ state: 'off', value: null });
            // Network, gateway and other read errors do not imply a failed provider job.
        } finally {
            flight = false; delay = Math.min(5000, delay * 1.5);
            // A deadline or account/app-state callback can update the snapshot while the read awaits.
            const latestState = snapshot.state as PollState<T>['state'];
            if (followUp && !disposed && active && latestState !== 'done' && latestState !== 'off') {
                followUp = false; void read();
            } else { followUp = false; schedule(); }
        }
    }
    const stopApp = (o.subscribeAppState ?? (fn => {
        const sub = AppState.addEventListener('change', fn); return () => sub.remove();
    }))(state => {
        const next = state === 'active';
        if (next !== active) { if (next) since = Date.now(); else if (since !== null) { spent += Date.now() - since; since = null; } }
        active = next; schedule();
    });
    const stopAccount = (o.subscribeAccount ?? subscribeCacheUser)(() => dispose());
    function dispose() {
        if (disposed) return;
        disposed = true; epoch++; followUp = false; cancel(); stopApp(); stopAccount(); snapshot = { state: 'waiting', value: null };
    }
    schedule();
    return { snapshot: () => snapshot, refresh: read, dispose };
}
