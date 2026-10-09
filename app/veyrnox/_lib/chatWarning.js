// A kept warning about Credits, asked about later (ADR-0067). Stop or a dropped connection can leave a turn that had not
// settled when the look for it ended (chatStop.js), and the chat keeps a warning that it may still be saved and use
// Credits (chatLocal.js). The warning is kept with the job id that came with `start`. When its chat is next opened, a
// page reload included, that job is read first, and a turn the server has settled takes the warning away or changes
// what is kept. A read that fails, or a job that is not finished, changes nothing: the warning stays and is asked about
// the next time. A warning with no job (Stop came before `start`) is never asked about.
// The job read is handed in, and only the store is changed here: the screen then shows what is stored, as it does
// whenever a chat arrives on it. One import, with its extension: the tests load this file directly.
import { NEW_CHAT, clearNotice, readCreditsWarning, readDraft, textMark, writeDraft, writeNotice } from './chatLocal.js';

/** The job read ends here, however slow it is. It runs before the chat is read, and opening a chat must not hang on it. */
export const KEPT_READ_LIMIT_MS = 2000;

/**
 * What a job says about its turn.
 *   'saved'     the job succeeded. The server stores the messages in the same step, so a chat read after this job read
 *               shows the reply and its price
 *   'unsaved'   the reply was charged but its messages could not be stored
 *   'refunded'  the job failed and the refund has landed: no Credits were used. The chat may still hold a reply the
 *               provider cut off, shown as not charged
 *   null        not settled, or not known: queued, running, failed with the refund still on its way (it is a second
 *               step), or an answer in a shape this does not know
 * @param {{state?: string, refunded?: boolean, error_code?: string}|null|undefined} job the job as the gateway returns it
 * @returns {'saved'|'unsaved'|'refunded'|null}
 */
export function keptTurnVerdict(job) {
  if (!job || typeof job !== 'object') return null;
  if (job.state === 'succeeded') return job.error_code === 'reply_not_saved' ? 'unsaved' : 'saved';
  if (job.state === 'failed' && job.refunded === true) return 'refunded';
  return null;
}

/**
 * Ask about the warning kept for a chat. Never throws and never waits longer than the limit.
 * @param {{warning: {code: string, job?: string, sent?: string}|null, getJob: (id: string) => Promise<object>, limitMs?: number}} args
 *   `warning` as the store reads it back (readCreditsWarning)
 * @returns {Promise<{warning: object, verdict: 'saved'|'unsaved'|'refunded'}|null>} null when there is nothing to act on:
 *   no warning, no job to ask, a read that failed or ran out of time, or a turn that is not settled
 */
export async function askKeptWarning({ warning, getJob, limitMs = KEPT_READ_LIMIT_MS }) {
  if (!warning || !warning.job) return null;
  let timer;
  const limit = new Promise((resolve) => { timer = setTimeout(() => resolve(null), limitMs); });
  try {
    const verdict = keptTurnVerdict(await Promise.race([getJob(warning.job), limit]));
    return verdict ? { warning, verdict } : null;
  } catch {
    return null; // offline, a rate limit, a job the server does not show this person: not an answer
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Act on the answer, in the store. Call it once the chat has been read, before the screen reads the notice and the draft.
 *   'refunded'  the warning is forgotten, and nothing is said in its place. Text that was given back stays in the box
 *   'unsaved'   the warning becomes `reply_not_saved`: charged, and not in the chat. That one has no job and stays
 *   'saved'     the chat shows the reply and its price, so the warning is forgotten. After `stop_unsure` the same message
 *               is then in the chat, charged, and in the box: the box is emptied while it still holds exactly that
 *               message, text the person has changed is left, and `stop_saved` is kept either way so that it is said
 *               on screen and after a page reload. Under New chat there is no chat to show the reply, so nothing changes
 * The answer is for the warning that was read. If another is kept by now (a later message ended with its own), or none
 * is (a later message was saved, the chat was deleted), nothing is changed.
 * @param {string} chatId the chat, or NEW_CHAT
 * @param {{warning: object, verdict: string}|null} asked what askKeptWarning returned
 * @returns {boolean} true when the store was changed
 */
export function settleKeptWarning(storage, userId, chatId, asked) {
  if (!asked || !asked.warning) return false;
  const { warning, verdict } = asked;
  const now = readCreditsWarning(storage, userId, chatId);
  if (!now || now.code !== warning.code || now.job !== warning.job) return false;
  if (verdict === 'refunded') { clearNotice(storage, userId, chatId); return true; }
  if (verdict === 'unsaved') { writeNotice(storage, userId, chatId, 'reply_not_saved'); return true; }
  if (verdict !== 'saved' || chatId === NEW_CHAT) return false;
  if (warning.code !== 'stop_unsure') { clearNotice(storage, userId, chatId); return true; }
  if (warning.sent && textMark(readDraft(storage, userId, chatId)) === warning.sent) writeDraft(storage, userId, chatId, '');
  writeNotice(storage, userId, chatId, 'stop_saved');
  return true;
}
