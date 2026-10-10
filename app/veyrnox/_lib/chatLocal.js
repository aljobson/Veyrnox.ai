// Chat conveniences kept in this browser only, like the library favourites:
// an unsent draft per chat, the notice that goes with it (and, for a warning
// that stands for several messages, the list of them), and the replies a
// user starred. Nothing is sent to the server, so none of it follows the user
// to another device. Every key carries
// the signed-in user's id, and authClient's setSession calls clearChatLocal
// when the session ends or a different user signs in, so one person's unsent
// text is never shown to the next person to use this browser. With no user id
// nothing is read and nothing is stored.

const DRAFT_PREFIX = 'veyrnox_chat_draft_v2:';
const STAR_PREFIX = 'veyrnox_chat_stars_v2:';
const NOTICE_PREFIX = 'veyrnox_chat_notice_v1:';
const TURNS_PREFIX = 'veyrnox_chat_turns_v1:'; // beside a chat's notice: the turns of a warning that stands for several messages
// The v1 draft and star keys had no user id in them. They are never read, only removed.
const ALL_PREFIXES = [DRAFT_PREFIX, STAR_PREFIX, NOTICE_PREFIX, TURNS_PREFIX, 'veyrnox_chat_draft_v1:', 'veyrnox_chat_stars_v1:'];
export const NEW_CHAT = 'new';
export const MAX_DRAFT = 8000;
export const MAX_STARS = 200;
export const MAX_NOTICE = 120; // characters of one stored notice: a code, the number its words may need, and for a warning its one turn (95 at most)
export const MAX_TURNS = 4;    // turns one warning can list. One more and it lists none: it is then never asked about (turnsFor below)
export const MAX_TURNS_RECORD = 320; // characters of one stored list of turns (313 at most)
const MAX_NOTICE_CREDITS = 1_000_000;
const UNKNOWN_NOTICE = 'unknown';
// Notices that say Credits were used, or still may be, by a message the chat does not show: Stop or a dropped
// connection with the turn not settled, and a reply that was charged but could not be stored. Every other notice is
// about a message that is settled, and either used no Credits or is in the chat with its price.
const CREDITS_WARNINGS = new Set(['stop_unsure', 'stop_saving', 'connection_lost', 'reply_not_saved']);
// The three whose turn was not settled when the look for it ended. What the server can be asked about that turn by is
// kept with them (chatWarning.js): the reply's job id (it came with `start`, or the server named it), or, with none, the
// key the send went out with. `reply_not_saved` is settled already, charged, so there is nothing to ask.
const ASKABLE = new Set(['stop_unsure', 'stop_saving', 'connection_lost']);
// The one of them that is always kept with its message given back to the box. A mark of that text is kept with it: if
// the turn turns out to be saved, the box is emptied only while it still holds exactly that message.
const GIVEN_BACK = 'stop_unsure';
// A dropped connection's warning is kept by the send's key, with no job id, in one ending only: no `start` came, the
// message's own request got no answer, and the server could say nothing final about the send (useChatSend.js). That
// ending puts the message back in its chat's box or stored draft, so the mark is kept with it. Kept by a job id, the
// message was left on screen as sent, and no mark is kept. (The server's job ids always have a job id's shape. One
// that did not would be kept by the key as well, with the mark of a message that is not in the box: a mark only ever
// empties a box that still holds exactly that text.)
const DROPPED = 'connection_lost';
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const JOB_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i; // a job id as the server makes them
const KEY_RE = /^vx-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/; // a send's idempotency key as the browser makes them (gateway.js)
const MARK_RE = /^[0-9a-z]{1,4}\.[0-9a-z]{1,7}$/;
const TAG_RE = /^[0-9a-z]{8}$/; // what ties a notice to its list of turns

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

// The one turn of a warning with this code, with its mark only when that warning's message was given back (above).
// The same rule when it is written and when it is read back, so a mark found anywhere else in storage is not passed on.
function ownTurn(code, job, key, mark) {
  const by = turn(job, key, null);
  return by && (code === GIVEN_BACK || (code === DROPPED && !by.job)) ? turn(job, key, mark) : by;
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

// What a warning is read back with for its turns: one as PR 764 read it (`job` or `key`, and `sent`), several as `turns`.
const withTurns = (turns) => (turns.length > 1 ? { turns } : turns.length === 1 ? turns[0] : {});

// Where a warning's turns are stored. One turn sits in the notice itself, as it did before a warning could list several.
// Several sit in a record of their own beside it, and the notice carries only a tag (`list`) that the record repeats.
// A page still running the code from before this reads a notice of 120 characters at most, and one that is longer as no
// notice at all: it would show nothing for the chat and forget the warning at the next send. Kept this way, it reads
// the notice as that warning with nothing to ask by, which is what it kept itself for a warning that stood for two
// messages. And a notice it writes over this one has no tag, so the list that was beside the old one is not read for it.
// A list is read whole or not at all: if one turn in it cannot be asked about, the others must not settle the warning
// without it.
function storedTurns(storage, userId, chatId, n) {
  if (!ASKABLE.has(n.code)) return [];
  if (n.list === undefined) { const one = ownTurn(n.code, n.job, n.key, n.sent); return one ? [one] : []; }
  if (typeof n.list !== 'string' || !TAG_RE.test(n.list) || n.job !== undefined || n.key !== undefined) return [];
  try {
    const raw = storage.getItem(keyFor(TURNS_PREFIX, userId, chatId));
    if (typeof raw !== 'string' || raw.length > MAX_TURNS_RECORD) return [];
    const kept = JSON.parse(raw);
    if (!kept || kept.list !== n.list || !Array.isArray(kept.turns) || kept.turns.length < 2 || kept.turns.length > MAX_TURNS) return [];
    const turns = kept.turns.map((t) => (t && typeof t === 'object' ? turn(t.job, t.key, t.sent) : null));
    return turns.every(Boolean) ? turns : [];
  } catch {
    return [];
  }
}

// The turns a warning being written stands for: its own, after those of each warning it takes the place of. If any of
// them cannot be listed (it had nothing to ask by, or there are more than MAX_TURNS) none is kept: answers about some
// of the turns must never settle a warning that also stands for another. A turn handed in twice (the warning read
// before the write is also the one still kept there) is listed once.
function turnsFor(code, own, earlier) {
  if (!ASKABLE.has(code) || !own) return [];
  const lists = earlier.filter(Boolean).map(turnsOf);
  if (lists.some((list) => !list.length)) return [];
  const all = [...lists.flat().map((t) => turn(t.job, t.key, t.sent)), own];
  if (!all.every(Boolean)) return [];
  const seen = new Set();
  const each = all.filter((t) => { const by = t.job || t.key; if (seen.has(by)) return false; seen.add(by); return true; });
  return each.length <= MAX_TURNS ? each : [];
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
  return n && CREDITS_WARNINGS.has(n.code) ? { code: n.code, ...withTurns(storedTurns(storage, userId, chatId, n)) } : null;
}

/**
 * Keep one notice for a chat. A later one replaces it. A code that cannot be kept is kept as 'unknown', which reads
 * as the general failure: something ended badly, and the chat must not look as if nothing did.
 * `job` is the reply's job id, `key` the idempotency key its send went out with, and `sent` the text of the message:
 * they are kept only beside a warning that needs them, the key only with no job, and the text only as its mark and
 * only when that warning gave the message back to the box.
 * A warning written over a kept warning stands for that one's turns too. So does one written `after` a warning that
 * was forgotten elsewhere for it (the send hook forgets the one of the chat a message was sent from, and the ending
 * can land in another chat). turnsFor above keeps them all, or none.
 */
export function writeNotice(storage, userId, chatId, code, { credits, job, key, sent, after } = {}) {
  const at = keyFor(NOTICE_PREFIX, userId, chatId);
  if (!at) return;
  try {
    const kept = ok(code) ? code : UNKNOWN_NOTICE;
    const own = ownTurn(kept, job, key, typeof sent === 'string' ? textMark(sent) : null);
    const turns = turnsFor(kept, own, [after, readCreditsWarning(storage, userId, chatId)]);
    // Several turns: their list first, then the notice that names it. If the second write fails, the notice still
    // there names another list or none, and has nothing to ask by.
    const list = turns.length > 1 ? Math.random().toString(36).slice(2, 10).padEnd(8, '0') : null;
    const beside = keyFor(TURNS_PREFIX, userId, chatId);
    if (list) storage.setItem(beside, JSON.stringify({ list, turns })); else storage.removeItem(beside);
    storage.setItem(at, JSON.stringify({ code: kept, ...(wholeCredits(credits) && { credits }), ...(list ? { list } : turns[0]) }));
  } catch { /* blocked or full: nothing is kept, and the notice is on screen only */ }
}

/** Forget a chat's notice: a later message was sent from that chat (a warning about Credits waits for that message to be saved to the chat, or to end with a warning of its own), the server says the turn it warns about has settled (chatWarning.js), or the chat was deleted. */
export function clearNotice(storage, userId, chatId) {
  const key = keyFor(NOTICE_PREFIX, userId, chatId);
  if (!key) return;
  try { storage.removeItem(key); storage.removeItem(keyFor(TURNS_PREFIX, userId, chatId)); } catch { /* storage may be unavailable */ }
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
