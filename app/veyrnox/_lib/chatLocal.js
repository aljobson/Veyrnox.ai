// Chat conveniences kept in this browser only, like the library favourites:
// an unsent draft per chat and the replies a user starred. Nothing is sent to
// the server, so neither follows the user to another device. Every key carries
// the signed-in user's id, and authClient's setSession calls clearChatLocal
// when the session ends or a different user signs in, so one person's unsent
// text is never shown to the next person to use this browser. With no user id
// nothing is read and nothing is stored.

const DRAFT_PREFIX = 'veyrnox_chat_draft_v2:';
const STAR_PREFIX = 'veyrnox_chat_stars_v2:';
// v1 keys had no user id in them. They are never read, only removed.
const ALL_PREFIXES = [DRAFT_PREFIX, STAR_PREFIX, 'veyrnox_chat_draft_v1:', 'veyrnox_chat_stars_v1:'];
export const NEW_CHAT = 'new';
export const MAX_DRAFT = 8000;
export const MAX_STARS = 200;
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

/** Forget every draft and star held in this browser, whoever typed them. */
export function clearChatLocal(storage) {
  try {
    for (let i = storage.length - 1; i >= 0; i -= 1) {
      const key = storage.key(i);
      if (key && ALL_PREFIXES.some((p) => key.startsWith(p))) storage.removeItem(key);
    }
  } catch { /* storage may be unavailable */ }
}
