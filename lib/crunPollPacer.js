// Shared by every Crun TaskInfo caller in this isolate. The durable account-
// wide CreateTask limit is in Postgres; migration 0580 has no equivalent poll
// reservation RPC, so this is the strongest available worker-side fence.
export const CRUN_POLL_INTERVAL_MS = 67;
let tail = Promise.resolve();
let nextAt = 0;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function paceCrunTaskInfo({ now = Date.now, wait = delay } = {}) {
    const turn = tail.then(async () => {
        const pause = Math.max(0, nextAt - now());
        if (pause) await wait(pause);
        nextAt = Math.max(nextAt, now()) + CRUN_POLL_INTERVAL_MS;
    });
    tail = turn.catch(() => {});
    return turn;
}

export function resetCrunPollPacer() {
    tail = Promise.resolve();
    nextAt = 0;
}
