/**
 * Asking about a chat send by its own key, and closing a send that made no job (ADR-0067 amendment 11).
 *
 * The browser makes a send's idempotency key before any request. When Stop comes before `start`, no job id ever
 * reaches it, and an aborted request can still be debited a moment later, so "there is no job for this key" is not
 * "nothing was charged" unless it can never change. chat_close_send (migration 0242) makes it so: in one step it
 * either finds the job that send made and returns it, or records the key as closed, and from then on the database
 * refuses to make a chat job for it. `closed: true` is the database's own statement of that, and nothing else here
 * is ever passed on as one.
 */
import { JOB_STATES, publicJob } from './jobState.js';

// Only jobState.js is imported: this file is on the import graph of every route that takes a free allowance (freeJob.js).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only the exact string "true" opens the route. Off until migration 0242 is applied. Read per request, never cached. */
export const sendCloseEnabled = (env) => !!env && env.CHAT_SEND_CLOSE_ENABLED === 'true';

/** A send's key as the browser makes it: `vx-` and a lower-case UUID (app/veyrnox/_lib/gateway.js). Nothing else is closed. */
export const SEND_KEY_RE = /^vx-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** What the database raises when a chat job is asked for under a closed key (the trigger of migration 0242). */
export const SEND_CLOSED = 'CHAT_SEND_CLOSED';
/** @param {unknown} err what the database client threw @returns {boolean} the debit was refused because its send was closed */
export function isClosedSend(err) {
    const body = err && typeof err === 'object' ? err.body : null;
    return !!body && typeof body === 'object' && err.status === 409 && body.code === 'PT409' && body.message === SEND_CLOSED;
}

const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const REFUSALS = { CLOSE_LIMIT: [429, 'close_limit'], USER_NOT_FOUND: [409, 'user_not_provisioned'], INVALID_KEY: [400, 'invalid_key'] };

/**
 * chat_close_send's answer, as the route sends it.
 *   { closed: true }                                    the send made no job, and none can now be made for its key
 *   { closed: false, job_id, state, refunded, ... }     the job that send made, in the words of the job read
 * Anything the database did not say in one of those two shapes is a failure (502), never "nothing was charged".
 * @param {unknown} row
 * @returns {Response}
 */
export function closeAnswer(row) {
    if (!row || typeof row !== 'object') return json({ error: 'close_failed' }, 502);
    // The shared job-read quota (consume_job_read_request, 0115), answered as the job read answers it (lib/jobReadLimit.js).
    if (row.ok === false && row.code === 'RATE_LIMITED') {
        const retry = Number.isInteger(row.retry_after_seconds) ? Math.max(1, Math.min(60, row.retry_after_seconds)) : 60;
        return json({ error: 'rate_limited', retry_after_seconds: retry }, 429, { 'Retry-After': String(retry) });
    }
    if (row.ok === false && Object.hasOwn(REFUSALS, row.code)) return json({ error: REFUSALS[row.code][1] }, REFUSALS[row.code][0]);
    if (row.ok !== true) return json({ error: 'close_failed' }, 502);
    if (row.closed === true && row.job_id === undefined && row.state === undefined) return json({ closed: true });
    if (row.closed === false && typeof row.job_id === 'string' && UUID_RE.test(row.job_id) && JOB_STATES.includes(row.state)) {
        return json({ closed: false, job_id: row.job_id, ...publicJob(row) });
    }
    return json({ error: 'close_failed' }, 502);
}
