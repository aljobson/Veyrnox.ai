// Shared by tests/chatWarningSettle.test.mjs and tests/chatWarningTurns.test.mjs: a chat left with a kept warning by
// send() run for real against the real store (tests/chatSendFlow.harness.mjs), and that chat arriving on screen the
// way the screen's open() does it. Not a test file itself: its name keeps it out of `npm test`'s pattern.
import { readCreditsWarning } from '../app/veyrnox/_lib/chatLocal.js';
import { askKeptWarning, settleKeptWarning } from '../app/veyrnox/_lib/chatWarning.js';
import { A, ME, afterReload, memory, run, stopped } from './chatSendFlow.harness.mjs';

export const JOB = '6f1d2c3a-0b4e-4c5d-8e9f-a1b2c3d4e5f6';
export const OTHER_JOB = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
// A send's idempotency key, as the browser makes them (gateway.js): `vx-` and a UUID.
export const KEY = 'vx-1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
export const OTHER_KEY = 'vx-9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';
/** GET /api/v1/jobs/:id, as the route answers for a chat reply. */
export const JOBS = {
    queued: { state: 'queued', refunded: false, credits: 2 },
    running: { state: 'running', refunded: false, credits: 2 },
    failed: { state: 'failed', refunded: false, credits: 2, error_code: 'user_canceled' }, // the refund is a second step
    refunded: { state: 'failed', refunded: true, credits: 2, error_code: 'user_canceled' },
    saved: { state: 'succeeded', refunded: false, credits: 2 },
    unsaved: { state: 'succeeded', refunded: false, credits: 2, error_code: 'reply_not_saved' },
};
/**
 * POST /api/v1/chat/sends/close, as the route answers. `closed`: no reply was ever charged for that send, and the
 * server has closed its key, so none can be. The rest: the job that send made, in the shape of the job read.
 */
export const SENDS = {
    closed: { closed: true },
    ...Object.fromEntries(Object.entries(JOBS).map(([name, job]) => [name, { closed: false, job_id: JOB, ...job }])),
};
export const answers = (answer) => async () => answer;
/** One answer per job id or key. Asking about anything else is a failed read. */
export const byId = (map) => async (id) => { if (!(id in map)) throw new Error(`nothing is known of ${id}`); return map[id]; };

/** Server scripts for send(). The job id is one the server could have made: anything else is not kept (chatLocal.js). */
export const stoppedBeforeText = (job) => async ({ onEvent }) => { onEvent('start', { job_id: job }); throw stopped(); };
export const stoppedAfterText = (job) => async ({ onEvent }) => { onEvent('start', { job_id: job }); onEvent('delta', { text: 'A lamp' }); throw stopped(); };
export const cutAfter = (job) => async ({ onEvent }) => { onEvent('start', { job_id: job }); throw new TypeError('network error'); };
export const stopBeforeText = stoppedBeforeText(JOB);
export const stopBeforeStart = async () => { throw stopped(); };
export const stopAfterText = stoppedAfterText(JOB);
export const cutAfterStart = cutAfter(JOB);

/** A chat left by a send whose turn was not settled when the look for it ended. `more` goes to run(): `key`, `text`, `storage`. */
export async function leftBy(turn, { active = A, settle = 'pending', storage = memory(), ...more } = {}) {
    await run({ active, turn, settle, storage, ...more });
    return storage;
}
/**
 * The chat arrives on screen, the way open() does it: each turn of its kept warning is asked about, then the chat is
 * read, then the store is settled, and the screen reads the box and the notice from the store. `calls` is every job id
 * read and every key closed, in the order asked.
 */
export async function opened(storage, chat, answer) {
    const calls = [];
    const via = (id) => { calls.push(id); return answer(id); };
    const asked = await askKeptWarning({ warning: readCreditsWarning(storage, ME, chat), getJob: via, closeSend: via });
    const changed = settleKeptWarning(storage, ME, chat, asked);
    return { ...afterReload(storage, chat), changed, calls };
}
