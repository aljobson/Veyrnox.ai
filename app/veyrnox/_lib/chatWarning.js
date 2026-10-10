// A kept warning about Credits, asked about later (ADR-0067). Stop or a dropped connection can leave a turn that had not
// settled when the look for it ended (chatStop.js), and the chat keeps a warning that it may still be saved and use
// Credits (chatLocal.js). The warning is kept with what the server can be asked about its turn by: the reply's job id (it
// came with `start`, or the server named it), or, with none, the key the send went out with. When its chat is next opened, a page
// reload included, the turn is asked about first, and a turn the server has settled takes the warning away or changes
// what is kept. A read that fails, or a turn that is not finished, changes nothing: the warning stays and is asked about
// the next time.
// A send whose own request got no answer before `start` is asked about by its key at once, as a Stop before `start` is
// (askStoppedSend in chatStop.js). Only when that says nothing final is its warning kept, with the key, for the next
// time the chat is opened.
// A warning that took the place of another stands for both turns and is kept with both (four at most). It is settled
// only when every one of them is. A warning with no turn kept is never asked about: it stands for a turn it could not list.
// The reads are handed in, and only the store is changed here: the screen then shows what is stored, as it does
// whenever a chat arrives on it. One import, with its extension: the tests load this file directly.
import { NEW_CHAT, clearNotice, readCreditsWarning, readDraft, textMark, turnsOf, writeDraft, writeNotice } from './chatLocal.js';

/** The reads end here, however slow they are. They run before the chat is read, and opening a chat must not hang on them. */
export const KEPT_READ_LIMIT_MS = 2000;

const FINAL = new Set(['saved', 'unsaved', 'refunded']);

/**
 * What the server says about a turn. The answer is a job as the gateway returns it, or, for a send asked about by its
 * key, either the job that send made (in the same shape) or `{ closed: true }`.
 *   'saved'     the job succeeded. The server stores the messages in the same step, so a chat read after this read
 *               shows the reply and its price
 *   'unsaved'   the reply was charged but its messages could not be stored
 *   'refunded'  no Credits were used. The job failed and the refund has landed (the chat may still hold a reply the
 *               provider cut off, shown as not charged). Or the send made no job and the server has closed its key:
 *               none was charged, and none can be. Only `closed: true` with no other field beside it says that
 *   null        not settled, or not known: queued, running, failed with the refund still on its way (it is a second
 *               step), or an answer in a shape this does not know
 * @param {{state?: string, refunded?: boolean, error_code?: string, closed?: boolean}|null|undefined} answer
 * @returns {'saved'|'unsaved'|'refunded'|null}
 */
export function keptTurnVerdict(answer) {
  if (!answer || typeof answer !== 'object') return null;
  if (answer.closed === true) return Object.keys(answer).length === 1 ? 'refunded' : null;
  if (answer.state === 'succeeded') return answer.error_code === 'reply_not_saved' ? 'unsaved' : 'saved';
  if (answer.state === 'failed' && answer.refunded === true) return 'refunded';
  return null;
}

/**
 * Ask about every turn the warning kept for a chat stands for. Never throws and never waits longer than the limit.
 * @param {{warning: object|null, getJob: (id: string) => Promise<object>, closeSend?: (key: string) => Promise<object>, limitMs?: number}} args
 *   `warning` as the store reads it back (readCreditsWarning). `getJob` reads a job by its id. `closeSend` asks about a
 *   send by its key: the server answers with that send's job, or closes the key and says so
 * @returns {Promise<{warning: object, verdicts: Array<'saved'|'unsaved'|'refunded'>}|null>} one verdict for each turn,
 *   in their order. Null when there is nothing to act on: no warning, no turn to ask about, a read that failed or ran
 *   out of time, or any one turn that is not settled
 */
export async function askKeptWarning({ warning, getJob, closeSend, limitMs = KEPT_READ_LIMIT_MS }) {
  const turns = turnsOf(warning);
  if (!turns.length) return null;
  let timer;
  const limit = new Promise((resolve) => { timer = setTimeout(() => resolve(null), limitMs); });
  try {
    const answers = await Promise.race([Promise.all(turns.map((t) => (t.job ? getJob(t.job) : closeSend(t.key)))), limit]);
    const verdicts = (answers || []).map(keptTurnVerdict);
    return verdicts.length === turns.length && verdicts.every(Boolean) ? { warning, verdicts } : null;
  } catch {
    return null; // offline, a rate limit, a job the server does not show this person, a route that is not open: not an answer
  } finally {
    clearTimeout(timer);
  }
}

const sameTurns = (a, b) => a.length === b.length && a.every((t, i) => t.job === b[i].job && t.key === b[i].key && t.sent === b[i].sent);

/**
 * Act on the answers, in the store. Call it once the chat has been read, before the screen reads the notice and the draft.
 * Every turn has an answer by now, so this is about all of them together:
 *   one was charged and could not be stored   the warning becomes `reply_not_saved`: charged, and not in the chat. That
 *                                             one has nothing to ask and stays
 *   none used Credits                         the warning is forgotten, and nothing is said in its place. Text that was
 *                                             given back stays in the box
 *   some were saved                           the chat shows each reply and its price, so the warning is forgotten. If
 *               a saved message had been given back to the box, a notice is kept in the warning's place so that it is
 *               said on screen and after a page reload: for a warning about one turn `stop_saved`, or `connection_saved`
 *               when its connection dropped (nobody pressed Stop), and `turns_settled` for several (the box may then
 *               hold a message that was not saved). Under New chat there is no chat to
 *               show a reply, so the warning stays; the answers are final, so its turns are let go and it is not asked
 *               about again
 * The box is emptied only while it still holds exactly a message that is now in the chat: text the person has changed
 * is left, and so is a message that was not saved.
 * The answers are for the warning that was read. If another is kept by now (a later message ended with its own, and
 * the warning stands for that turn too), or none is (a later message was saved, the chat was deleted), nothing is changed.
 * @param {string} chatId the chat, or NEW_CHAT
 * @param {{warning: object, verdicts: string[]}|null} asked what askKeptWarning returned
 * @returns {boolean} true when the store was changed
 */
export function settleKeptWarning(storage, userId, chatId, asked) {
  if (!asked || !asked.warning || !Array.isArray(asked.verdicts)) return false;
  const { warning, verdicts } = asked;
  const turns = turnsOf(warning);
  if (!turns.length || verdicts.length !== turns.length || !verdicts.every((v) => FINAL.has(v))) return false;
  const now = readCreditsWarning(storage, userId, chatId);
  if (!now || now.code !== warning.code || !sameTurns(turnsOf(now), turns)) return false;
  const saved = turns.filter((_, i) => verdicts[i] === 'saved');
  const emptyBox = () => { const box = textMark(readDraft(storage, userId, chatId)); if (saved.some((t) => t.sent === box)) writeDraft(storage, userId, chatId, ''); };
  if (verdicts.includes('unsaved')) { if (chatId !== NEW_CHAT) emptyBox(); writeNotice(storage, userId, chatId, 'reply_not_saved'); return true; }
  if (!saved.length) { clearNotice(storage, userId, chatId); return true; }
  if (chatId === NEW_CHAT) { writeNotice(storage, userId, chatId, warning.code); return true; }
  // A turn was given back when it has a mark. The last one also when the warning's own code says so (its mark may be gone from storage).
  const gaveBack = saved.some((t) => t.sent) || (warning.code === 'stop_unsure' && saved.includes(turns[turns.length - 1]));
  if (!gaveBack) { clearNotice(storage, userId, chatId); return true; }
  emptyBox();
  writeNotice(storage, userId, chatId, turns.length > 1 ? 'turns_settled' : warning.code === 'connection_lost' ? 'connection_saved' : 'stop_saved');
  return true;
}
