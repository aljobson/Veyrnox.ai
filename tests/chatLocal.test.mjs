import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addToDraft, readDraft, writeDraft, readStars, toggleStar, readNotice, writeNotice, clearNotice, clearChatLocal, NEW_CHAT, MAX_DRAFT, MAX_STARS, MAX_NOTICE } from '../app/veyrnox/_lib/chatLocal.js';

const memory = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i], get length() { return m.size; }, size: () => m.size, keys: () => [...m.keys()],
  };
};
const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
const workspace = readFileSync(new URL('../app/veyrnox/_components/chat/ChatWorkspace.js', import.meta.url), 'utf8');
const ME = 'user-a';
/** The one stored notice, as it sits in storage. */
const rawNotice = (s, chat) => s.keys().find((k) => k.startsWith('veyrnox_chat_notice_') && k.endsWith(`:${chat}`));

test('a draft is kept per chat and does not leak between chats', () => {
  const s = memory();
  writeDraft(s, ME, NEW_CHAT, 'hello');
  writeDraft(s, ME, 'thread-1', 'second');
  assert.equal(readDraft(s, ME, NEW_CHAT), 'hello');
  assert.equal(readDraft(s, ME, 'thread-1'), 'second');
  assert.equal(readDraft(s, ME, 'thread-2'), '');
});

test('text given back to a chat is added to its draft, above what is already waiting there', () => {
  const s = memory();
  addToDraft(s, ME, 'thread-1', 'the message that came back');
  assert.equal(readDraft(s, ME, 'thread-1'), 'the message that came back', 'an empty draft just takes it');
  writeDraft(s, ME, 'thread-2', 'typed since');
  addToDraft(s, ME, 'thread-2', 'the message that came back');
  assert.equal(readDraft(s, ME, 'thread-2'), 'the message that came back\n\ntyped since', 'neither text is lost');
  // The same text is not stacked on itself, and a blank draft counts as empty.
  addToDraft(s, ME, 'thread-1', 'the message that came back');
  assert.equal(readDraft(s, ME, 'thread-1'), 'the message that came back');
  writeDraft(s, ME, NEW_CHAT, 'x'); s.setItem([...s.keys()].find((k) => k.endsWith(`:${NEW_CHAT}`)), '   ');
  addToDraft(s, ME, NEW_CHAT, 'back');
  assert.equal(readDraft(s, ME, NEW_CHAT), 'back');
  // With no user, or storage that is blocked, nothing is read and nothing is stored.
  addToDraft(s, '', 'thread-3', 'x');
  assert.equal(readDraft(s, ME, 'thread-3'), '');
  assert.doesNotThrow(() => addToDraft(blocked, ME, 'thread-1', 'x'));
});

test('an empty draft is forgotten, not stored', () => {
  const s = memory();
  writeDraft(s, ME, 'thread-1', 'x');
  writeDraft(s, ME, 'thread-1', '   ');
  assert.equal(s.size(), 0);
});

test('a draft is capped and a bad chat id is ignored', () => {
  const s = memory();
  writeDraft(s, ME, 'thread-1', 'a'.repeat(MAX_DRAFT + 50));
  assert.equal(readDraft(s, ME, 'thread-1').length, MAX_DRAFT);
  writeDraft(s, ME, '../evil key', 'x');
  assert.equal(readDraft(s, ME, '../evil key'), '');
  assert.equal(s.size(), 1);
});

test('blocked storage never throws', () => {
  assert.equal(readDraft(blocked, ME, 'thread-1'), '');
  assert.doesNotThrow(() => writeDraft(blocked, ME, 'thread-1', 'x'));
  assert.deepEqual(readStars(blocked, ME, 'thread-1'), []);
  assert.deepEqual(toggleStar(blocked, ME, 'thread-1', 'm1'), []);
  assert.equal(readNotice(blocked, ME, 'thread-1'), null);
  assert.doesNotThrow(() => writeNotice(blocked, ME, 'thread-1', 'stop_unsure'));
  assert.doesNotThrow(() => clearNotice(blocked, ME, 'thread-1'));
  assert.doesNotThrow(() => clearChatLocal(blocked));
  assert.doesNotThrow(() => clearChatLocal(null));
});

test('stars toggle on and off, newest first, per thread', () => {
  const s = memory();
  assert.deepEqual(toggleStar(s, ME, 't1', 'm1'), ['m1']);
  assert.deepEqual(toggleStar(s, ME, 't1', 'm2'), ['m2', 'm1']);
  assert.deepEqual(toggleStar(s, ME, 't1', 'm1'), ['m2']);
  assert.deepEqual(readStars(s, ME, 't2'), []);
});

test('stars are capped and corrupt storage reads as empty', () => {
  const s = memory();
  for (let i = 0; i < MAX_STARS + 5; i += 1) toggleStar(s, ME, 't1', `m${i}`);
  assert.equal(readStars(s, ME, 't1').length, MAX_STARS);
  toggleStar(s, ME, 't9', 'm1');
  s.setItem(s.keys().find((k) => k.endsWith(':t9')), '{not json');
  assert.deepEqual(readStars(s, ME, 't9'), []);
});

test('one user\'s drafts, stars and notices are not shown to another user of the browser', () => {
  const s = memory();
  writeDraft(s, 'user-a', NEW_CHAT, 'a private thought');
  toggleStar(s, 'user-a', 't1', 'm1');
  writeNotice(s, 'user-a', 't1', 'stop_unsure');
  assert.equal(readDraft(s, 'user-b', NEW_CHAT), '');
  assert.deepEqual(readStars(s, 'user-b', 't1'), []);
  assert.equal(readNotice(s, 'user-b', 't1'), null);
  writeDraft(s, 'user-b', NEW_CHAT, 'theirs');
  assert.equal(readDraft(s, 'user-a', NEW_CHAT), 'a private thought');
});

test('with no user id nothing is read and nothing is stored', () => {
  const s = memory();
  for (const nobody of [null, undefined, '', 'not an id', 42]) {
    writeDraft(s, nobody, NEW_CHAT, 'typed while signed out');
    assert.deepEqual(toggleStar(s, nobody, 't1', 'm1'), []);
    writeNotice(s, nobody, 't1', 'stop_unsure');
    assert.equal(readDraft(s, nobody, NEW_CHAT), '');
    assert.deepEqual(readStars(s, nobody, 't1'), []);
    assert.equal(readNotice(s, nobody, 't1'), null);
  }
  assert.equal(s.size(), 0);
});

test('clearing removes every draft, star and notice, the unscoped v1 keys included, and nothing else', () => {
  const s = memory();
  writeDraft(s, 'user-a', NEW_CHAT, 'x');
  writeDraft(s, 'user-a', 'thread-1', 'y');
  toggleStar(s, 'user-a', 't1', 'm1');
  writeNotice(s, 'user-a', 'thread-1', 'stop_unsure');
  writeNotice(s, 'user-b', NEW_CHAT, 'connection_refunded');
  s.setItem('veyrnox_chat_draft_v1:new', 'left by the unscoped version');
  s.setItem('veyrnox_chat_stars_v1:t1', '["m1"]');
  s.setItem('veyrnox_supabase_session', '{}');
  s.setItem('veyrnox_theme', 'dark');
  clearChatLocal(s);
  assert.deepEqual(s.keys().sort(), ['veyrnox_supabase_session', 'veyrnox_theme']);
});

// ---- a chat's notice: what the last message sent from it ended with ----
// It was held in memory and lost on a page reload, while the text that was given back with it was not. So a message
// could sit in a chat's box with nothing saying that its first send might still be saved and use Credits.

test('a notice is kept per chat, and is still there however often it is read', () => {
  const s = memory();
  writeNotice(s, ME, 'thread-1', 'stop_unsure');
  assert.deepEqual(readNotice(s, ME, 'thread-1'), { code: 'stop_unsure' });
  assert.deepEqual(readNotice(s, ME, 'thread-1'), { code: 'stop_unsure' }, 'reading it does not forget it: a reload after it was shown must show it again');
  assert.equal(readNotice(s, ME, 'thread-2'), null, 'never in another chat');
  assert.equal(readNotice(s, ME, NEW_CHAT), null, 'nor under New chat');
  // A message whose chat no longer exists leaves its notice under New chat, beside its text.
  writeNotice(s, ME, NEW_CHAT, 'connection_refunded');
  assert.deepEqual(readNotice(s, ME, NEW_CHAT), { code: 'connection_refunded' });
  assert.deepEqual(readNotice(s, ME, 'thread-1'), { code: 'stop_unsure' });
});

test('a later notice for the same chat replaces the one kept', () => {
  const s = memory();
  writeNotice(s, ME, 'thread-1', 'insufficient_balance', { credits: 3 });
  writeNotice(s, ME, 'thread-1', 'connection_lost');
  assert.deepEqual(readNotice(s, ME, 'thread-1'), { code: 'connection_lost' }, 'and nothing of the first is left, its number included');
  assert.equal(s.size(), 1);
});

test('a notice that needs a number keeps the number', () => {
  const s = memory();
  writeNotice(s, ME, 'thread-1', 'insufficient_balance', { credits: 12 });
  assert.deepEqual(readNotice(s, ME, 'thread-1'), { code: 'insufficient_balance', credits: 12 });
  // A number that is not a whole count of Credits is left out: the words then say "more", as they do with no number.
  for (const bad of [-1, 1.5, NaN, Infinity, '12', null, 10_000_000]) {
    writeNotice(s, ME, 'thread-1', 'insufficient_balance', { credits: bad });
    assert.deepEqual(readNotice(s, ME, 'thread-1'), { code: 'insufficient_balance' });
  }
});

test('a notice is stored as a code, never as words, and only a code is ever read back', () => {
  const s = memory();
  writeNotice(s, ME, 'thread-1', 'stop_unsure');
  assert.equal(s.getItem(rawNotice(s, 'thread-1')), '{"code":"stop_unsure"}');
  // Whatever else is found in storage is not handed to the screen: words, markup, another shape, too much of it.
  const key = rawNotice(s, 'thread-1');
  const not = ['Stopped before any text arrived.', '{"code":"<b>free Credits</b>"}', '{"code":"has spaces"}', '{"text":"hello"}',
    '"stop_unsure"', '["stop_unsure"]', 'null', '42', '{not json', '', `{"code":"${'a'.repeat(65)}"}`, `{"code":"stop_unsure","pad":"${'x'.repeat(MAX_NOTICE)}"}`];
  for (const raw of not) {
    s.setItem(key, raw);
    assert.equal(readNotice(s, ME, 'thread-1'), null, raw.slice(0, 40));
  }
  // Extra fields are dropped, and a number that is not a count of Credits is too.
  s.setItem(key, '{"code":"insufficient_balance","credits":"<i>9</i>","words":"x"}');
  assert.deepEqual(readNotice(s, ME, 'thread-1'), { code: 'insufficient_balance' });
});

test('a notice with a code that cannot be kept is kept as unknown, so the chat does not look as if nothing happened', () => {
  const s = memory();
  // A refusal with no code, or one the server worded oddly. The screen's words for an unknown code are the general ones.
  for (const odd of [undefined, null, '', 'HTTP 500', 42, 'a'.repeat(65)]) {
    writeNotice(s, ME, 'thread-1', 'stop_unsure');
    writeNotice(s, ME, 'thread-1', odd);
    assert.deepEqual(readNotice(s, ME, 'thread-1'), { code: 'unknown' }, 'and it replaces the one before it');
  }
});

test('a notice is forgotten on its own: the draft beside it, and other chats, are left alone', () => {
  const s = memory();
  writeDraft(s, ME, 'thread-1', 'the message that came back');
  writeNotice(s, ME, 'thread-1', 'stop_unsure');
  writeNotice(s, ME, 'thread-2', 'connection_lost');
  clearNotice(s, ME, 'thread-1');
  assert.equal(readNotice(s, ME, 'thread-1'), null);
  assert.equal(readDraft(s, ME, 'thread-1'), 'the message that came back');
  assert.deepEqual(readNotice(s, ME, 'thread-2'), { code: 'connection_lost' });
  assert.doesNotThrow(() => clearNotice(s, ME, 'thread-9'), 'nothing kept: nothing to do');
});

test('a notice with a bad chat id is neither stored nor read', () => {
  const s = memory();
  writeNotice(s, ME, '../evil key', 'stop_unsure');
  assert.equal(readNotice(s, ME, '../evil key'), null);
  assert.equal(s.size(), 0);
});

test('the workspace restores a draft on open and clears it only after a send', () => {
  assert.match(workspace, /readDraft\(/);
  assert.match(workspace, /writeDraft\(/);
  assert.match(workspace, /toggleStar\(/);
});

test('the workspace names the stored user on every read and write', () => {
  // Seven since addDraft: text given back to a chat that is not on screen is added to that chat's stored draft.
  // Ten since a chat's notice is stored: it is kept, read and forgotten for the same user as the draft beside it.
  const users = [...workspace.matchAll(/\b(?:readDraft|writeDraft|addToDraft|readStars|toggleStar|readNotice|writeNotice|clearNotice)\(store\(\), ([^,]+),/g)].map((m) => m[1]);
  assert.deepEqual(users, Array(10).fill('getStoredUserId()'));
});

test('the workspace turns a stored notice into words itself, each time it is shown', () => {
  // The words come from chatErrorCopy, from the code: what is in storage is never put on screen as it is. The record
  // is passed as the second argument for the number a notice may need (`credits`).
  assert.match(workspace, /\nconst waiting = \(chatId\) => \{ const n = readNotice\(store\(\), getStoredUserId\(\), chatId\); return n \? chatErrorCopy\(n\.code, n\) : null; \};\n/);
  assert.match(workspace, /\nconst keepNotice = \(chatId, code, extra\) => writeNotice\(store\(\), getStoredUserId\(\), chatId, code, extra\);\n/);
  assert.match(workspace, /\nconst dropNotice = \(chatId\) => clearNotice\(store\(\), getStoredUserId\(\), chatId\);\n/);
});
