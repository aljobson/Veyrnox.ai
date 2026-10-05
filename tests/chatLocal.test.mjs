import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readDraft, writeDraft, readStars, toggleStar, NEW_CHAT, MAX_DRAFT, MAX_STARS } from '../app/veyrnox/_lib/chatLocal.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), size: () => m.size };
};
const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
const workspace = readFileSync(new URL('../app/veyrnox/_components/chat/ChatWorkspace.js', import.meta.url), 'utf8');

test('a draft is kept per chat and does not leak between chats', () => {
  const s = memory();
  writeDraft(s, NEW_CHAT, 'hello');
  writeDraft(s, 'thread-1', 'second');
  assert.equal(readDraft(s, NEW_CHAT), 'hello');
  assert.equal(readDraft(s, 'thread-1'), 'second');
  assert.equal(readDraft(s, 'thread-2'), '');
});

test('an empty draft is forgotten, not stored', () => {
  const s = memory();
  writeDraft(s, 'thread-1', 'x');
  writeDraft(s, 'thread-1', '   ');
  assert.equal(s.size(), 0);
});

test('a draft is capped and a bad chat id is ignored', () => {
  const s = memory();
  writeDraft(s, 'thread-1', 'a'.repeat(MAX_DRAFT + 50));
  assert.equal(readDraft(s, 'thread-1').length, MAX_DRAFT);
  writeDraft(s, '../evil key', 'x');
  assert.equal(readDraft(s, '../evil key'), '');
  assert.equal(s.size(), 1);
});

test('blocked storage never throws', () => {
  assert.equal(readDraft(blocked, 'thread-1'), '');
  assert.doesNotThrow(() => writeDraft(blocked, 'thread-1', 'x'));
  assert.deepEqual(readStars(blocked, 'thread-1'), []);
  assert.deepEqual(toggleStar(blocked, 'thread-1', 'm1'), []);
});

test('stars toggle on and off, newest first, per thread', () => {
  const s = memory();
  assert.deepEqual(toggleStar(s, 't1', 'm1'), ['m1']);
  assert.deepEqual(toggleStar(s, 't1', 'm2'), ['m2', 'm1']);
  assert.deepEqual(toggleStar(s, 't1', 'm1'), ['m2']);
  assert.deepEqual(readStars(s, 't2'), []);
});

test('stars are capped and corrupt storage reads as empty', () => {
  const s = memory();
  for (let i = 0; i < MAX_STARS + 5; i += 1) toggleStar(s, 't1', `m${i}`);
  assert.equal(readStars(s, 't1').length, MAX_STARS);
  s.setItem('veyrnox_chat_stars_v1:t9', '{not json');
  assert.deepEqual(readStars(s, 't9'), []);
});

test('the workspace restores a draft on open and clears it only after a send', () => {
  assert.match(workspace, /readDraft\(/);
  assert.match(workspace, /writeDraft\(/);
  assert.match(workspace, /toggleStar\(/);
});
