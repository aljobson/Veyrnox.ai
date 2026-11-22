import { rpc as realRpc } from '../packages/db/supabase-client.js';

// The short local queue avoids needless database refusals inside one isolate;
// the reservation RPC is the authoritative account-wide fence.
export const CRUN_POLL_INTERVAL_MS = 67;
let tail = Promise.resolve();
let nextAt = 0;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function paceCrunTaskInfo({ now = Date.now, wait = delay, rpc = realRpc, cfg,
    purpose = 'taskinfo.poll', reservationKey } = {}) {
    const turn = tail.then(async () => {
        const pause = Math.max(0, nextAt - now());
        if (pause) await wait(pause);
        nextAt = Math.max(nextAt, now()) + CRUN_POLL_INTERVAL_MS;
        const key = reservationKey || `taskinfo:${globalThis.crypto.randomUUID()}`;
        try {
            const reserved = await rpc('reserve_crun_taskinfo_slot', {
                p_reservation_key: key,
                p_purpose: purpose,
            }, cfg);
            return reserved?.ok === true;
        } catch {
            return false;
        }
    });
    tail = turn.catch(() => {});
    return turn;
}

export function resetCrunPollPacer() {
    tail = Promise.resolve();
    nextAt = 0;
}
