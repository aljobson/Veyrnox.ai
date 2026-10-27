import { defaultProbe } from './network';
import { isOffline, markOnline, subscribe } from './networkState';

// One lifecycle owned by AppLayout. Nothing polls connectivity while online or in background.
export function startOfflineRecovery(
    foreground: { active: () => boolean; subscribe: (listener: (active: boolean) => void) => () => void },
    probe: () => Promise<boolean> = defaultProbe,
) {
    let stopped = false;
    let pending = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => { if (timer) clearTimeout(timer); timer = undefined; };
    function schedule() {
        clear();
        if (!stopped && !pending && isOffline() && foreground.active()) {
            timer = setTimeout(check, [5000, 15000, 30000][Math.min(attempt++, 2)]);
        }
    }
    async function check() {
        clear();
        if (stopped || pending || !isOffline() || !foreground.active()) return;
        pending = true;
        try { if (await probe() && !stopped) markOnline(); }
        catch { /* A failed probe leaves the existing offline state intact. */ }
        finally { pending = false; schedule(); }
    }
    const off = subscribe(() => { attempt = 0; schedule(); });
    const offForeground = foreground.subscribe(active => { clear(); if (active) void check(); });
    schedule();
    return () => { stopped = true; clear(); off(); offForeground(); };
}
