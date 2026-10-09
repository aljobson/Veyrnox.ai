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
export const MAX_NOTICE = 320; // characters of one stored notice: a code, the number its words may need, and for a warning the turns it stands for (315 at most)
export const MAX_TURNS = 4;    // turns one warning can list. One more and it lists none: it is then never asked about (turnsFor below)
const MAX_NOTICE_CREDITS = 1_000_000;
const UNKNOWN_NOTICE = 'unknown';
// Notices that say Credits were used, or still may be, by a message the chat does not show: Stop or a dropped
// connection with the turn not settled, and a reply that was charged but could not be stored. Every other notice is
// about a message that is settled, and either used no Credits or is in the chat with its price.
const CREDITS_WARNINGS = new Set(['stop_unsure', 'stop_saving', 'connection_lost', 'reply_not_saved']);
// The three whose turn was not settled when the look for it ended. What the server can be asked about that turn by is
// kept with them (chatWarning.js): the job id that came with `start`, or, when Stop came before `start`, the key the
// send went out with. `reply_not_saved` is settled already, charged, so there is nothing to ask.
const ASKABLE = new Set(['stop_unsure', 'stop_saving', 'connection_lost']);
// The one of them that is kept with its message given back to the box. A mark of that text is kept with it: if the turn
// turns out to be saved, the box is emptied only while it still holds exactly that message.
const GIVEN_BACK = 'stop_unsure';
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const JOB_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i; // a job id as the server makes them
const KEY_RE = /^vx-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/; // a send's idempotency key as the browser makes them (gateway.js)
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

// One turn a warning is about, checked the same way when it is written and when it is read back: what the server can be
// asked by (a job id, or with none the send's key), and the mark of its text when the text was given back. Null when
// there is nothing to ask by: a mark alone is never kept.
function turn(job, key, mark) {
  const by = typeof job === 'string' && JOB_RE.test(job) ? { job } : typeof key === 'string' && KEY_RE.test(key) ? { key } : null;
  return by && typeof mark === 'string' && MARK_RE.test(mark) ? { ...by, sent: mark } : by;
}

/**
 * The turns a warning can be asked about, oldest first: one for each message it stands for, or none. A warning that
 * took the place of another stands for both, and lists both (turnsFor below).
 * @param {{job?: string, key?: string, sent?: string, turns?: object[]}|null|undefined} warning as readCreditsWarning returns it
 * @returns {Array<{job?: string, key?: string, sent?: string}>}
 */
export function turnsOf(warning) {
  if (!warning || typeof warning !== 'object') return [];
  if (Array.isArray(warning.turns)) return warning.turns;
  const one = turn(warning.job, warning.key, warning.sent);
  return one ? [one] : [];
}

// What a notice is stored with for its turns. One turn is stored as it was before a warning could list several
// (`job` or `key`, and `sent`), so a record written by an earlier version of this page reads the same.
const withTurns = (turns) => (turns.length > 1 ? { turns } : turns.length === 1 ? turns[0] : {});

// The turns read back from one stored notice. A list is read whole or not at all: if one turn in it cannot be asked
// about, the others must not settle the warning without it.
function storedTurns(n) {
  if (!ASKABLE.has(n.code)) return [];
  if (n.turns === undefined) { const one = turn(n.job, n.key, n.code === GIVEN_BACK ? n.sent : null); return one ? [one] : []; }
  if (!Array.isArray(n.turns) || n.turns.length < 2 || n.turns.length > MAX_TURNS || n.job !== undefined || n.key !== undefined) return [];
  const turns = n.turns.map((t) => (t && typeof t === 'object' ? turn(t.job, t.key, t.sent) : null));
  return turns.every(Boolean) ? turns : [];
}

// The turns a warning being written stands for: its own, after those of each warning it takes the place of. If any of
// them cannot be listed (it had nothing to ask by, or there are more than MAX_TURNS) none is kept: answers about some
// of the turns must never settle a warning that also stands for another.
function turnsFor(code, own, earlier) {
  if (!ASKABLE.has(code) || !own) return [];
  const lists = earlier.filter(Boolean).map(turnsOf);
  if (lists.some((list) => !list.length)) return [];
  const all = [...lists.flat().map((t) => turn(t.job, t.key, t.sent)), own];
  return all.every(Boolean) && all.length <= MAX_TURNS ? all : [];
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
 * included. Reading does not forget it. Only a code is read back here, never words: the screen makes the words, so
 * nothing found in storage is shown as it is. What else a warning is kept with is read by readCreditsWarning.
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
 * With it, what was kept about its turn: `job`, the id to ask the server by, or `key`, the send's own key when no job
 * id came, and `sent`, the mark of the text that was given back (textMark). A warning that stands for several turns
 * has `turns` in their place, one entry of that shape for each. turnsOf() lists them either way.
 * @returns {{code: string, job?: string, key?: string, sent?: string, turns?: object[]}|null}
 */
export function readCreditsWarning(storage, userId, chatId) {
  const n = stored(storage, userId, chatId);
  return n && CREDITS_WARNINGS.has(n.code) ? { code: n.code, ...withTurns(storedTurns(n)) } : null;
}

/**
 * Keep one notice for a chat. A later one replaces it. A code that cannot be kept is kept as 'unknown', which reads
 * as the general failure: something ended badly, and the chat must not look as if nothing did.
 * `job` is the reply's job id, `key` the idempotency key its send went out with, and `sent` the text of the message:
 * they are kept only beside a warning that needs them, the key only with no job, and the text only as its mark.
 * A warning written over a kept warning stands for that one's turns too. So does one written `after` a warning that
 * was forgotten elsewhere for it (the send hook forgets the one of the chat a message was sent from, and the ending
 * can land in another chat). turnsFor above keeps them all, or none.
 */
export function writeNotice(storage, userId, chatId, code, { credits, job, key, sent, after } = {}) {
  const at = keyFor(NOTICE_PREFIX, userId, chatId);
  if (!at) return;
  try {
    const kept = ok(code) ? code : UNKNOWN_NOTICE;
    const own = turn(job, key, kept === GIVEN_BACK && typeof sent === 'string' ? textMark(sent) : null);
    const turns = turnsFor(kept, own, [after, readCreditsWarning(storage, userId, chatId)]);
    storage.setItem(at, JSON.stringify({ code: kept, ...(wholeCredits(credits) && { credits }), ...withTurns(turns) }));
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
