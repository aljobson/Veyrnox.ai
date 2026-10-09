// Chat conveniences kept in this browser only, like the library favourites:
// an unsent draft per chat, the notice that goes with it, and the replies a
// user starred. Nothing is sent to the server, so none of it follows the user
// to another device. Every key carries
// the signed-in user's id, and authClient's setSession calls clearChatLocal
// when the session ends or a different user signs in, so one person's unsent
// text is never shown to the next person to use this browser. With no user id
// nothing is read and nothing is stored.

const DRAFT_PREFIX = 'veyrnox_chat_draft_v2:';
const STAR_PREFIX = 'veyrnox_chat_stars_v2:';
const NOTICE_PREFIX = 'veyrnox_chat_notice_v1:';
// The v1 draft and star keys had no user id in them. They are never read, only removed.
const ALL_PREFIXES = [DRAFT_PREFIX, STAR_PREFIX, NOTICE_PREFIX, 'veyrnox_chat_draft_v1:', 'veyrnox_chat_stars_v1:'];
export const NEW_CHAT = 'new';
export const MAX_DRAFT = 8000;
export const MAX_STARS = 200;
export const MAX_NOTICE = 120; // characters of one stored notice: a code, and the number its words may need
const MAX_NOTICE_CREDITS = 1_000_000;
const UNKNOWN_NOTICE = 'unknown';
// Notices that say Credits were used, or still may be, by a message the chat does not show: Stop or a dropped
// connection with the turn not settled, and a reply that was charged but could not be stored. Every other notice is
// about a message that is settled, and either used no Credits or is in the chat with its price.
const CREDITS_WARNINGS = new Set(['stop_unsure', 'stop_saving', 'connection_lost', 'reply_not_saved']);
// The three whose turn had started and was not settled when the look for it ended. The job id that came with `start` is
// kept with them, so the server can be asked later whether that turn has settled (chatWarning.js). `reply_not_saved` is
// settled already, charged, so there is nothing to ask.
const ASKABLE = new Set(['stop_unsure', 'stop_saving', 'connection_lost']);
// The one of them that is kept with its message given back to the box. A mark of that text is kept with it: if the turn
// turns out to be saved, the box is emptied only while it still holds exactly that message.
const GIVEN_BACK = 'stop_unsure';
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const JOB_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i; // a job id as the server makes them
const MARK_RE = /^[0-9a-z]{1,4}\.[0-9a-z]{1,7}$/;

const ok = (id) => typeof id === 'string' && ID_RE.test(id);
const keyFor = (prefix, userId, id) => (ok(userId) && ok(id) ? `${prefix}${userId}:${id}` : null);

/** @returns {string} the user's unsent text for a chat ('new' for one not created yet), or '' */
export function readDraft(storage, userId, chatId) {
  const key = keyFor(DRAFT_PREFIX, userId, chatId);
  if (!key) return '';
  try {
    const v = storage.getItem(key);
    return typeof v === 'string' ? v.slice(0, MAX_DRAFT) : '';
  } catch {
    return '';
  }
}

/** Keeps the text, or forgets it when it is empty. Storage that is blocked or full is ignored. */
export function writeDraft(storage, userId, chatId, text) {
  const key = keyFor(DRAFT_PREFIX, userId, chatId);
  if (!key) return;
  try {
    const t = String(text ?? '');
    if (t.trim() === '') storage.removeItem(key);
    else storage.setItem(key, t.slice(0, MAX_DRAFT));
  } catch { /* blocked or full: the draft is a convenience */ }
}

/**
 * Put text back in a chat's draft without losing what is already waiting there: the text goes first, then a blank
 * line, then what was there. For a message that is given back to a chat that is not on screen.
 */
export function addToDraft(storage, userId, chatId, text) {
  const was = readDraft(storage, userId, chatId);
  writeDraft(storage, userId, chatId, was.trim() && was !== text ? `${text}\n\n${was}` : text);
}

const wholeCredits = (n) => Number.isInteger(n) && n >= 0 && n <= MAX_NOTICE_CREDITS;

/**
 * A mark of a message's text: its length and a 32-bit hash (FNV-1a), never the text. It tells an unchanged message from
 * a changed one, and that is all it is for.
 * @param {string} text
 * @returns {string}
 */
export function textMark(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `${text.length.toString(36)}.${(h >>> 0).toString(36)}`;
}

// The turn a warning is about, checked the same way when it is written and when it is read back: a job id only beside
// a warning its job can settle, and a mark only beside the one that gives the text back, and only with a job.
function turnOf(code, job, mark) {
  if (!ASKABLE.has(code) || typeof job !== 'string' || !JOB_RE.test(job)) return {};
  return code === GIVEN_BACK && typeof mark === 'string' && MARK_RE.test(mark) ? { job, sent: mark } : { job };
}

// One stored notice, as far as it can be trusted: it is short, it parses, and it has a code. Each reader below takes
// from it only the fields it knows, each checked by shape, so nothing else found in storage is passed on.
function stored(storage, userId, chatId) {
  const key = keyFor(NOTICE_PREFIX, userId, chatId);
  if (!key) return null;
  try {
    const raw = storage.getItem(key);
    if (typeof raw !== 'string' || raw.length > MAX_NOTICE) return null;
    const n = JSON.parse(raw);
    return n && ok(n.code) ? n : null;
  } catch {
    return null;
  }
}

/**
 * The notice waiting for a chat ('new' for one not created yet): what the last message sent from it ended with. It
 * is stored beside that chat's draft so that text given back to the box is never there without it, a page reload
 * included. Reading does not forget it. Only a code is stored and only a code is read back: the screen makes the
 * words, so nothing found in storage is shown as it is.
 * @returns {{code: string, credits?: number}|null} `credits` is the price, for the one notice whose words name it
 */
export function readNotice(storage, userId, chatId) {
  const n = stored(storage, userId, chatId);
  if (!n) return null;
  return wholeCredits(n.credits) ? { code: n.code, credits: n.credits } : { code: n.code };
}

/**
 * The notice waiting for a chat when it is a warning about Credits (CREDITS_WARNINGS), else null. A later message
 * that used no Credits (it was refused before it started, or it started and they came back) says nothing about the
 * one before it, so the send asks this first and leaves such a warning kept (useChatSend.js).
 * With it, what was kept about its turn: `job`, the id to ask the server by, and `sent`, the mark of the text that was
 * given back (textMark). Neither is there for a turn that never started.
 * @returns {{code: string, job?: string, sent?: string}|null}
 */
export function readCreditsWarning(storage, userId, chatId) {
  const n = stored(storage, userId, chatId);
  return n && CREDITS_WARNINGS.has(n.code) ? { code: n.code, ...turnOf(n.code, n.job, n.sent) } : null;
}

/**
 * Keep one notice for a chat. A later one replaces it. A code that cannot be kept is kept as 'unknown', which reads
 * as the general failure: something ended badly, and the chat must not look as if nothing did.
 * `job` is the reply's job id and `sent` the text of the message: both are kept only beside a warning that needs them
 * (turnOf above), and the text only as its mark.
 */
export function writeNotice(storage, userId, chatId, code, { credits, job, sent } = {}) {
  const key = keyFor(NOTICE_PREFIX, userId, chatId);
  if (!key) return;
  try {
    const kept = ok(code) ? code : UNKNOWN_NOTICE;
    const n = { code: kept, ...(wholeCredits(credits) && { credits }), ...turnOf(kept, job, typeof sent === 'string' ? textMark(sent) : null) };
    storage.setItem(key, JSON.stringify(n));
  } catch { /* blocked or full: nothing is kept, and the notice is on screen only */ }
}

/** Forget a chat's notice: a later message was sent from that chat (a warning about Credits waits for that message to be saved to the chat, or to end with a warning of its own), the server says the turn it warns about has settled (chatWarning.js), or the chat was deleted. */
export function clearNotice(storage, userId, chatId) {
  const key = keyFor(NOTICE_PREFIX, userId, chatId);
  if (!key) return;
  try { storage.removeItem(key); } catch { /* storage may be unavailable */ }
}

/** @returns {string[]} message ids the user starred in this chat, newest first */
export function readStars(storage, userId, threadId) {
  const key = keyFor(STAR_PREFIX, userId, threadId);
  if (!key) return [];
  try {
    const arr = JSON.parse(storage.getItem(key) || '[]');
    return Array.isArray(arr) ? arr.filter(ok).slice(0, MAX_STARS) : [];
  } catch {
    return [];
  }
}

/** Star or unstar a reply. Returns the new list; unchanged when it cannot be saved. */
export function toggleStar(storage, userId, threadId, messageId) {
  const current = readStars(storage, userId, threadId);
  const key = keyFor(STAR_PREFIX, userId, threadId);
  if (!key || !ok(messageId)) return current;
  const next = current.includes(messageId) ? current.filter((id) => id !== messageId) : [messageId, ...current].slice(0, MAX_STARS);
  try {
    storage.setItem(key, JSON.stringify(next));
    return next;
  } catch {
    return current;
  }
}

/** Forget every draft, notice and star held in this browser, whoever typed them. */
export function clearChatLocal(storage) {
  try {
    for (let i = storage.length - 1; i >= 0; i -= 1) {
      const key = storage.key(i);
      if (key && ALL_PREFIXES.some((p) => key.startsWith(p))) storage.removeItem(key);
    }
  } catch { /* storage may be unavailable */ }
}
