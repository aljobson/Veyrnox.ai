import * as SecureStore from 'expo-secure-store';

const SLOT = 'veyrnox.notificationPrimer.v1';
const listeners = new Set<() => void>();

export interface NotificationPrimerState {
    readonly pending: boolean;
    readonly shown: boolean;
}

const EMPTY: NotificationPrimerState = { pending: false, shown: false };

function notify() {
    for (const listener of listeners) listener();
}

async function write(state: NotificationPrimerState) {
    await SecureStore.setItemAsync(SLOT, JSON.stringify(state)).catch(() => undefined);
    notify();
}

export async function readNotificationPrimer(): Promise<NotificationPrimerState> {
    const raw = await SecureStore.getItemAsync(SLOT).catch(() => null);
    if (!raw) return EMPTY;
    try {
        const value = JSON.parse(raw) as Record<string, unknown>;
        return { pending: value.pending === true, shown: value.shown === true };
    } catch {
        return EMPTY;
    }
}

// Image jobs are often quick enough to watch. The primer becomes relevant only after a successful submission that is
// normally safe to leave running in the background.
export async function markNotificationPrimerPending(kind?: string | null): Promise<void> {
    if (!['video', 'audio', 'speech', 'music', 'sound'].includes(String(kind))) return;
    const current = await readNotificationPrimer();
    if (current.shown || current.pending) return;
    await write({ pending: true, shown: false });
}

// Viewing the explainer is the one automatic opportunity. "Not now" must remain respected; Account still owns the
// permanent notification switch if the person changes their mind later.
export async function completeNotificationPrimer(): Promise<void> {
    await write({ pending: false, shown: true });
}

export function subscribeNotificationPrimer(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
