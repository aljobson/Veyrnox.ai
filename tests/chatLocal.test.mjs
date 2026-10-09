import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addToDraft, readDraft, writeDraft, readStars, toggleStar, readNotice, readCreditsWarning, writeNotice, clearNotice, clearChatLocal, textMark, NEW_CHAT, MAX_DRAFT, MAX_STARS, MAX_NOTICE } from '../app/veyrnox/_lib/chatLocal.js';

const memory = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i], get length() { return m.size; }, size: () => m.size, keys: () => [...m.keys()],
  };
};
const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
const workspace = readFileSync(new URL('../app/veyrnox/_components/chat/ChatWorkspace.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../app/veyrnox/_lib/chatApi.js', import.meta.url), 'utf8');
const gateway = readFileSync(new URL('../app/veyrnox/_lib/gateway.js', import.meta.url), 'utf8');
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

// ---- a warning about Credits: the kept notice that a refused message must not replace ----
// A message that is refused before it starts was not charged, and what it says is about itself. It used to take the
// place of whatever was kept for the chat, a warning that the message before it may still be saved and use Credits
// included. The send hook now asks the store whether such a warning is kept (tests/chatSendFlow.test.mjs).

const CREDITS_WARNINGS = ['stop_unsure', 'stop_saving', 'connection_lost', 'reply_not_saved'];

test('a kept notice is read as a warning about Credits only when it is one of the four', () => {
  const s = memory();
  for (const code of CREDITS_WARNINGS) {
    writeNotice(s, ME, 'thread-1', code);
    assert.deepEqual(readCreditsWarning(s, ME, 'thread-1'), { code }, code);
  }
  // Each of these is about a message that is settled: it used no Credits, or the chat itself shows the reply and its
  // price (`connection_saved`). A later refusal may take its place.
  // `stop_saved` since a kept warning can be settled later: a reply was saved after Stop, and the chat shows it and its price.
  for (const code of ['connection_saved', 'stop_saved', 'connection_refunded', 'stop_refunded', 'insufficient_balance', 'rate_limited', 'turn_not_saved', 'provider_cut_off', 'image_unreadable', 'unknown']) {
    writeNotice(s, ME, 'thread-1', code, { credits: 2 });
    assert.equal(readCreditsWarning(s, ME, 'thread-1'), null, code);
  }
  assert.equal(readCreditsWarning(s, ME, 'thread-2'), null, 'nothing is kept for this chat');
  assert.equal(readCreditsWarning(s, ME, NEW_CHAT), null);
});

test('each of the four says Credits were used or may be, and none says they were not', () => {
  for (const code of CREDITS_WARNINGS) {
    const copy = new RegExp(`case '${code}': return (['"])(.+?)\\1;`).exec(api);
    assert.ok(copy, `chatErrorCopy has words for ${code}`);
    assert.match(copy[2], /Credits/, code);
    assert.doesNotMatch(copy[2], /No Credits|no Credits|not be charged/, code);
  }
});

test('no other words say Credits were used or may be: a new notice that does has to be put on the list', () => {
  // Every `case` of chatErrorCopy, with the codes that share its words. "The Credits it used" (`connection_saved`) is
  // about a reply the chat shows with its price, and "No Credits were used" is the opposite of a warning.
  const body = api.slice(api.indexOf('export function chatErrorCopy'), api.indexOf('export function chatUnchargedCopy'));
  const warns = [];
  for (const line of body.split('\n').filter((l) => /^\s+case '/.test(l))) {
    // One case returns words kept elsewhere (a paused account, in gateway.js): its statement there is read whole.
    const named = /return ([A-Z_]+);$/.exec(line.trim());
    const from = named ? gateway.indexOf(`export const ${named[1]} =`) : -1;
    const words = named ? (from >= 0 && gateway.slice(from, gateway.indexOf(';', from))) : /return (['"`])(.+)\1;$/.exec(line.trim())?.[2];
    assert.ok(words, line.trim().slice(0, 60));
    if (/\b(?:use|used) Credits\b|(?<![Nn]o )Credits were used/.test(words)) warns.push(...[...line.matchAll(/case '([a-z_]+)'/g)].map((m) => m[1]));
  }
  assert.deepEqual(warns.sort(), [...CREDITS_WARNINGS].sort());
});

test('reading a warning does not forget it, and it passes the same checks as any notice read from storage', () => {
  const s = memory();
  writeNotice(s, ME, NEW_CHAT, 'stop_unsure');
  assert.deepEqual(readCreditsWarning(s, ME, NEW_CHAT), { code: 'stop_unsure' });
  assert.deepEqual(readNotice(s, ME, NEW_CHAT), { code: 'stop_unsure' }, 'still kept');
  // Another user's, no user, storage that throws, and something in storage that is not a notice: nothing.
  assert.equal(readCreditsWarning(s, 'user-b', NEW_CHAT), null);
  assert.equal(readCreditsWarning(s, null, NEW_CHAT), null);
  assert.equal(readCreditsWarning(blocked, ME, NEW_CHAT), null);
  s.setItem(rawNotice(s, NEW_CHAT), 'Stopped before any text arrived.');
  assert.equal(readCreditsWarning(s, ME, NEW_CHAT), null);
});

test('what a message that used no Credits ended with, said together with a kept warning: the ending first, then the warning, marked as the earlier one', () => {
  // Words are made in one place (chatErrorCopy). The two are joined with words of their own so that "Your message was
  // not sent" or "No Credits were used" is never read as "so nothing can be charged": the warning is about the message
  // before it. It was chatRefusedCopy while only a refusal was said this way; the words and the join are unchanged.
  assert.match(api, /\nexport function chatUnchargedCopy\(code, extra, warning\) \{\n {2}return `\$\{chatErrorCopy\(code, extra\)\} Before that: \$\{chatErrorCopy\(warning\.code, warning\)\}`;\n\}\n/);
  assert.doesNotMatch(api, /chatRefusedCopy/);
});

// ---- the turn a warning is about: kept with it, so the server can be asked later ----
// A kept warning was forgotten only by a later message from its chat, a deleted chat or the end of the session:
// nothing kept with it let the screen ask the server whether the turn it warns about had settled. So after Stop before
// any text, a turn that was refunded a few seconds later left "it will show in this chat and use Credits" beside the
// given-back text for good. The job id that came with `start` is now kept with the warning (chatWarning.js asks it).

const JOB = '6f1d2c3a-0b4e-4c5d-8e9f-a1b2c3d4e5f6';
const ASKABLE = ['stop_unsure', 'stop_saving', 'connection_lost'];

test('a warning whose turn had started keeps the job id, and the words-facing read never carries it', () => {
  const s = memory();
  for (const code of ASKABLE) {
    writeNotice(s, ME, 'thread-1', code, { job: JOB });
    assert.deepEqual(readCreditsWarning(s, ME, 'thread-1'), { code, job: JOB }, code);
    // readNotice is what the screen puts into words: a code, and the number its words may need. Nothing else.
    assert.deepEqual(readNotice(s, ME, 'thread-1'), { code }, code);
  }
  assert.equal(s.getItem(rawNotice(s, 'thread-1')), `{"code":"connection_lost","job":"${JOB}"}`);
  // Stop before `start` has no job: the warning is kept as it always was.
  for (const none of [undefined, null, '']) {
    writeNotice(s, ME, 'thread-1', 'stop_unsure', { job: none, sent: 'hello' });
    assert.deepEqual(readCreditsWarning(s, ME, 'thread-1'), { code: 'stop_unsure' });
    assert.equal(s.getItem(rawNotice(s, 'thread-1')), '{"code":"stop_unsure"}');
  }
});

test('a job id is kept only beside a warning its job can settle', () => {
  const s = memory();
  // `reply_not_saved` is settled already (charged, and not in the chat): there is nothing to ask. The rest are not
  // warnings, and the send hook hands the job to every notice it keeps.
  for (const code of ['reply_not_saved', 'connection_saved', 'connection_refunded', 'stop_saved', 'insufficient_balance', 'provider_cut_off', 'unknown']) {
    writeNotice(s, ME, 'thread-1', code, { job: JOB, sent: 'hello', credits: 2 });
    assert.doesNotMatch(s.getItem(rawNotice(s, 'thread-1')), /job|sent/, code);
  }
  writeNotice(s, ME, 'thread-1', 'reply_not_saved', { job: JOB });
  assert.deepEqual(readCreditsWarning(s, ME, 'thread-1'), { code: 'reply_not_saved' });
});

test('the one warning that gives the message back keeps a mark of its text beside the job, never the text', () => {
  const s = memory();
  const text = 'Describe a lighthouse.';
  writeNotice(s, ME, 'thread-1', 'stop_unsure', { job: JOB, sent: text });
  assert.deepEqual(readCreditsWarning(s, ME, 'thread-1'), { code: 'stop_unsure', job: JOB, sent: textMark(text) });
  assert.doesNotMatch(s.getItem(rawNotice(s, 'thread-1')), /lighthouse/);
  assert.deepEqual(readNotice(s, ME, 'thread-1'), { code: 'stop_unsure' });
  // Only beside `stop_unsure`: the other two leave the box as the person has it, so nothing is compared with it later.
  for (const code of ['stop_saving', 'connection_lost']) {
    writeNotice(s, ME, 'thread-1', code, { job: JOB, sent: text });
    assert.deepEqual(readCreditsWarning(s, ME, 'thread-1'), { code, job: JOB }, code);
  }
  // The mark: the length and a 32-bit hash, in a fixed shape. The same text gives the same mark; a changed one does not.
  assert.match(textMark(text), /^[0-9a-z]{1,4}\.[0-9a-z]{1,7}$/);
  assert.equal(textMark(text), textMark('Describe a lighthouse.'));
  for (const other of ['Describe a lighthouse', 'describe a lighthouse.', 'Describe a lighthouse. ', `${text}\n\ntyped since`, '']) assert.notEqual(textMark(other), textMark(text), JSON.stringify(other));
  assert.match(textMark('x'.repeat(MAX_DRAFT)), /^[0-9a-z]{1,4}\.[0-9a-z]{1,7}$/, 'the longest draft still fits the shape');
  // The longest record there is still fits the limit it is read back under.
  writeNotice(s, ME, 'thread-1', 'stop_unsure', { job: JOB, sent: 'x'.repeat(MAX_DRAFT) });
  assert.ok(s.getItem(rawNotice(s, 'thread-1')).length <= MAX_NOTICE);
  assert.deepEqual(readCreditsWarning(s, ME, 'thread-1'), { code: 'stop_unsure', job: JOB, sent: textMark('x'.repeat(MAX_DRAFT)) });
});

test('storage is not trusted: a job or a mark is read back only in its own shape, and a bad one leaves the warning kept without it', () => {
  const s = memory();
  writeNotice(s, ME, 'thread-1', 'stop_unsure');
  const key = rawNotice(s, 'thread-1');
  const mark = textMark('hello');
  // The job goes into a request path. Only a job id as the server makes them is ever read back.
  const badJobs = ['job-1', '../../admin', `${JOB}/asset`, `${JOB}?x=1`, JOB.slice(0, 35), `${JOB}0`, JOB.replace('-', '_'), '', ' ', 42, null, true, [JOB], { id: JOB }];
  for (const bad of badJobs) {
    s.setItem(key, JSON.stringify({ code: 'stop_unsure', job: bad, sent: mark }));
    assert.deepEqual(readCreditsWarning(s, ME, 'thread-1'), { code: 'stop_unsure' }, `${JSON.stringify(bad)}: still a warning, with nothing to ask, and no mark without a job`);
  }
  for (const bad of ['hello', '5', '5.', '.abc', 'ZZ.zz', '12345.abc', '5.12345678', '<b>5.abc</b>', 5.5, null, [mark]]) {
    s.setItem(key, JSON.stringify({ code: 'stop_unsure', job: JOB, sent: bad }));
    assert.deepEqual(readCreditsWarning(s, ME, 'thread-1'), { code: 'stop_unsure', job: JOB }, JSON.stringify(bad));
  }
  // A job found beside a notice its job cannot settle is not read back, whatever put it there.
  for (const code of ['reply_not_saved', 'connection_saved', 'insufficient_balance']) {
    s.setItem(key, JSON.stringify({ code, job: JOB, sent: mark }));
    assert.deepEqual(readNotice(s, ME, 'thread-1'), { code }, code);
    assert.deepEqual(readCreditsWarning(s, ME, 'thread-1'), code === 'reply_not_saved' ? { code } : null, code);
  }
  // A mark beside a warning that does not give the text back is not read back either.
  s.setItem(key, JSON.stringify({ code: 'connection_lost', job: JOB, sent: mark }));
  assert.deepEqual(readCreditsWarning(s, ME, 'thread-1'), { code: 'connection_lost', job: JOB });
  // Extra fields are dropped as before, and too much of anything is no notice at all.
  s.setItem(key, JSON.stringify({ code: 'stop_unsure', job: JOB, sent: mark, words: '<b>x</b>' }));
  assert.deepEqual(readCreditsWarning(s, ME, 'thread-1'), { code: 'stop_unsure', job: JOB, sent: mark });
  s.setItem(key, JSON.stringify({ code: 'stop_unsure', job: JOB, pad: 'x'.repeat(MAX_NOTICE) }));
  assert.equal(readCreditsWarning(s, ME, 'thread-1'), null);
  // Nothing bad is written either: the write checks the same shapes.
  for (const bad of badJobs) {
    writeNotice(s, ME, 'thread-1', 'connection_lost', { job: bad });
    assert.equal(s.getItem(key), '{"code":"connection_lost"}', JSON.stringify(bad));
  }
});

test('the workspace restores a draft on open and clears it only after a send', () => {
  assert.match(workspace, /readDraft\(/);
  assert.match(workspace, /writeDraft\(/);
  assert.match(workspace, /toggleStar\(/);
});

test('the workspace names the stored user on every read and write', () => {
  // Seven since addDraft: text given back to a chat that is not on screen is added to that chat's stored draft.
  // Ten since a chat's notice is stored: it is kept, read and forgotten for the same user as the draft beside it.
  // Eleven since the send hook asks whether a warning about Credits is kept before a refusal is told.
  // Twelve since a kept warning is settled when its chat is opened (settleKeptWarning, chatWarning.js): it reads and
  // changes the same user's notice and draft, so it is counted here with the store's own functions.
  const users = [...workspace.matchAll(/\b(?:readDraft|writeDraft|addToDraft|readStars|toggleStar|readNotice|readCreditsWarning|writeNotice|clearNotice|settleKeptWarning)\(store\(\), ([^,]+),/g)].map((m) => m[1]);
  assert.deepEqual(users, Array(12).fill('getStoredUserId()'));
});

test('the workspace turns a stored notice into words itself, each time it is shown', () => {
  // The words come from chatErrorCopy, from the code: what is in storage is never put on screen as it is. The record
  // is passed as the second argument for the number a notice may need (`credits`).
  assert.match(workspace, /\nconst waiting = \(chatId\) => \{ const n = readNotice\(store\(\), getStoredUserId\(\), chatId\); return n \? chatErrorCopy\(n\.code, n\) : null; \};\n/);
  assert.match(workspace, /\nconst keepNotice = \(chatId, code, extra\) => writeNotice\(store\(\), getStoredUserId\(\), chatId, code, extra\);\n/);
  assert.match(workspace, /\nconst dropNotice = \(chatId\) => clearNotice\(store\(\), getStoredUserId\(\), chatId\);\n/);
  // The send hook is told whether a warning about Credits is kept for a chat. It gets the record, never words.
  assert.match(workspace, /\nconst heldWarning = \(chatId\) => readCreditsWarning\(store\(\), getStoredUserId\(\), chatId\);\n/);
});
