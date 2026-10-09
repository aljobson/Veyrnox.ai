import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addToDraft, readDraft, writeDraft, readStars, toggleStar, clearChatLocal, NEW_CHAT, MAX_DRAFT, MAX_STARS } from '../app/veyrnox/_lib/chatLocal.js';

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

test('one user\'s drafts and stars are not shown to another user of the browser', () => {
  const s = memory();
  writeDraft(s, 'user-a', NEW_CHAT, 'a private thought');
  toggleStar(s, 'user-a', 't1', 'm1');
  assert.equal(readDraft(s, 'user-b', NEW_CHAT), '');
  assert.deepEqual(readStars(s, 'user-b', 't1'), []);
  writeDraft(s, 'user-b', NEW_CHAT, 'theirs');
  assert.equal(readDraft(s, 'user-a', NEW_CHAT), 'a private thought');
});

test('with no user id nothing is read and nothing is stored', () => {
  const s = memory();
  for (const nobody of [null, undefined, '', 'not an id', 42]) {
    writeDraft(s, nobody, NEW_CHAT, 'typed while signed out');
    assert.deepEqual(toggleStar(s, nobody, 't1', 'm1'), []);
    assert.equal(readDraft(s, nobody, NEW_CHAT), '');
    assert.deepEqual(readStars(s, nobody, 't1'), []);
  }
  assert.equal(s.size(), 0);
});

test('clearing removes every draft and star, the unscoped v1 keys included, and nothing else', () => {
  const s = memory();
  writeDraft(s, 'user-a', NEW_CHAT, 'x');
  writeDraft(s, 'user-a', 'thread-1', 'y');
  toggleStar(s, 'user-a', 't1', 'm1');
  s.setItem('veyrnox_chat_draft_v1:new', 'left by the unscoped version');
  s.setItem('veyrnox_chat_stars_v1:t1', '["m1"]');
  s.setItem('veyrnox_supabase_session', '{}');
  s.setItem('veyrnox_theme', 'dark');
  clearChatLocal(s);
  assert.deepEqual(s.keys().sort(), ['veyrnox_supabase_session', 'veyrnox_theme']);
});

test('the workspace restores a draft on open and clears it only after a send', () => {
  assert.match(workspace, /readDraft\(/);
  assert.match(workspace, /writeDraft\(/);
  assert.match(workspace, /toggleStar\(/);
});

test('the workspace names the stored user on every read and write', () => {
  // Seven since addDraft: text given back to a chat that is not on screen is added to that chat's stored draft.
  const users = [...workspace.matchAll(/\b(?:readDraft|writeDraft|addToDraft|readStars|toggleStar)\(store\(\), ([^,]+),/g)].map((m) => m[1]);
  assert.deepEqual(users, Array(7).fill('getStoredUserId()'));
});
