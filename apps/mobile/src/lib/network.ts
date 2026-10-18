import { ApiError } from './api';

// Whether the last network call worked. Driven by real request outcomes (a request that fails to connect marks the
// app offline, any response marks it online), so no extra permission or native module is needed. A reconnect
// listener can call markOnline() too.

type Listener = () => void;

let offline = false;
const listeners = new Set<Listener>();

function set(next: boolean) {
    if (next === offline) return;
    offline = next;
    listeners.forEach((fn) => fn());
}

export const markOffline = () => set(true);
export const markOnline = () => set(false);
export const isOffline = (): boolean => offline;

export function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

// ApiClient reports a failure to connect as ApiError(0, 'network').
export function isNetworkError(err: unknown): boolean {
    return err instanceof ApiError && err.status === 0 && err.code === 'network';
}

// Call from a catch or a then to keep the state honest; returns the value so it can sit inside a chain.
export function observe<T>(result: Promise<T>): Promise<T> {
    return result.then(
        (value) => {
            markOnline();
            return value;
        },
        (err: unknown) => {
            if (isNetworkError(err)) markOffline();
            else markOnline();
            throw err;
        },
    );
}

export class OfflineError extends Error {
    constructor() {
        super('offline');
        this.name = 'OfflineError';
    }
}

// A paid action is never queued or retried later. Call this before submitting one: when the app knows it is offline
// it throws, and the screen shows the offline message instead of sending.
export function requireOnline(): void {
    if (offline) throw new OfflineError();
}

// For tests.
export function resetNetworkState() {
    offline = false;
    listeners.clear();
}
