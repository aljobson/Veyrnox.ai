// Two endings of a chat send that PR 785 named as left (ADR-0067 amendment 14).
//   A replay. The server answers `replay: true` when it already holds a job for the send's key, and names the job. The
//     screen sends each key once, so that job was never made by a request it saw answered: the browser sends a POST again
//     by itself when its connection dies with no answer, and the first copy can have reached the server (debited, its
//     reader gone: usually refunded, sometimes saved and charged). Or the job was made and never run (lib/freeJob.js).
//     send() read the chat again, said nothing, forgot a warning kept for the message before, and gave no text back.
//   A reply stream that ends cleanly after `start` with no `done`. sendTurn resolved as if the reply had run to its end,
//     and send() cleared the images, read the chat again and said nothing, though the turn may not be saved.
// Both now end as a request that got no answer and whose job the server named (tests/chatSendUnanswered.test.mjs): the
// turn is looked for by that job, a settled turn ends through the branch for a stream that broke after `start`, and one
// that is not settled gives the message back with the warning. No new words.
// send() and sendTurn run for real and together here (`real()`), with the screen and the network faked: the server's
// answer is a faked fetch, and what the look for a turn finds is the harness's `settle`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NEW_CHAT, readCreditsWarning, textMark, writeDraft } from '../app/veyrnox/_lib/chatLocal.js';
import { A, ME, TEXT, afterReload, memory, noAnswer, run, toB } from './chatSendFlow.harness.mjs';
import { JOB, KEY, OTHER_KEY, SENDS, answers, cutAfterStart, leftBy, opened, stopBeforeStart } from './chatWarning.harness.mjs';
import { DONE, START, frame, isUnanswered, json, real, sent, stream } from './chatSendTurn.harness.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const apiSource = read('../app/veyrnox/_lib/chatApi.js');
const sender = read('../app/veyrnox/_components/chat/useChatSend.js');
const MARK = textMark(TEXT);
const kept = (storage, chat = 'chat-a') => readCreditsWarning(storage, ME, chat);
const DELTA = frame('delta', { text: 'A lamp' });
/** The server answers the message's request as a replay, as lib/chatTurn.js does. `meanwhile`: what the person does before it comes. */
const replayed = (meanwhile) => real(() => json(200, { replay: true, job_id: JOB, balance_after: 8 }), meanwhile);
/** A replay that names no job, or names something that is not one. The server sends neither. */
const replayedWith = (body) => real(() => json(200, body));
/** The server's reply stream ends cleanly after `start`, with or without some text, and with no `done`. */
const endedEarly = (text = true) => real(() => stream(text ? [START, DELTA] : [START]));
const later = (outcome) => async () => { await new Promise((resolve) => { setTimeout(resolve, 15); }); return outcome; }; // a look that takes time, as the real one does
const said = (uncharged, warning) => `${uncharged}, and before that ${warning}`; // chatUnchargedCopy, as the harness fakes it

// ---- 1. sendTurn: the job of a replay, and a stream with no `done` ----

test('a replay carries the job the server names, and nothing else is taken for a job', async () => {
    const named = await sent(async () => json(200, { replay: true, job_id: JOB, balance_after: 8 }));
    assert.deepEqual([named.r, named.events], [{ replay: true, job: JOB }, []]);
    // The turn always names one (lib/chatTurn.js). Anything that is not a job id as the server makes them is no job.
    assert.match(read('../lib/chatTurn.js'), /if \(debit\.idempotent\) return json\(\{ replay: true, job_id: jobId, balance_after: debit\.balance_after \}\);/);
    for (const [name, body] of [['none named', { replay: true }], ['not an id', { replay: true, job_id: 'job-1' }], ['not text', { replay: true, job_id: 7 }], ['an id and more', { replay: true, job_id: `${JOB}/x` }],
        ['a list holding an id', { replay: true, job_id: [JOB] }]]) {
        const { r } = await sent(async () => json(200, body));
        assert.deepEqual(r, { replay: true, job: null }, name);
    }
    // Only an answer that is OK is a replay. Under any other status `replay` is not ours to act on: no answer, or a refusal.
    const failed = await sent(async () => json(500, { replay: true, job_id: JOB }));
    assert.ok(isUnanswered(failed.e, 500), `it was ${JSON.stringify(failed.r)}`);
    const refused = await sent(async () => json(409, { replay: true, job_id: JOB }));
    assert.deepEqual([refused.r, refused.e.code, refused.e.status], [undefined, 'gateway_error', 409]);
});

test('a reply stream that ends with no `done` is not a reply that ran to its end: nothing of ours says how it ended', async () => {
    const cut = [['after `start`', [START], ['start']], ['after some text', [START, DELTA], ['start', 'delta']],
        ['after an error the server named', [START, DELTA, frame('error', { error: 'provider_cut_off' })], ['start', 'delta', 'error']],
        ['a `done` that does not parse', [START, DELTA, 'event: done\ndata: {"status"\n\n'], ['start', 'delta']],
        ['a `done` cut short before its end', [START, DELTA, 'event: done\ndata: {"status":"complete"}'], ['start', 'delta']]];
    for (const [name, frames, events] of cut) {
        const got = await sent(async () => stream(frames));
        assert.ok(isUnanswered(got.e), `${name}: it was ${JSON.stringify(got.r)}`);
        assert.deepEqual(got.events, events, `${name}: what had come is still handed on, so send() has the job from \`start\``);
        assert.equal(got.notified.balance, 0, `${name}: the balance is asked for again by the look, once the turn has been looked for`);
    }
    // With `done`, whatever it says, the reply's ending is known and send() acts on it as before.
    for (const done of [DONE, frame('done', { status: 'failed', credits_charged: 0 }), frame('done', { status: 'canceled', credits_charged: 0 })]) {
        const whole = await sent(async () => stream([START, DELTA, done]));
        assert.deepEqual([whole.r, whole.e, whole.events, whole.notified.balance], [{ replay: false }, undefined, ['start', 'delta', 'done'], 1]);
    }
    // The server writes `done` last on every path that closes the stream itself, so a clean end without one was cut.
    const turn = read('../lib/chatTurn.js');
    assert.equal([...turn.matchAll(/send\('done', [^\n]*\n\s*try \{ controller\.close\(\); \}/g)].length, 2);
    assert.equal(turn.split('controller.close()').length - 1, 2, 'no close without a `done` before it');
});

// ---- 2. send(): a replay is looked for by the job the server named ----

test('a replay whose first copy was refunded: the message is back in the box, and the words say no Credits were used', async () => {
    const storage = memory();
    const { log, bubbles } = await run({ active: A, turn: replayed(), key: KEY, settle: 'nothing', storage, images: [{ asset: 'x' }] });
    assert.deepEqual([log.looks, log.closes], [[JOB], []], 'looked for by the job the replay named, and no send is closed');
    assert.deepEqual(log.lookedIn, [{ chat: 'chat-a', text: TEXT, known: [] }], 'in the chat the message was sent in, for the text that was sent');
    assert.deepEqual([log.box, log.notices], [['', TEXT], [null, 'connection_refunded']]);
    assert.deepEqual([afterReload(storage, 'chat-a'), kept(storage)], [{ box: TEXT, notice: { code: 'connection_refunded' } }, null], 'said after a reload too, and not as a warning: nothing can be charged');
    assert.deepEqual([log.opened, log.deleted, log.imagesCleared, bubbles()], [[], [], 0, []], 'the images stay with the message that went back');
    // From a chat made for the message: the job failed with nothing stored, so nothing can be saved to that chat. It goes.
    const made = await run({ active: null, turn: replayed(), key: KEY, settle: 'nothing' });
    assert.deepEqual([made.log.deleted, made.log.saved, made.kept()], [['made'], { [NEW_CHAT]: TEXT }, { [NEW_CHAT]: 'connection_refunded' }]);
});

test('a replay whose first copy was saved: the chat is read again and shows the reply and its price, and the screen says so', async () => {
    const saved = await run({ active: A, turn: replayed(), key: KEY, settle: 'saved', images: [{ asset: 'x' }] });
    assert.deepEqual([saved.log.looks, saved.log.opened, saved.log.box, saved.log.notices], [[JOB], ['chat-a'], [''], [null, 'connection_saved']], 'it said nothing before');
    assert.deepEqual([saved.kept(), saved.log.imagesCleared], [{ 'chat-a': 'connection_saved' }, 1], 'the message is not offered again, nor its images');
    // Charged, and its messages could not be stored.
    const unsaved = await run({ active: A, turn: replayed(), key: KEY, settle: 'unsaved' });
    assert.deepEqual([unsaved.log.box, unsaved.kept()], [[''], { 'chat-a': 'reply_not_saved' }]);
    // Saved, but the chat cannot be read again (still offline): the screen cannot show it, so the warning is kept, by that job.
    const storage = memory();
    const unread = await run({ active: A, turn: replayed(), key: KEY, settle: 'saved', storage, openDown: true });
    assert.deepEqual([unread.log.notices, unread.log.box, kept(storage)], [[null, 'connection_lost'], [''], { code: 'connection_lost', job: JOB }]);
});

test('a replay whose job is not settled when the look ends: the message goes back with the warning, never without it', async () => {
    // The first copy is still running with no reader, or its job was made and never run (lib/freeJob.js: it stays queued
    // until the sweep ends it). It may still end saved and charged. Nothing of the reply was ever on screen.
    const storage = memory();
    const { log, bubbles } = await run({ active: null, turn: replayed(), key: KEY, settle: 'pending', storage, images: [{ asset: 'x' }] });
    assert.deepEqual([log.looks, log.closes], [[JOB], []]);
    assert.deepEqual([log.box, log.notices, log.deleted, log.opened, log.imagesCleared, bubbles()], [['', TEXT], [null, 'connection_lost'], [], [], 0, []], 'a chat made for the message stays: a reply may still be saved to it');
    // The money rule: the text and the warning together, on screen and after a page reload.
    assert.deepEqual(afterReload(storage, 'made'), { box: TEXT, notice: { code: 'connection_lost' } });
    // Kept by the send's key with the mark of the text given back, as a request that got no answer is. The key finds the same job.
    assert.deepEqual(kept(storage, 'made'), { code: 'connection_lost', key: KEY, sent: MARK });
});

test('that warning is settled when its chat is next opened: saved late empties the box and says so, refunded leaves the text', async () => {
    const left = () => leftBy(replayed(), { key: KEY });
    assert.deepEqual(await opened(await left(), 'chat-a', answers(SENDS.saved)), { box: '', notice: { code: 'connection_saved' }, changed: true, calls: [KEY] });
    assert.deepEqual(await opened(await left(), 'chat-a', answers(SENDS.refunded)), { box: TEXT, notice: null, changed: true, calls: [KEY] });
    assert.deepEqual(await opened(await left(), 'chat-a', answers(SENDS.unsaved)), { box: TEXT, notice: { code: 'reply_not_saved' }, changed: true, calls: [KEY] });
    // A job that was made and never run reads `queued` until the sweep ends it: the warning stays, and is asked about again.
    for (const answer of [SENDS.queued, SENDS.running, SENDS.failed]) {
        const storage = await left();
        const after = await opened(storage, 'chat-a', answers(answer));
        assert.deepEqual([after.changed, after.box, after.notice, kept(storage)], [false, TEXT, { code: 'connection_lost' }, { code: 'connection_lost', key: KEY, sent: MARK }], answer.state);
    }
});

test('a replay that names no job, or a look that goes wrong: the warning, never "it already ran" and never "it never started"', async () => {
    // The server always names the job. If an answer ever came without one, the send is still known to have a job.
    for (const turn of [replayedWith({ replay: true }), replayedWith({ replay: true, job_id: 'job-1' }), replayedWith({ replay: true, job_id: [JOB] })]) {
        const storage = memory();
        const { log } = await run({ active: null, turn, key: KEY, storage });
        assert.deepEqual([log.looks, log.closes, log.opened, log.deleted], [[], [], [], []], 'nothing to look for, and nothing is closed or read as sent');
        assert.deepEqual([log.box, log.notices, kept(storage, 'made')], [['', TEXT], [null, 'connection_lost'], { code: 'connection_lost', key: KEY, sent: MARK }]);
    }
    // The look for the job throws (a chat read in a shape it does not know): the job exists, so the chat and the warning stay.
    const storage = memory();
    const thrown = await run({ active: null, turn: replayed(), key: KEY, storage, settle: () => { throw new TypeError("Cannot read properties of null (reading 'role')"); } });
    assert.deepEqual([thrown.log.looks, thrown.log.deleted, thrown.log.box, thrown.log.notices], [[JOB], [], ['', TEXT], [null, 'connection_lost']]);
    assert.deepEqual([afterReload(storage, 'made'), kept(storage, 'made')], [{ box: TEXT, notice: { code: 'connection_lost' } }, { code: 'connection_lost', key: KEY, sent: MARK }]);
});

test('while a replay is looked for the button says Checking and the reply bubble says the connection was lost', async () => {
    let seen = null;
    const { log } = await run({ active: A, turn: replayed(), key: KEY, settle: (person, soFar) => { seen = { checking: [...soFar.checking], bubbles: person.bubbles() }; return 'pending'; } });
    assert.deepEqual(seen, { checking: [true], bubbles: ['user:complete', 'assistant:lost'] });
    assert.deepEqual(log.checking, [true, false], 'and it ends when the send does');
});

test('the person is somewhere else, or has left the chat page, when a replay is not settled: the text and the warning wait in its chat', async () => {
    const away = await run({ active: A, turn: replayed(toB), images: [{ asset: 'x' }] });
    assert.deepEqual([away.log.added, away.log.saved, away.log.box, away.log.notices], [{ 'chat-a': TEXT }, {}, [''], [null]], 'nothing changes on the chat that is on screen');
    assert.deepEqual([away.kept(), away.log.imagesCleared], [{ 'chat-a': 'connection_lost' }, 1], 'the images cannot wait with it');
    const storage = memory();
    const gone = await run({ active: A, turn: replayed((p) => p.leavesThePage()), key: KEY, storage });
    assert.deepEqual([gone.log.box, gone.log.notices], [[''], [null]], 'nothing on a screen that is gone');
    assert.deepEqual([afterReload(storage, 'chat-a'), kept(storage)], [{ box: TEXT, notice: { code: 'connection_lost' } }, { code: 'connection_lost', key: KEY, sent: MARK }]);
});

// ---- 3. a replay, with a warning already kept for the message before ----

test('a replay no longer forgets a warning kept for the message before: only an ending that accounts for Credits does', async () => {
    const before = () => leftBy(stopBeforeStart, { key: KEY }); // Stop before `start`, not settled: `stop_unsure`, by its key
    assert.deepEqual(kept(await before()), { code: 'stop_unsure', key: KEY, sent: MARK });
    // Not settled, or no job named: this message's own warning takes the earlier one's place and stands for both sends.
    for (const [turn, settle] of [[replayed(), 'pending'], [replayedWith({ replay: true }), 'pending']]) {
        const storage = await before();
        const { log } = await run({ active: A, turn, key: OTHER_KEY, settle, storage });
        assert.deepEqual([log.notices, log.opened], [[null, 'connection_lost'], []], 'it read the chat again and said nothing');
        assert.deepEqual(kept(storage), { code: 'connection_lost', turns: [{ key: KEY, sent: MARK }, { key: OTHER_KEY, sent: MARK }] });
        // It goes only when both are settled.
        assert.equal((await opened(storage, 'chat-a', async (key) => (key === KEY ? SENDS.closed : SENDS.running))).changed, false);
        assert.deepEqual(await opened(storage, 'chat-a', answers(SENDS.closed)), { box: TEXT, notice: null, changed: true, calls: [KEY, OTHER_KEY] });
    }
    // Refunded: this message used no Credits, which says nothing of the one before. Both are said, and the warning stays kept.
    const refunded = await before();
    const none = await run({ active: A, turn: replayed(), key: OTHER_KEY, settle: 'nothing', storage: refunded });
    assert.deepEqual(none.log.notices, [null, said('connection_refunded', 'stop_unsure')]);
    assert.deepEqual([afterReload(refunded, 'chat-a'), kept(refunded)], [{ box: TEXT, notice: { code: 'stop_unsure' } }, { code: 'stop_unsure', key: KEY, sent: MARK }]);
    // Saved: the chat is read again for this message and shows every reply that was saved with its price. That accounts
    // for Credits, as a reply that ran to its end does, and the earlier warning goes.
    const saved = await before();
    const found = await run({ active: A, turn: replayed(), key: OTHER_KEY, settle: 'saved', storage: saved });
    assert.deepEqual([found.log.opened, found.log.shownOnOpen, found.log.notices], [['chat-a'], [null], [null, 'connection_saved']]);
    assert.deepEqual([afterReload(saved, 'chat-a'), kept(saved)], [{ box: '', notice: { code: 'connection_saved' } }, null]);
});

test('a replay from another chat, with a warning kept before: the warning it keeps there stands for both, and nothing is said elsewhere', async () => {
    const storage = await leftBy(stopBeforeStart, { key: KEY });
    writeDraft(storage, ME, 'chat-a', ''); // the given-back text was sent again
    const { log } = await run({ active: A, turn: replayed(toB), key: OTHER_KEY, settle: 'pending', storage });
    assert.deepEqual([log.notices, log.opened], [[null], []]);
    assert.deepEqual([afterReload(storage, 'chat-a').box, kept(storage)], [TEXT, { code: 'connection_lost', turns: [{ key: KEY, sent: MARK }, { key: OTHER_KEY, sent: MARK }] }]);
});

// ---- 4. send(): a stream that ended with no `done`, after `start` ----

test('a stream that ended with no `done` is looked for by the job from `start`, and ends as a stream that broke does', async () => {
    const cut = (settle, more = {}) => run({ active: A, turn: endedEarly(), key: KEY, settle, images: [{ asset: 'x' }], ...more });
    // Refunded with nothing kept: the message goes back, images with it. It was read again as sent, and the message was nowhere.
    const nothing = await cut('nothing');
    assert.deepEqual([nothing.log.looks, nothing.log.closes], [[JOB], []], 'its job came with `start`: no send is asked about by its key');
    assert.deepEqual(nothing.log.lookedIn, [{ chat: 'chat-a', text: TEXT, known: [] }]);
    assert.deepEqual([nothing.log.box, nothing.log.notices, nothing.kept(), nothing.log.imagesCleared, nothing.bubbles()], [['', TEXT], [null, 'connection_refunded'], { 'chat-a': 'connection_refunded' }, 0, []]);
    const made = await cut('nothing', { active: null });
    assert.deepEqual([made.log.deleted, made.log.saved, made.kept()], [['made'], { [NEW_CHAT]: TEXT }, { [NEW_CHAT]: 'connection_refunded' }]);
    // Saved: the chat shows the reply and its price, and the screen says the reply was cut. It said nothing before.
    const saved = await cut('saved');
    assert.deepEqual([saved.log.opened, saved.log.box, saved.log.notices, saved.kept(), saved.log.imagesCleared], [['chat-a'], [''], [null, 'connection_saved'], { 'chat-a': 'connection_saved' }, 1]);
    const unsaved = await cut('unsaved');
    assert.deepEqual([unsaved.log.box, unsaved.kept()], [[''], { 'chat-a': 'reply_not_saved' }]);
});

test('not settled when the look ends: what arrived stays on screen, and the warning is kept by the job', async () => {
    // It was read again as sent: with the turn not saved yet the chat came back without it, and nothing warned of Credits.
    const storage = memory();
    const withText = await run({ active: null, turn: endedEarly(), key: KEY, settle: 'pending', storage, images: [{ asset: 'x' }] });
    assert.deepEqual([withText.log.looks, withText.log.box, withText.log.notices, withText.log.opened, withText.log.deleted], [[JOB], [''], [null, 'connection_lost'], [], []]);
    assert.deepEqual([withText.bubbles(), withText.log.imagesCleared], [['user:complete', 'assistant:lost'], 1], 'the reply so far stays, marked; the message is not offered again');
    assert.deepEqual([afterReload(storage, 'made'), kept(storage, 'made')], [{ box: '', notice: { code: 'connection_lost' } }, { code: 'connection_lost', job: JOB }]);
    // Before any text: the empty reply bubble goes, the question stays, the same warning.
    const none = await run({ active: A, turn: endedEarly(false), key: KEY, settle: 'pending' });
    assert.deepEqual([none.bubbles(), none.log.box, none.kept()], [['user:complete'], [''], { 'chat-a': 'connection_lost' }]);
    // And with a warning kept for the message before, this one takes its place and stands for both turns.
    const both = await leftBy(stopBeforeStart, { key: KEY });
    await run({ active: A, turn: endedEarly(), key: OTHER_KEY, settle: 'pending', storage: both });
    assert.deepEqual(kept(both), { code: 'connection_lost', turns: [{ key: KEY, sent: MARK }, { job: JOB }] });
});

test('a look that goes wrong after `start` is not an answer: the send ends with the warning, and does not end with nothing said', async () => {
    // The look for the job throws (a chat read in a shape it does not know). send() rejected there, with the reply bubble
    // left saying it was checking, no notice, and nothing stored. A replay was already guarded (above); a turn that
    // started now is too, in the branch both endings share with a stream that broke.
    const wrong = () => { throw new TypeError("Cannot read properties of null (reading 'role')"); };
    for (const [name, turn] of [['a stream with no `done`', endedEarly()], ['a stream that broke after `start`', cutAfterStart]]) {
        const storage = memory();
        const { log } = await run({ active: null, turn, key: KEY, storage, settle: wrong, images: [{ asset: 'x' }] });
        assert.deepEqual([log.notices, log.box, log.deleted, log.opened], [[null, 'connection_lost'], [''], [], []], name);
        assert.deepEqual([afterReload(storage, 'made'), kept(storage, 'made')], [{ box: '', notice: { code: 'connection_lost' } }, { code: 'connection_lost', job: JOB }], name);
    }
});

test('the look is waited for, wherever it is made for a job the server named', async () => {
    // A look takes time (it reads the job and the chat over about three seconds). The ending must act on what it found.
    const replay = await run({ active: A, turn: replayed(), key: KEY, settle: later('nothing') });
    assert.deepEqual([replay.log.notices, replay.log.box], [[null, 'connection_refunded'], ['', TEXT]]);
    const noAnswerAtAll = await run({ active: A, turn: noAnswer(), key: KEY, closeSend: answers(SENDS.running), settle: later('nothing') });
    assert.deepEqual([noAnswerAtAll.log.notices, noAnswerAtAll.log.box, noAnswerAtAll.log.lookedIn], [[null, 'connection_refunded'], ['', TEXT], [{ chat: 'chat-a', text: TEXT, known: [] }]]);
    const cut = await run({ active: A, turn: endedEarly(), key: KEY, settle: later('saved') });
    assert.deepEqual([cut.log.notices, cut.log.opened], [[null, 'connection_saved'], ['chat-a']]);
});

test('each look is handed the messages that were on screen before the send, so an older turn with the same words is not taken for this one', async () => {
    // The look finds the saved turn by its text among the messages the screen did not have (chatStop.js: findSavedTurn).
    const before = { shown: ['m0', 'm1'] };
    const handed = [{ chat: 'chat-a', text: TEXT, known: ['m0', 'm1'] }];
    for (const [name, how] of [['a replay', { turn: replayed() }], ['a stream with no `done`', { turn: endedEarly() }], ['a request with no answer, its job named', { turn: noAnswer(), closeSend: answers(SENDS.running) }]]) {
        const { log } = await run({ active: A, key: KEY, settle: 'pending', ...before, ...how });
        assert.deepEqual(log.lookedIn, handed, name);
    }
});

// ---- 5. the shape of both, and no new words ----

test('a replay is looked for in one place, with the look a request that got no answer uses, and ends through the same two branches', () => {
    const block = /\n {6}if \(r\.replay\) \{\n((?: {8}[^\n]*\n)+?) {6}\}\n/.exec(sender);
    assert.ok(block, 'its own block, straight after the request');
    const lines = block[1].split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')).map((l) => l.replace(/ +\/\/.*$/, ''));
    assert.deepEqual(lines, ['        unsure = true;', "        setChecking(true); setMessages((m) => m.map((x) => (x.id === pending ? { ...x, status: 'lost' } : x)));", '        if (r.job) await lookFor(r.job);',
        "        throw new GatewayError('send_replayed', { status: 200, code: 'send_replayed' });"]);
    // `unsure` first: from there on nothing can end this send as one that never started (chat deleted, ordinary notice).
    assert.equal(sender.split('await lookFor(').length - 1, 2, 'a request that got no answer, and a replay');
    assert.equal(sender.split('chatApi.settleStop(').length - 1, 3, 'Stop, a stream that broke, and the look for a job the server named');
    // No ask by the key here: the answer named the job. (Two asks in the hook, pinned in tests/chatSendUnanswered.test.mjs.)
    assert.doesNotMatch(block[1], /askStoppedSend|closeSend|reload\(|giveBack|tell\(/);
    // The thrown error is never told: `unsure` is set, so the ending is one of the two branches before "never started".
    assert.ok(sender.indexOf('} else if (started) {') < sender.indexOf('} else if (unsure) {') && sender.indexOf('} else if (unsure) {') < sender.indexOf('failed(e);'));
    assert.doesNotMatch(apiSource, /send_replayed/, 'and it has no words of its own');
});

test('sendTurn resolves only for a replay or a `done`, and the words are the ones a dropped connection already had', () => {
    assert.match(apiSource, /\n {4}if \(res\.ok && body\?\.replay\) return \{ replay: true, job: jobIdOf\(body\.job_id\) \};/);
    assert.match(apiSource, /try \{ const d = JSON\.parse\(data\); onEvent\(event, d\); if \(event === 'done'\) ended = true; \} catch \{/);
    assert.match(apiSource, /\n {2}if \(!ended\) throw unanswered\(\);[^\n]*\n {2}notifyBalanceChanged\(\);\n {2}return \{ replay: false \};\n\}/);
    assert.equal(apiSource.split('return { replay: ').length - 1, 2);
    // Nothing added to what the screen can say (tests/chatBrokenStream.test.mjs pins what these three promise).
    const codes = [...apiSource.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]);
    assert.equal(codes.length, 45, 'no new words');
    for (const code of ['connection_lost', 'connection_saved', 'connection_refunded', 'reply_not_saved']) assert.ok(codes.includes(code), code);
});
