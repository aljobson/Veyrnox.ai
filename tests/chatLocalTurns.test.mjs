// What a kept warning is stored with, now that it can be asked about without a job id (ADR-0067 amendment 11).
// PR 764 kept the reply's job id with a warning, and named two warnings it could not settle: Stop before `start`
// (no job id ever reached the browser) and a warning that took the place of another (one job cannot answer for two
// turns, so it kept none). The store now keeps, with a warning:
//   - the send's own idempotency key when there is no job id. The browser makes the key before any request, and the
//     server can be asked about a send by it (POST /api/v1/chat/sends/close);
//   - every turn the warning stands for, up to MAX_TURNS, when it took the place of another. Past that it keeps none.
// Storage is not trusted: each field is read back only in its own shape, and a list of turns whole or not at all.
// tests/chatLocal.test.mjs holds the rest of the store; tests/chatWarningTurns.test.mjs what is done with the answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DRAFT, MAX_NOTICE, MAX_TURNS, clearNotice, readCreditsWarning, readNotice, textMark, turnsOf, writeNotice } from '../app/veyrnox/_lib/chatLocal.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), keys: () => [...m.keys()] };
};
const ME = 'user-a';
const CHAT = 'thread-1';
const JOB = '6f1d2c3a-0b4e-4c5d-8e9f-a1b2c3d4e5f6';
const JOB_2 = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const KEY = 'vx-1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const KEY_2 = 'vx-9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';
const ASKABLE = ['stop_unsure', 'stop_saving', 'connection_lost'];
const keyOf = (s, chat = CHAT) => s.keys().find((k) => k.startsWith('veyrnox_chat_notice_') && k.endsWith(`:${chat}`));
const raw = (s, chat = CHAT) => s.getItem(keyOf(s, chat));
const kept = (s, chat = CHAT) => readCreditsWarning(s, ME, chat);

// ---- a send that never started: its own key ----

test('a warning with no job keeps the key its send went out with, and the words-facing read never carries it', () => {
  const s = memory();
  for (const code of ASKABLE) {
    clearNotice(s, ME, CHAT); writeNotice(s, ME, CHAT, code, { key: KEY });
    assert.deepEqual(kept(s), { code, key: KEY }, code);
    assert.deepEqual(readNotice(s, ME, CHAT), { code }, code);
  }
  assert.equal(raw(s), `{"code":"connection_lost","key":"${KEY}"}`);
  // The one that gives the message back keeps the mark of its text beside the key too, never the text.
  clearNotice(s, ME, CHAT); writeNotice(s, ME, CHAT, 'stop_unsure', { key: KEY, sent: 'Describe a lighthouse.' });
  assert.deepEqual(kept(s), { code: 'stop_unsure', key: KEY, sent: textMark('Describe a lighthouse.') });
  assert.doesNotMatch(raw(s), /lighthouse/);
  // A job id is the better thing to ask by (a read, and nothing else): with one, the key is not kept.
  clearNotice(s, ME, CHAT); writeNotice(s, ME, CHAT, 'stop_unsure', { job: JOB, key: KEY, sent: 'hello' });
  assert.deepEqual(kept(s), { code: 'stop_unsure', job: JOB, sent: textMark('hello') });
  assert.doesNotMatch(raw(s), /key/);
  // A job that is not a job id (none came, or a test's `job-1`) leaves the key.
  for (const none of [null, undefined, '', 'job-1']) {
    clearNotice(s, ME, CHAT); writeNotice(s, ME, CHAT, 'stop_unsure', { job: none, key: KEY, sent: 'hello' });
    assert.deepEqual(kept(s), { code: 'stop_unsure', key: KEY, sent: textMark('hello') }, String(none));
  }
});

test('a key is kept only beside a warning the server can be asked about', () => {
  const s = memory();
  for (const code of ['reply_not_saved', 'connection_saved', 'connection_refunded', 'stop_saved', 'turns_settled', 'insufficient_balance', 'provider_cut_off', 'unknown']) {
    clearNotice(s, ME, CHAT); writeNotice(s, ME, CHAT, code, { key: KEY, job: JOB, sent: 'hello', credits: 2 });
    assert.doesNotMatch(raw(s), /"(?:key|job|sent|turns)"/, code);
  }
});

test('storage is not trusted: a key is read back only in the shape the browser makes, and a bad one leaves the warning with nothing to ask', () => {
  const s = memory();
  writeNotice(s, ME, CHAT, 'stop_unsure');
  const at = keyOf(s);
  const mark = textMark('hello');
  // `vx-` and a lower-case UUID, the whole string: that is what makeIdempotencyKey() returns, and nothing else is sent.
  const badKeys = ['key', 'key-0123456789', KEY.slice(3), KEY.toUpperCase(), `VX-${KEY.slice(3)}`, `vx_${KEY.slice(3)}`, `${KEY}0`, `0${KEY}`, ` ${KEY}`, `${KEY}\n`, `../${KEY}`,
    `${KEY}/x`, `${KEY}?x=1`, `vx-${'f'.repeat(36)}`, `vx-${'-'.repeat(36)}`, KEY.replace('1b2c', '1g2c'), '', ' ', 42, null, true, [KEY], { key: KEY }];
  for (const bad of badKeys) {
    s.setItem(at, JSON.stringify({ code: 'stop_unsure', key: bad, sent: mark }));
    assert.deepEqual(kept(s), { code: 'stop_unsure' }, `${JSON.stringify(bad)}: still a warning, with nothing to ask, and no mark without a turn`);
    writeNotice(s, ME, CHAT, 'connection_lost', { key: bad });
    assert.equal(s.getItem(at), '{"code":"connection_lost"}', `not written either: ${JSON.stringify(bad)}`);
  }
  // A job and a key side by side (not something the screen writes): the job is the one read back.
  s.setItem(at, JSON.stringify({ code: 'stop_unsure', job: JOB, key: KEY, sent: mark }));
  assert.deepEqual(kept(s), { code: 'stop_unsure', job: JOB, sent: mark });
  // A key beside a notice that cannot be asked about is not read back, whatever put it there.
  s.setItem(at, JSON.stringify({ code: 'reply_not_saved', key: KEY }));
  assert.deepEqual(kept(s), { code: 'reply_not_saved' });
});

test('turnsOf lists what a warning can be asked about: one turn, several, or none', () => {
  assert.deepEqual(turnsOf({ code: 'stop_unsure', job: JOB, sent: '5.abc' }), [{ job: JOB, sent: '5.abc' }]);
  assert.deepEqual(turnsOf({ code: 'connection_lost', key: KEY }), [{ key: KEY }]);
  const turns = [{ job: JOB }, { key: KEY, sent: '5.abc' }];
  assert.deepEqual(turnsOf({ code: 'stop_unsure', turns }), turns);
  for (const none of [null, undefined, {}, { code: 'stop_unsure' }, { code: 'reply_not_saved' }, { code: 'stop_unsure', turns: [] }, { code: 'stop_unsure', turns: 'x' }, 'stop_unsure', 42]) {
    assert.deepEqual(turnsOf(none), [], JSON.stringify(none));
  }
});

// ---- one warning, several turns ----

test('a warning written over a kept warning keeps both turns, in the order they were sent', () => {
  const s = memory();
  writeNotice(s, ME, CHAT, 'stop_unsure', { job: JOB, sent: 'one' });
  writeNotice(s, ME, CHAT, 'stop_saving', { job: JOB_2, sent: 'two' });
  assert.deepEqual(kept(s), { code: 'stop_saving', turns: [{ job: JOB, sent: textMark('one') }, { job: JOB_2 }] }, 'each turn keeps the mark it was written with, or none');
  assert.equal(raw(s), `{"code":"stop_saving","turns":[{"job":"${JOB}","sent":"${textMark('one')}"},{"job":"${JOB_2}"}]}`);
  assert.deepEqual(readNotice(s, ME, CHAT), { code: 'stop_saving' }, 'the screen still reads a code and nothing else');
  // A send that never started joins the same way, by its key.
  writeNotice(s, ME, CHAT, 'stop_unsure', { key: KEY, sent: 'three' });
  assert.deepEqual(turnsOf(kept(s)), [{ job: JOB, sent: textMark('one') }, { job: JOB_2 }, { key: KEY, sent: textMark('three') }]);
});

test('a warning that was forgotten in one place and kept in another carries its turns with it', () => {
  // The send hook forgets the warning of the chat a message was sent from, then keeps the new one where the ending
  // lands, which can be another chat (New chat's warning, and the chat made for the message). It reads the old one
  // first and hands it in as `after`.
  const s = memory();
  writeNotice(s, ME, 'new', 'stop_unsure', { key: KEY, sent: 'one' });
  const before = readCreditsWarning(s, ME, 'new');
  clearNotice(s, ME, 'new');
  writeNotice(s, ME, 'made', 'connection_lost', { job: JOB, after: before });
  assert.deepEqual(kept(s, 'made'), { code: 'connection_lost', turns: [{ key: KEY, sent: textMark('one') }, { job: JOB }] });
  assert.equal(readNotice(s, ME, 'new'), null);
  // Both at once: one handed in, and one already kept where the new warning lands. All three turns are kept.
  writeNotice(s, ME, 'other', 'stop_saving', { job: JOB_2 });
  writeNotice(s, ME, 'other', 'stop_unsure', { key: KEY_2, sent: 'three', after: kept(s, 'made') });
  assert.deepEqual(turnsOf(kept(s, 'other')), [{ key: KEY, sent: textMark('one') }, { job: JOB }, { job: JOB_2 }, { key: KEY_2, sent: textMark('three') }]);
  // With nothing handed in and nothing kept there, it is one turn, stored as it always was.
  writeNotice(s, ME, 'fresh', 'stop_unsure', { job: JOB, sent: 'one', after: null });
  assert.equal(raw(s, 'fresh'), `{"code":"stop_unsure","job":"${JOB}","sent":"${textMark('one')}"}`);
});

test('a notice that is not a warning about Credits is not a turn: what is written over it stands for one turn', () => {
  for (const code of ['insufficient_balance', 'stop_saved', 'turns_settled', 'connection_saved', 'connection_refunded', 'unknown']) {
    const s = memory();
    writeNotice(s, ME, CHAT, code, { credits: 2 });
    writeNotice(s, ME, CHAT, 'stop_unsure', { job: JOB, sent: 'one' });
    assert.deepEqual(kept(s), { code: 'stop_unsure', job: JOB, sent: textMark('one') }, code);
  }
});

test('a warning that takes the place of one with nothing to ask keeps nothing to ask: it stands for a turn it cannot list', () => {
  const unlisted = [
    (s) => writeNotice(s, ME, CHAT, 'stop_unsure'),                       // kept before sends had keys, or its key was not usable
    (s) => writeNotice(s, ME, CHAT, 'reply_not_saved'),                   // charged and not in the chat: settled, and still a warning
    (s) => s.setItem(`veyrnox_chat_notice_v1:${ME}:${CHAT}`, JSON.stringify({ code: 'stop_unsure', job: 'job-1' })), // changed in storage
  ];
  for (const leave of unlisted) {
    const s = memory(); leave(s);
    writeNotice(s, ME, CHAT, 'stop_unsure', { job: JOB, key: KEY, sent: 'two' });
    assert.deepEqual(kept(s), { code: 'stop_unsure' });
    // And it stays that way: the next one stands for the unlisted turn too.
    writeNotice(s, ME, CHAT, 'connection_lost', { job: JOB_2 });
    assert.deepEqual(kept(s), { code: 'connection_lost' });
  }
  // The same when the earlier warning is handed in.
  for (const after of [{ code: 'stop_unsure' }, { code: 'reply_not_saved' }, {}, { code: 'stop_unsure', turns: [] }, { code: 'stop_unsure', job: 'job-1' }, 'stop_unsure', 1]) {
    const s = memory();
    writeNotice(s, ME, CHAT, 'stop_unsure', { job: JOB, sent: 'two', after });
    assert.deepEqual(kept(s), { code: 'stop_unsure' }, JSON.stringify(after));
  }
  // And the other way round: a warning with nothing usable of its own, written over one that had a turn.
  const s = memory();
  writeNotice(s, ME, CHAT, 'stop_unsure', { job: JOB, sent: 'one' });
  writeNotice(s, ME, CHAT, 'stop_unsure', { job: 'job-1', key: 'key', sent: 'two' });
  assert.deepEqual(kept(s), { code: 'stop_unsure' }, 'one listed turn would be asked about as if it were the only one');
});

test('a warning lists at most four turns: one more and it keeps none, and none from then on', () => {
  assert.equal(MAX_TURNS, 4);
  const s = memory();
  const ids = [JOB, JOB_2, KEY, KEY_2];
  ids.forEach((id, i) => {
    writeNotice(s, ME, CHAT, 'stop_unsure', { ...(id.startsWith('vx-') ? { key: id } : { job: id }), sent: `text ${i}` });
    assert.equal(turnsOf(kept(s)).length, i + 1);
  });
  // A fifth turn cannot be listed. Dropping the oldest would let the listed four settle a warning that still stands
  // for a fifth, so nothing is kept: the warning is never asked about, and stays until a later message is saved.
  writeNotice(s, ME, CHAT, 'stop_unsure', { job: 'aaaaaaaa-0000-4000-8000-000000000005', sent: 'text 5' });
  assert.deepEqual(kept(s), { code: 'stop_unsure' });
  assert.equal(raw(s), '{"code":"stop_unsure"}');
  writeNotice(s, ME, CHAT, 'stop_unsure', { job: 'aaaaaaaa-0000-4000-8000-000000000006', sent: 'text 6' });
  assert.deepEqual(kept(s), { code: 'stop_unsure' });
});

test('the longest record there is fits the limit it is read back under, and one character more is no notice at all', () => {
  assert.equal(MAX_NOTICE, 320);
  const s = memory();
  // Four sends that never started (a key is three characters longer than a job id), each given back with the longest
  // text a draft can hold.
  const long = 'x'.repeat(MAX_DRAFT);
  for (const key of [KEY, KEY_2, 'vx-aaaaaaaa-0000-4000-8000-000000000003', 'vx-aaaaaaaa-0000-4000-8000-000000000004']) writeNotice(s, ME, CHAT, 'stop_unsure', { key, sent: long });
  assert.equal(turnsOf(kept(s)).length, 4);
  assert.ok(raw(s).length <= MAX_NOTICE, `${raw(s).length} characters`);
  // The longest code, which never gives the text back, over three that did.
  clearNotice(s, ME, CHAT);
  for (const key of [KEY, KEY_2, 'vx-aaaaaaaa-0000-4000-8000-000000000003']) writeNotice(s, ME, CHAT, 'stop_unsure', { key, sent: long });
  writeNotice(s, ME, CHAT, 'connection_lost', { key: 'vx-aaaaaaaa-0000-4000-8000-000000000004', sent: long });
  assert.equal(turnsOf(kept(s)).length, 4);
  assert.ok(raw(s).length <= MAX_NOTICE, `${raw(s).length} characters`);
  const at = keyOf(s);
  const fits = (n) => { const base = JSON.stringify({ code: 'stop_unsure', job: JOB, p: '' }); return JSON.stringify({ code: 'stop_unsure', job: JOB, p: 'x'.repeat(n - base.length) }); };
  s.setItem(at, fits(320)); assert.deepEqual(kept(s), { code: 'stop_unsure', job: JOB });
  s.setItem(at, fits(321)); assert.equal(kept(s), null);
  assert.equal(readNotice(s, ME, CHAT), null);
});

test('storage is not trusted: a list of turns is read back whole, each turn in its own shape, or not at all', () => {
  const s = memory();
  writeNotice(s, ME, CHAT, 'stop_unsure');
  const at = keyOf(s);
  const mark = textMark('hello');
  const good = [{ job: JOB, sent: mark }, { key: KEY }];
  s.setItem(at, JSON.stringify({ code: 'stop_unsure', turns: good }));
  assert.deepEqual(kept(s), { code: 'stop_unsure', turns: good });
  // One turn that cannot be asked about, and the warning has nothing to ask: the rest must not settle it without that one.
  const badTurns = [{ job: 'job-1' }, { key: 'key' }, {}, { sent: mark }, { job: JOB.slice(1) }, { key: KEY.toUpperCase() }, { job: `${JOB}/x` }, null, 'x', 42, [JOB], { job: [JOB] }];
  for (const bad of badTurns) {
    for (const turns of [[bad, { job: JOB }], [{ job: JOB }, bad], [{ job: JOB }, bad, { key: KEY }]]) {
      s.setItem(at, JSON.stringify({ code: 'stop_unsure', turns }));
      assert.deepEqual(kept(s), { code: 'stop_unsure' }, JSON.stringify(turns));
    }
  }
  // Not a list, a list of one (one turn is stored without a list), or more turns than a warning can list.
  const five = [JOB, JOB_2, 'aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000005'].map((job) => ({ job }));
  for (const turns of ['x', 42, {}, { 0: { job: JOB }, length: 2 }, [], [{ job: JOB }], five]) {
    s.setItem(at, JSON.stringify({ code: 'stop_unsure', turns }));
    assert.deepEqual(kept(s), { code: 'stop_unsure' }, JSON.stringify(turns));
  }
  // A list beside a turn of its own (not something the screen writes): which turns it stands for cannot be told.
  s.setItem(at, JSON.stringify({ code: 'stop_unsure', job: JOB, turns: good }));
  assert.deepEqual(kept(s), { code: 'stop_unsure' });
  // A turn takes a job or a key, the job first, and nothing else found in it is passed on. A bad mark is dropped; its turn stays.
  s.setItem(at, JSON.stringify({ code: 'stop_unsure', turns: [{ job: JOB, key: KEY, words: '<b>x</b>', sent: '<b>5.abc</b>' }, { key: KEY_2, sent: mark, more: 1 }] }));
  assert.deepEqual(kept(s), { code: 'stop_unsure', turns: [{ job: JOB }, { key: KEY_2, sent: mark }] });
  // A list beside a notice that cannot be asked about is not read back.
  s.setItem(at, JSON.stringify({ code: 'reply_not_saved', turns: good }));
  assert.deepEqual(kept(s), { code: 'reply_not_saved' });
  s.setItem(at, JSON.stringify({ code: 'stop_saved', turns: good }));
  assert.equal(kept(s), null);
  assert.deepEqual(readNotice(s, ME, CHAT), { code: 'stop_saved' });
});
