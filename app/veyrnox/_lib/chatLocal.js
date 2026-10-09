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
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

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
 * The notice waiting for a chat ('new' for one not created yet): what the last message sent from it ended with. It
 * is stored beside that chat's draft so that text given back to the box is never there without it, a page reload
 * included. Reading does not forget it. Only a code is stored and only a code is read back: the screen makes the
 * words, so nothing found in storage is shown as it is.
 * @returns {{code: string, credits?: number}|null} `credits` is the price, for the one notice whose words name it
 */
export function readNotice(storage, userId, chatId) {
  const key = keyFor(NOTICE_PREFIX, userId, chatId);
  if (!key) return null;
  try {
    const raw = storage.getItem(key);
    if (typeof raw !== 'string' || raw.length > MAX_NOTICE) return null;
    const n = JSON.parse(raw);
    if (!n || !ok(n.code)) return null;
    return wholeCredits(n.credits) ? { code: n.code, credits: n.credits } : { code: n.code };
  } catch {
    return null;
  }
}

/**
 * The notice waiting for a chat when it is a warning about Credits (CREDITS_WARNINGS), else null. A later message
 * that used no Credits (it was refused before it started, or it started and they came back) says nothing about the
 * one before it, so the send asks this first and leaves such a warning kept (useChatSend.js).
 * @returns {{code: string}|null}
 */
export function readCreditsWarning(storage, userId, chatId) {
  const n = readNotice(storage, userId, chatId);
  return n && CREDITS_WARNINGS.has(n.code) ? n : null;
}

/**
 * Keep one notice for a chat. A later one replaces it. A code that cannot be kept is kept as 'unknown', which reads
 * as the general failure: something ended badly, and the chat must not look as if nothing did.
 */
export function writeNotice(storage, userId, chatId, code, { credits } = {}) {
  const key = keyFor(NOTICE_PREFIX, userId, chatId);
  if (!key) return;
  try {
    const n = { code: ok(code) ? code : UNKNOWN_NOTICE };
    storage.setItem(key, JSON.stringify(wholeCredits(credits) ? { ...n, credits } : n));
  } catch { /* blocked or full: nothing is kept, and the notice is on screen only */ }
}

/** Forget a chat's notice: a later message was sent from that chat (a warning about Credits waits for that message to end with the chat read again, or with a warning of its own), or the chat was deleted. */
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
