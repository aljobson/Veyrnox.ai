// Chat conveniences kept in this browser only, like the library favourites:
// an unsent draft per chat and the replies a user starred. Nothing is sent to
// the server, so neither follows the user to another device. Sign-out clears
// localStorage, which removes both.

const DRAFT_PREFIX = 'veyrnox_chat_draft_v1:';
const STAR_PREFIX = 'veyrnox_chat_stars_v1:';
export const NEW_CHAT = 'new';
export const MAX_DRAFT = 8000;
export const MAX_STARS = 200;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const ok = (id) => typeof id === 'string' && ID_RE.test(id);

/** @returns {string} the unsent text for a chat ('new' for one not created yet), or '' */
export function readDraft(storage, chatId) {
  if (!ok(chatId)) return '';
  try {
    const v = storage.getItem(DRAFT_PREFIX + chatId);
    return typeof v === 'string' ? v.slice(0, MAX_DRAFT) : '';
  } catch {
    return '';
  }
}

/** Keeps the text, or forgets it when it is empty. Storage that is blocked or full is ignored. */
export function writeDraft(storage, chatId, text) {
  if (!ok(chatId)) return;
  try {
    const t = String(text ?? '');
    if (t.trim() === '') storage.removeItem(DRAFT_PREFIX + chatId);
    else storage.setItem(DRAFT_PREFIX + chatId, t.slice(0, MAX_DRAFT));
  } catch { /* blocked or full: the draft is a convenience */ }
}

/** @returns {string[]} message ids starred in this chat, newest first */
export function readStars(storage, threadId) {
  if (!ok(threadId)) return [];
  try {
    const arr = JSON.parse(storage.getItem(STAR_PREFIX + threadId) || '[]');
    return Array.isArray(arr) ? arr.filter(ok).slice(0, MAX_STARS) : [];
  } catch {
    return [];
  }
}

/** Star or unstar a reply. Returns the new list; unchanged when it cannot be saved. */
export function toggleStar(storage, threadId, messageId) {
  const current = readStars(storage, threadId);
  if (!ok(threadId) || !ok(messageId)) return current;
  const next = current.includes(messageId) ? current.filter((id) => id !== messageId) : [messageId, ...current].slice(0, MAX_STARS);
  try {
    storage.setItem(STAR_PREFIX + threadId, JSON.stringify(next));
    return next;
  } catch {
    return current;
  }
}
