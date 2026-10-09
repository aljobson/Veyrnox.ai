// After Stop (ADR-0067). Text that had appeared is kept and charged, but the server saves the stopped turn a moment
// after the browser lets go. So the screen reads the job and the chat a few times, about three seconds in all,
// instead of reloading once and coming back without the turn. No imports: the tests load this file directly.

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

function sleep(ms) { return new Promise((resolve) => { setTimeout(resolve, ms); }); }
