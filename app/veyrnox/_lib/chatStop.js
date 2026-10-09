// After Stop (ADR-0067). Text that had appeared is kept and charged, but the server saves the stopped turn a moment
// after the browser lets go. So the screen reads the job and the chat a few times, about three seconds in all,
// instead of reloading once and coming back without the turn. A connection that drops mid-reply is looked for the
// same way. When Stop came before the reply's `start`, the server is first asked about the send itself (askStoppedSend).
// No imports: the tests load this file directly.

/** How long to wait before each read. The save is never there at once, so the first read waits too. */
export const STOP_WAITS_MS = [250, 450, 700, 1000];
/** The whole look-up ends here, however slow the reads are: a read has no timeout of its own, and Stop must not hang on one. */
export const STOP_LIMIT_MS = 3500;

/**
 * The saved turn for one send, in a chat as the server returns it: the question carrying this text and the reply after
 * it, neither of which the screen had before the send. The chat read gives no job id, so this is how a turn is found.
 * @param {Array<{id:string, role:string, content:string}>|undefined} messages
 * @param {Set<string>} knownIds ids of the messages on screen before the send
 * @param {string} text the message as it was sent
 * @returns {{user:object, reply:object}|null}
 */
export function findSavedTurn(messages, knownIds, text) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 2; i >= 0; i -= 1) {
    const user = list[i]; const reply = list[i + 1];
    if (user.role === 'user' && reply.role === 'assistant' && user.content === text && !knownIds.has(user.id) && !knownIds.has(reply.id)) return { user, reply };
  }
  return null;
}

/**
 * Wait for a stopped turn to settle. The job (its id comes with the `start` event) says whether the turn is over; the
 * chat says what was kept. Without a job id, Stop came before `start` and the chat alone is read.
 *   'saved'    the chat holds the turn: reload it for the real status and price
 *   'unsaved'  the reply was charged but its messages could not be stored (the chat was deleted, or the text refused)
 *   'nothing'  the job failed and nothing was stored: the Credits came back
 *   'pending'  not settled when the tries ran out or the time limit passed
 * @param {{jobId?:string|null, text:string, knownIds:Set<string>, getThread:() => Promise<{messages:object[]}>,
 *          getJob:(id:string) => Promise<{state:string, refunded?:boolean, error_code?:string}>, wait?:(ms:number) => Promise<void>, waits?:number[],
 *          limitMs?:number}} args
 * @returns {Promise<'saved'|'unsaved'|'nothing'|'pending'>}
 */
export async function settleStoppedTurn({ limitMs = STOP_LIMIT_MS, ...args }) {
  const clock = { over: false };
  let timer;
  const limit = new Promise((resolve) => { timer = setTimeout(() => resolve('pending'), limitMs); });
  try { return await Promise.race([lookForTurn(args, clock), limit]); } finally { clock.over = true; clearTimeout(timer); }
}

async function lookForTurn({ jobId, text, knownIds, getThread, getJob, wait = sleep, waits = STOP_WAITS_MS }, clock) {
  for (let i = 0; i < waits.length; i += 1) {
    await wait(waits[i]);
    if (clock.over) break; // the time limit answered already: no more reads
    // Either read can fail (offline, a rate limit). A failed read is not an answer: the next try decides.
    let job = null;
    if (jobId) { try { job = await getJob(jobId); } catch { /* read failed */ } }
    if (clock.over) break;
    const state = job ? job.state : null;
    if (state === 'queued' || state === 'running') continue; // not finished, so the chat cannot hold the turn yet
    // The server stores the messages in the same step that ends the job, so a finished job needs no look at the chat.
    if (state === 'succeeded') return job.error_code === 'reply_not_saved' ? 'unsaved' : 'saved';
    // The refund is a second step after the job fails. Until it lands the balance is not final, so read again if a try is left.
    if (state === 'failed' && !job.refunded && i < waits.length - 1) continue;
    let messages = null;
    try { messages = (await getThread()).messages; } catch { /* read failed */ }
    if (!Array.isArray(messages)) continue;
    // A failed job can still have stored a reply the provider cut off. The job was read first, so a failed job whose
    // turn is not in a chat read after it stored nothing.
    if (findSavedTurn(messages, knownIds, text)) return 'saved';
    if (state === 'failed') return 'nothing';
  }
  return 'pending';
}

/** The question below ends here, however slow its answer is: it comes before the look, and Stop must not hang on it. */
export const STOP_ASK_LIMIT_MS = 2000;
const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i; // a job id as the server makes them
const NO_ANSWER = Object.freeze({ closed: false, job: null });

/**
 * Stop came before `start`, so no job id reached the browser and the look above could only read the chat. The server
 * is asked about the send by the idempotency key it went out with (POST /api/v1/chat/sends/close), before the look:
 *   `closed`  the send made no job, and the server has closed its key: no reply was charged, and none can be. Final.
 *             Read only from `closed: true` with no other field beside it, as a kept warning reads it (chatWarning.js)
 *   `job`     the id of the job the send made: the turn is looked for by it, as after `start`
 *   neither   nothing is known: a refusal, a rate limit, the route not open, a failed request, an answer that took
 *             longer than the limit, or one in a shape this does not know. The look runs as it does with no job id
 * Never throws, and never waits longer than the limit. An answer that has not come by then is not waited for: the
 * request is not taken back, so the server may still close the key, and the warning kept meanwhile is settled by the
 * same question when its chat is next opened.
 * @param {{key?: string|null, closeSend?: (key: string) => Promise<object>, limitMs?: number}} args
 * @returns {Promise<{closed: boolean, job: string|null}>}
 */
export async function askStoppedSend({ key, closeSend, limitMs = STOP_ASK_LIMIT_MS }) {
  if (typeof key !== 'string' || !key || typeof closeSend !== 'function') return NO_ANSWER;
  let timer;
  const limit = new Promise((resolve) => { timer = setTimeout(() => resolve(null), limitMs); });
  try {
    const answer = await Promise.race([closeSend(key), limit]);
    if (!answer || typeof answer !== 'object') return NO_ANSWER;
    if (answer.closed === true) return Object.keys(answer).length === 1 ? { closed: true, job: null } : NO_ANSWER;
    return answer.closed === false && typeof answer.job_id === 'string' && JOB_ID_RE.test(answer.job_id) ? { closed: false, job: answer.job_id } : NO_ANSWER;
  } catch {
    return NO_ANSWER; // not an answer: the look decides, as it did before the send could be asked about
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Which notice the screen shows once a turn cut off by a dropped connection has been looked for (a chatErrorCopy code).
 * `reloaded`: the chat was read again, so the screen shows what the server kept and not just what had arrived.
 * @param {'saved'|'unsaved'|'nothing'|'pending'} outcome
 * @param {boolean} reloaded
 * @returns {'connection_saved'|'reply_not_saved'|'connection_refunded'|'connection_lost'}
 */
export function lostNotice(outcome, reloaded) {
  if (outcome === 'nothing') return 'connection_refunded'; // the job failed and nothing was stored: the Credits came back
  if (outcome === 'unsaved') return 'reply_not_saved';     // charged, whether or not the chat could be read again
  if (outcome === 'saved' && reloaded) return 'connection_saved';
  return 'connection_lost';                                // not settled, or saved but not on screen: it may have used Credits
}

function sleep(ms) { return new Promise((resolve) => { setTimeout(resolve, ms); }); }
