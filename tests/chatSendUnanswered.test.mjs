// A message whose own request went out and got no answer, before the reply's `start` (ADR-0067 amendment 13).
// PR 774 named this as left open. send() ended it as a message that never started: the text went back to the box with an
// ordinary notice, and a chat made for it was deleted. But a request that got no answer can be at the server all the same.
// The server takes the missing reader as Stop: it debits, usually refunds, and in a narrow window saves text and charges.
// The person then held the same message in the box with nothing saying that its first send may still be charged.
//   1. sendTurn says when that is so (`send_unanswered`): its request failed, the reply stream broke or ended with no
//      event, or the answer was neither ours nor a refusal. A typed refusal, a 4xx, and anything before the request
//      (an image, the chat, the key, the session) cannot mean it, and end as they always did.
//   2. send() asks the server about that send by its key, at once: PR 774's route, with the question PR 784 asks at
//      the moment of Stop (askStoppedSend, tests/chatStop.test.mjs). "No job, and the key is closed" is the ending it
//      had. A job is looked for at once: settled, it ends as a stream that broke after `start` does.
//   3. Nothing final (the route refuses, still offline, slow, or the job is not settled when the look ends): the message
//      goes back with the warning for a dropped connection kept beside it, on screen and after a page reload, with the
//      send's key. A chat made for the message stays. Opening the chat later asks again and settles it
//      (tests/chatWarningTurns.test.mjs).
// send() and sendTurn each run for real, with the screen and the network faked (tests/chatSendFlow.harness.mjs). They do
// not run together: the harness plays sendTurn, and raises the error the real one is shown to raise in section 1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_NOTICE, NEW_CHAT, clearNotice, readCreditsWarning, textMark, writeDraft, writeNotice } from '../app/veyrnox/_lib/chatLocal.js';
import { A, GatewayError, ME, TEXT, afterReload, cutBeforeText, memory, noAnswer, notOpen, refused, reply, run, stopped, toB, unanswered } from './chatSendFlow.harness.mjs';
import { JOB, JOBS, KEY, OTHER_KEY, SENDS, answers, leftBy, opened, stopBeforeStart } from './chatWarning.harness.mjs';
// sendTurn run for real against a faked fetch: shared with tests/chatSendReplay.test.mjs.
import { DONE, START, dropped, frame, isUnanswered, json, loadApi, page, sent, stream } from './chatSendTurn.harness.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const apiSource = read('../app/veyrnox/_lib/chatApi.js');
const sender = read('../app/veyrnox/_components/chat/useChatSend.js');
const MARK = textMark(TEXT);
const kept = (storage, chat = 'chat-a') => readCreditsWarning(storage, ME, chat);
const refusal = (status, code) => async () => { throw Object.assign(new Error(code), { status, code }); };

// ---- 1. sendTurn: which failures mean the request may be at the server ----

test('the request failed after it went out: no answer, which is not "nothing was sent"', async () => {
    const lost = await sent(async () => { throw dropped(); });
    assert.ok(isUnanswered(lost.e), String(lost.e));
    assert.equal(lost.calls.length, 1, 'the request was made, once');
    assert.match(lost.calls[0][0], /\/api\/v1\/chat\/threads\/chat-a\/messages$/);
    // Stop is the person's own doing, and stays Stop: send() looks for a stopped turn its own way.
    const stop = await sent(async () => { throw stopped(); });
    assert.equal(stop.e.name, 'AbortError');
    assert.equal(stop.e instanceof GatewayError, false);
});

test('the reply stream broke: the server had answered with a stream, so it debited, and nothing of ours says how it ended', async () => {
    // Before any event. The headers alone come after the debit (tests/chatBrokenStream.test.mjs: `start` follows it).
    const before = await sent(async () => stream([], dropped()));
    assert.ok(isUnanswered(before.e), String(before.e));
    assert.deepEqual(before.events, []);
    // After `start` it is thrown the same way: send() has `started` by then, and looks for the turn by its job.
    const after = await sent(async () => stream([START], dropped()));
    assert.ok(isUnanswered(after.e));
    assert.deepEqual(after.events, ['start']);
    // Stop while the reply streams.
    const stop = await sent(async () => stream([START], stopped()));
    assert.equal(stop.e.name, 'AbortError');
});

test('a reply stream that ends without one event is no answer either, and one that ran is', async () => {
    const empty = await sent(async () => stream([]));
    assert.ok(isUnanswered(empty.e), 'the first thing the server writes is `start`: a stream with nothing in it was cut');
    // Nothing that is not an event of ours counts as one: a keep-alive line, a frame that does not parse, a frame cut
    // short before its end, or no body at all.
    const none = [['a keep-alive line', stream([': ping\n\n'])], ['a frame with no data', stream(['event: start\n\n'])], ['a frame that does not parse', stream(['event: start\ndata: {"job_id"\n\n'])],
        ['a frame cut short', stream(['event: start\ndata: {"job_id":"x"}'])], ['no body', new Response(null, { status: 200, headers: { 'content-type': 'text/event-stream' } })]];
    for (const [name, answer] of none) {
        const cut = await sent(async () => answer);
        assert.ok(isUnanswered(cut.e), name);
        assert.deepEqual(cut.events, [], name);
    }
    const whole = await sent(async () => stream([START, frame('delta', { text: 'A lamp' }), DONE]));
    assert.deepEqual([whole.r, whole.events, whole.e], [{ replay: false }, ['start', 'delta', 'done'], undefined]);
});

test('an answer of ours is an answer: a replay, and a refusal that names itself, whatever its status', async () => {
    // CHANGED (amendment 14): it was `{ replay: true }`, with the job the server names dropped. The job goes with it now:
    // a replay is looked for by it (tests/chatSendReplay.test.mjs).
    const replay = await sent(async () => json(200, { replay: true, job_id: JOB }));
    assert.deepEqual(replay.r, { replay: true, job: JOB });
    // Every refusal the turn can send is JSON with `error` (lib/chatTurn.js). Two of them come after the debit
    // (`provider_submit_failed`, and `debit_failed` when the database's answer was lost): no reply runs after either.
    for (const [status, error] of [[400, 'invalid_text'], [402, 'insufficient_balance'], [403, 'account_frozen'], [404, 'thread_not_found'], [409, 'send_closed'], [429, 'rate_limited'],
        [502, 'debit_failed'], [502, 'provider_submit_failed'], [503, 'chat_not_open'], [503, 'rate_check_unavailable']]) {
        const { e } = await sent(async () => json(status, { error }));
        assert.deepEqual([e instanceof GatewayError, e.code, e.status], [true, error, status], error);
    }
    const out = await sent(async () => json(401, { error: 'not_authenticated' }));
    assert.deepEqual([out.e.code, out.e.status], ['unauthenticated', 401]);
});

test('an answer that is not ours: a 4xx is a refusal by whatever stood in front, anything else leaves the send unknown', async () => {
    // No refusal of ours comes without `error`. A 4xx with none was made before the turn could run: by the edge, a
    // proxy, the framework (no such route, body too large). It ends as it always did.
    for (const status of [400, 403, 404, 405, 413, 429]) {
        const { e } = await sent(async () => page(status));
        assert.deepEqual([e instanceof GatewayError, e.code, e.status], [true, 'gateway_error', status], String(status));
    }
    // A 5xx with no `error` can be a Worker that failed after the debit, with the turn handed to waitUntil and still
    // running. Nothing in it says the turn did not run.
    for (const status of [500, 502, 503, 504, 520, 524]) {
        const { e } = await sent(async () => page(status));
        assert.ok(isUnanswered(e, status), String(status));
    }
    // The same for a body that is not one of ours under a status that is not a refusal.
    for (const answer of [() => json(200, {}), () => json(200, { ok: true }), () => page(200), () => new Response(null, { status: 204 })]) {
        const { e } = await sent(async () => answer());
        assert.ok(e instanceof GatewayError && e.code === 'send_unanswered', String(e));
    }
});

test('Stop is the signal the request is made with, and stays Stop wherever it lands', async () => {
    const ac = new AbortController();
    let seen = null;
    const hangs = (_url, init) => new Promise((_, reject) => { seen = init.signal; if (init.signal.aborted) reject(init.signal.reason); else init.signal.addEventListener('abort', () => reject(init.signal.reason)); });
    const going = sent(hangs, { signal: ac.signal });
    ac.abort();
    const stop = await going;
    assert.equal(seen, ac.signal, 'the Stop button\'s own signal');
    assert.deepEqual([stop.e.name, stop.e instanceof GatewayError], ['AbortError', false]);
    // Stop while an answer that is not a stream is still being read: not "no answer", which would be asked about.
    const body = new ReadableStream({ pull(c) { c.error(stopped()); } });
    const mid = await sent(async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }));
    assert.deepEqual([mid.e.name, mid.e instanceof GatewayError], ['AbortError', false]);
});

test('with no session nothing goes out, so there is nothing to ask about', async () => {
    const { e, calls } = await sent(async () => { throw new Error('must not be called'); }, { token: null });
    assert.deepEqual([e.code, e.status, calls.length], ['no_token', 401, 0]);
});

// ---- 2. asking about the send at once, by its key ----

test('one question, asked in two endings: the same ask as Stop before `start`, through the same route', () => {
    // What it takes as an answer, its 2-second limit and that it never throws are tested where it lives (tests/chatStop.test.mjs).
    const ask = 'await askStoppedSend({ key, closeSend: chatApi.closeSend })';
    assert.equal(sender.split(ask).length - 1, 2, 'Stop before `start`, and a request that got no answer');
    assert.equal(sender.split('askStoppedSend(').length - 1, 2);
    assert.doesNotMatch(apiSource + read('../app/veyrnox/_lib/chatWarning.js'), /\bask(?!Stopped|Kept)[A-Z]\w*\(/, 'no second copy of the question');
});

// ---- 3. send(): no final answer. The message goes back with the warning, never without it ----

test('no answer, and the server could not say: the text is back in the box with the warning, on screen and after a reload', async () => {
    const storage = memory();
    const { log, bubbles } = await run({ active: A, turn: noAnswer(), key: KEY, storage, images: [{ asset: 'x' }] });
    assert.deepEqual(log.closes, [KEY], 'asked about by the key it went out with');
    assert.deepEqual(log.box, ['', TEXT]);
    assert.deepEqual(log.notices, [null, 'connection_lost'], 'the words for a dropped connection that is not settled: it may have used Credits');
    // The money rule. After a page reload the box holds the message and the warning is beside it.
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: TEXT, notice: { code: 'connection_lost' } });
    // Kept with the send's key, to be asked about when the chat is opened, and a mark of the text that was given back.
    assert.deepEqual(kept(storage), { code: 'connection_lost', key: KEY, sent: MARK });
    // As Stop before `start`: the chat stays, nothing is read again, the images stay with the message, no bubble is left.
    assert.deepEqual([log.deleted, log.opened, log.looks, log.imagesCleared, bubbles()], [[], [], [], 0, []]);
    assert.deepEqual(log.failures, [], 'not the screen\'s general failure');
});

test('the same from a chat that had not started: the chat made for the message stays, and holds the text and the warning', async () => {
    const storage = memory();
    const { log } = await run({ active: null, turn: noAnswer(), key: KEY, storage });
    assert.deepEqual([log.activeSet, log.deleted], [['made'], []], 'a reply that may still be saved needs its chat');
    assert.deepEqual(afterReload(storage, 'made'), { box: TEXT, notice: { code: 'connection_lost' } });
    assert.deepEqual(kept(storage, 'made'), { code: 'connection_lost', key: KEY, sent: MARK });
    assert.deepEqual(afterReload(storage, NEW_CHAT), { box: '', notice: null });
});

test('every way the ask can fail to give a final answer ends the same: the route off, offline, a limit, a slow or odd answer', async () => {
    const none = [['the route is not open', refusal(503, 'send_close_not_open')], ['still offline', async () => { throw dropped(); }], ['too many sends closed', refusal(429, 'close_limit')],
        ['an answer in a shape the route does not send', answers({ found: false })], ['no answer in time', () => new Promise(() => {})]];
    for (const [name, closeSend] of none) {
        const storage = memory();
        const { log } = await run({ active: A, turn: noAnswer(), key: KEY, storage, closeSend, askLimitMs: 30 });
        assert.deepEqual([log.notices, log.box, log.deleted], [[null, 'connection_lost'], ['', TEXT], []], name);
        assert.deepEqual([afterReload(storage, 'chat-a'), kept(storage)], [{ box: TEXT, notice: { code: 'connection_lost' } }, { code: 'connection_lost', key: KEY, sent: MARK }], name);
    }
});

test('the person is somewhere else when it ends: the text and the warning wait in the chat the message was sent in', async () => {
    const away = await run({ active: A, turn: noAnswer(toB), images: [{ asset: 'x' }] });
    assert.deepEqual([away.log.added, away.log.saved, away.log.box, away.log.notices], [{ 'chat-a': TEXT }, {}, [''], [null]], 'nothing changes on the chat that is on screen');
    assert.deepEqual([away.kept(), away.log.imagesCleared], [{ 'chat-a': 'connection_lost' }, 1], 'the images cannot wait with it');
    // Stored once, above what that chat's box holds by then. (The page was not left: the text is not stored a second time.)
    const storage = memory();
    await run({ active: A, turn: noAnswer((p) => { p.opens('chat-b'); writeDraft(storage, ME, 'chat-a', 'Something else.'); }), key: KEY, storage });
    assert.equal(afterReload(storage, 'chat-a').box, `${TEXT}\n\nSomething else.`);
});

test('the chat page was left before it ended: the message is not lost, it waits in its chat beside the warning', async () => {
    // On a dead network the request hangs, the person goes to another page, and then it fails. Before this ending the
    // text was stored (with an ordinary notice). Stop before `start` drops the text of a page that was left, because a
    // warning had nowhere to wait then. This one's warning is stored, so its text is stored beside it.
    const storage = memory();
    const { log } = await run({ active: A, turn: noAnswer((p) => p.leavesThePage()), key: KEY, storage, images: [{ asset: 'x' }] });
    assert.deepEqual([log.box, log.notices, log.deleted], [[''], [null], []], 'nothing on a screen that is gone');
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: TEXT, notice: { code: 'connection_lost' } }, 'the money rule holds there too: the text with the warning');
    assert.deepEqual(kept(storage), { code: 'connection_lost', key: KEY, sent: MARK });
    // Text stored for that chat since the press (another tab): the message goes above it, as any text given back to a chat not on screen.
    const typed = memory();
    await run({ active: A, turn: noAnswer((p) => { p.leavesThePage(); writeDraft(typed, ME, 'chat-a', 'Something else.'); }), key: KEY, storage: typed });
    assert.equal(afterReload(typed, 'chat-a').box, `${TEXT}\n\nSomething else.`);
    // A chat made for the message: it stays, and holds both.
    const made = memory();
    const fromNew = await run({ active: null, turn: noAnswer((p) => p.leavesThePage()), key: KEY, storage: made });
    assert.deepEqual([fromNew.log.deleted, afterReload(made, 'made')], [[], { box: TEXT, notice: { code: 'connection_lost' } }]);
    // The chat was deleted by the person, and then the page was left: both wait under New chat, where a gone chat's endings land.
    const gone = memory();
    await run({ active: A, turn: noAnswer((p) => { p.deletes('chat-a'); p.leavesThePage(); }), key: KEY, storage: gone });
    assert.deepEqual([afterReload(gone, NEW_CHAT), afterReload(gone, 'chat-a')], [{ box: TEXT, notice: { code: 'connection_lost' } }, { box: '', notice: null }]);
});

test('while the server is asked the button says Checking, and the look ends when the send does', async () => {
    let atAsk = null; let bubblesAtAsk = null;
    const { log } = await run({ active: A, turn: noAnswer(), key: KEY, closeSend: (_key, person, soFar) => { atAsk = [...soFar.checking]; bubblesAtAsk = person.bubbles(); return notOpen(); } });
    assert.deepEqual([atAsk, log.checking], [[true], [true, false]]);
    // The reply bubble says the connection was lost while the server is asked, and both bubbles go when the text goes back.
    assert.deepEqual(bubblesAtAsk, ['user:complete', 'assistant:lost']);
    assert.match(sender, /\n {2}const \[checking, setChecking\] = useState\(false\);/, 'the third state of the hook, which the harness records');
    // The reply bubble says the connection was lost, as for a stream that broke: it is marked before the ask.
    const ask = /\n {6}\}\)\.catch\(async \(e\) => \{\n([\s\S]*?)\n {6}\}\);\n {6}if \(r\.replay\)/.exec(sender);
    assert.ok(ask, 'the ask sits on the request it is about');
    assert.ok(ask[1].indexOf('setChecking(true);') >= 0 && ask[1].indexOf("status: 'lost'") > 0 && ask[1].indexOf('setChecking(true);') < ask[1].indexOf('await askStoppedSend('));
    assert.equal(ask[1].split('await askStoppedSend(').length - 1, 1, 'asked once here');
    assert.match(ask[1], /\n {8}throw e;$/, 'the failure itself goes on to the endings, whatever was answered');
});

// ---- 4. send(): the server did say ----

test('the server says the send made no job and has closed its key: it never started, and ends as that always did', async () => {
    const storage = memory();
    const { log } = await run({ active: null, turn: noAnswer(), key: KEY, storage, closeSend: answers(SENDS.closed) });
    assert.deepEqual([log.closes, log.looks], [[KEY], []]);
    assert.deepEqual([log.activeSet, log.deleted, log.box], [['made', null], ['made'], ['', TEXT]], 'the chat made for it goes: no reply can be saved to it now');
    assert.deepEqual(afterReload(storage, NEW_CHAT), { box: TEXT, notice: { code: 'send_unanswered' } });
    assert.deepEqual([kept(storage, NEW_CHAT), kept(storage, 'made')], [null, null], 'nothing can be charged for it, so nothing warns of Credits');
    // No new words: it reads as the general failure it read as before.
    assert.equal(loadApi(async () => page(500)).chatErrorCopy('send_unanswered'), "That didn't work. Try again.");
});

test('the server says the send made a job: the turn is looked for by that job, and once settled ends exactly as after a stream that broke', async () => {
    const withJob = (settle, more = {}) => run({ active: A, turn: noAnswer(), key: KEY, closeSend: answers(SENDS.running), settle, images: [{ asset: 'x' }], ...more });
    // Debited and refunded, nothing kept: the usual end of a send whose reader had gone.
    const nothing = await withJob('nothing');
    assert.deepEqual([nothing.log.closes, nothing.log.looks], [[KEY], [JOB]], 'the job the server named is the one read, in one look');
    assert.deepEqual([nothing.log.box, nothing.log.notices, nothing.kept(), nothing.log.imagesCleared], [['', TEXT], [null, 'connection_refunded'], { 'chat-a': 'connection_refunded' }, 0]);
    // The same from a chat made for the message: it goes, and the text is under New chat.
    const made = await withJob('nothing', { active: null });
    assert.deepEqual([made.log.deleted, made.log.saved, made.kept()], [['made'], { [NEW_CHAT]: TEXT }, { [NEW_CHAT]: 'connection_refunded' }]);
    // Saved all the same: the chat is read again and shows the reply and its price. The message is not offered again.
    const saved = await withJob('saved');
    assert.deepEqual([saved.log.opened, saved.log.box, saved.log.notices, saved.kept(), saved.log.imagesCleared], [['chat-a'], [''], [null, 'connection_saved'], { 'chat-a': 'connection_saved' }, 1]);
    // Charged and not stored.
    const unsaved = await withJob('unsaved');
    assert.deepEqual([unsaved.log.box, unsaved.kept()], [[''], { 'chat-a': 'reply_not_saved' }]);
    for (const settled of [saved, unsaved, nothing, made]) assert.deepEqual(settled.log.looks, [JOB], 'looked for once');
    // Saved, but the chat cannot be read again (still offline): the screen cannot show it, so the warning is kept, by that job.
    const storage = memory();
    const unread = await withJob('saved', { storage, openDown: true });
    assert.deepEqual([unread.log.notices, unread.log.box, kept(storage)], [[null, 'connection_lost'], [''], { code: 'connection_lost', job: JOB }]);
});

test('whatever goes wrong while the server is asked, the send ends with the warning: never as a message that never started', async () => {
    // The server has just named a job for the send, and the look for its turn throws (a chat read in a shape the look
    // does not know). The job exists, so a reply can still be saved: the chat must stay and the warning must be kept.
    const storage = memory();
    const { log } = await run({ active: null, turn: noAnswer(), key: KEY, storage, closeSend: answers(SENDS.running), settle: () => { throw new TypeError("Cannot read properties of null (reading 'role')"); } });
    assert.deepEqual([log.deleted, log.box, log.notices], [[], ['', TEXT], [null, 'connection_lost']], 'the chat made for the message is not deleted');
    assert.deepEqual([afterReload(storage, 'made'), kept(storage, 'made')], [{ box: TEXT, notice: { code: 'connection_lost' } }, { code: 'connection_lost', key: KEY, sent: MARK }]);
    // The same when the route itself throws.
    const thrown = await run({ active: A, turn: noAnswer(), key: KEY, closeSend: () => { throw new Error('boom'); } });
    assert.deepEqual([thrown.log.deleted, thrown.log.box, thrown.kept()], [[], ['', TEXT], { 'chat-a': 'connection_lost' }]);
});

test('the send made a job that is not settled when the look ends: the message goes back with the warning, as when the server could not say', async () => {
    // Nothing of this reply was ever on screen, so there is nothing to keep there. The job may still end saved (the
    // server had text) or refunded (the usual end, or a job the sweep takes back later). Left on screen as sent, a
    // refund would have lost the message: before this ending its text was always given back.
    const storage = memory();
    const { log, bubbles } = await run({ active: null, turn: noAnswer(), key: KEY, closeSend: answers(SENDS.running), settle: 'pending', storage, images: [{ asset: 'x' }] });
    assert.deepEqual([log.closes, log.looks], [[KEY], [JOB]]);
    assert.deepEqual([log.box, log.notices, log.deleted, log.opened, log.imagesCleared, bubbles()], [['', TEXT], [null, 'connection_lost'], [], [], 0, []]);
    assert.deepEqual(afterReload(storage, 'made'), { box: TEXT, notice: { code: 'connection_lost' } });
    // Kept by the send's key, which finds the same job when the chat is opened, with the mark of the text given back.
    assert.deepEqual(kept(storage, 'made'), { code: 'connection_lost', key: KEY, sent: MARK });
    assert.deepEqual(await opened(storage, 'made', answers(SENDS.saved)), { box: '', notice: { code: 'connection_saved' }, changed: true, calls: [KEY] });
});

// ---- 5. what is not asked about, and ends as before ----

test('only a send whose own request got no answer is asked about', async () => {
    const offline = () => new TypeError('Failed to fetch');
    const cases = [
        ['not enough Credits', { turn: refused(new GatewayError('no', { status: 402, code: 'insufficient_balance' })) }, 'insufficient_balance'],
        ['too fast', { turn: refused(new GatewayError('no', { status: 429, code: 'rate_limited' })) }, 'rate_limited'],
        ['a refusal by something in front of the server', { turn: refused(new GatewayError('HTTP 403', { status: 403, code: 'gateway_error' })) }, 'gateway_error'],
        ['an image that did not upload', { images: [{ file: {} }], upload: async () => { throw new GatewayError('upload_failed', { status: 0, code: 'upload_failed' }); } }, 'upload_failed'],
        ['an image the upload request never reached the server for', { images: [{ file: {} }], upload: async () => { throw offline(); } }, undefined],
        ['an image that cannot be read', { images: [{ file: {} }], prepare: async () => { throw new Error('image_unreadable'); } }, 'image_unreadable'],
        ['a chat that could not be made, offline', { active: null, making: async () => { throw offline(); } }, undefined],
        ['a key that could not be made', { key: () => { throw new TypeError('crypto.randomUUID is not a function'); } }, undefined],
    ];
    for (const [name, how, code] of cases) {
        const { log } = await run({ active: A, turn: reply(), key: KEY, closeSend: () => { throw new Error('must not be asked'); }, ...how });
        assert.deepEqual([log.closes, log.looks, log.checking], [[], [], [false]], name);
        assert.deepEqual([log.notices, log.box], [[null, code], ['', TEXT]], name);
    }
    // Stop is not this ending. Before `start` it asks through its own branch (PR 784); after `start` it has its job. Neither shows Checking.
    const early = await run({ active: A, turn: stopBeforeStart, key: KEY, settle: 'pending' });
    assert.deepEqual([early.log.closes, early.log.notices, early.log.checking], [[KEY], [null, 'stop_unsure'], [false]]);
    const late = await run({ active: A, turn: async ({ onEvent }) => { onEvent('start', { job_id: JOB }); throw stopped(); }, key: KEY, settle: 'pending' });
    assert.deepEqual([late.log.closes, late.log.notices, late.log.checking], [[], [null, 'stop_unsure'], [false]]);
    // Nor is a stream that broke after `start`: its job came with `start`.
    for (const turn of [cutBeforeText(), async ({ onEvent }) => { onEvent('start', { job_id: 'job-1' }); throw unanswered(); }]) {
        const { log } = await run({ active: A, turn, key: KEY, settle: 'nothing' });
        assert.deepEqual([log.closes, log.looks, log.notices], [[], ['job-1'], [null, 'connection_refunded']]);
    }
});

// ---- 6. beside a warning kept for the message before ----

test('a second message with no answer: its warning takes the place of the one before and stands for both sends', async () => {
    const storage = await leftBy(stopBeforeStart, { key: KEY });
    assert.deepEqual(kept(storage), { code: 'stop_unsure', key: KEY, sent: MARK });
    const { log } = await run({ active: A, turn: noAnswer(), key: OTHER_KEY, storage });
    assert.deepEqual(log.notices, [null, 'connection_lost']);
    assert.deepEqual(kept(storage), { code: 'connection_lost', turns: [{ key: KEY, sent: MARK }, { key: OTHER_KEY, sent: MARK }] });
    // It goes only when both are settled (tests/chatWarningTurns.test.mjs has every mix).
    assert.equal((await opened(storage, 'chat-a', async (key) => (key === KEY ? SENDS.closed : SENDS.running))).changed, false);
    assert.deepEqual(await opened(storage, 'chat-a', answers(SENDS.closed)), { box: TEXT, notice: null, changed: true, calls: [KEY, OTHER_KEY] });
});

test('two sends under one dropped-connection warning that settled differently: the words for several, not for one', async () => {
    const both = async () => { const storage = await leftBy(stopBeforeStart, { key: KEY }); await run({ active: A, turn: noAnswer(), key: OTHER_KEY, storage }); return storage; };
    const byKey = (first, second) => async (key) => (key === KEY ? first : second);
    let storage = await both();
    assert.deepEqual(await opened(storage, 'chat-a', byKey(SENDS.closed, SENDS.saved)), { box: '', notice: { code: 'turns_settled' }, changed: true, calls: [KEY, OTHER_KEY] });
    storage = await both();
    assert.deepEqual(await opened(storage, 'chat-a', byKey(SENDS.saved, SENDS.closed)), { box: '', notice: { code: 'turns_settled' }, changed: true, calls: [KEY, OTHER_KEY] });
});

test('a second message the server says never started says so beside the warning kept before it, which stays', async () => {
    const storage = await leftBy(stopBeforeStart, { key: KEY });
    const { log } = await run({ active: A, turn: noAnswer(), key: OTHER_KEY, storage, closeSend: answers(SENDS.closed) });
    assert.deepEqual(log.notices, [null, 'send_unanswered, and before that stop_unsure']);
    assert.deepEqual([afterReload(storage, 'chat-a'), kept(storage)], [{ box: TEXT, notice: { code: 'stop_unsure' } }, { code: 'stop_unsure', key: KEY, sent: MARK }]);
});

// ---- 7. the kept warning, when its chat is next opened (PR 774's ask) ----

test('opening the chat settles the warning by the send\'s key: closed or refunded takes it away and leaves the text', async () => {
    for (const answer of [SENDS.closed, SENDS.refunded]) {
        const storage = await leftBy(noAnswer(), { key: KEY });
        assert.deepEqual(await opened(storage, 'chat-a', answers(answer)), { box: TEXT, notice: null, changed: true, calls: [KEY] });
        assert.equal(kept(storage), null);
    }
});

test('saved late: the chat shows the reply and its price, the unchanged message leaves the box, and the words are a dropped connection\'s', async () => {
    let storage = await leftBy(noAnswer(), { key: KEY });
    assert.deepEqual(await opened(storage, 'chat-a', answers(SENDS.saved)), { box: '', notice: { code: 'connection_saved' }, changed: true, calls: [KEY] });
    assert.equal(kept(storage), null, 'not a warning now: the charge is in the chat');
    assert.deepEqual(await opened(storage, 'chat-a', answers(SENDS.saved)), { box: '', notice: { code: 'connection_saved' }, changed: false, calls: [] }, 'said until the next message, and not asked again');
    // Text the person has changed since is theirs.
    storage = await leftBy(noAnswer(), { key: KEY });
    writeDraft(storage, ME, 'chat-a', `${TEXT} And its keeper.`);
    assert.deepEqual(await opened(storage, 'chat-a', answers(SENDS.saved)), { box: `${TEXT} And its keeper.`, notice: { code: 'connection_saved' }, changed: true, calls: [KEY] });
    // Nobody pressed Stop: never "A reply was saved after you pressed Stop". Stop before `start` still says it.
    const stop = await leftBy(stopBeforeStart, { key: KEY });
    assert.deepEqual((await opened(stop, 'chat-a', answers(SENDS.saved))).notice, { code: 'stop_saved' });
    // Charged and not stored: said, and kept as the warning that has nothing to ask.
    storage = await leftBy(noAnswer(), { key: KEY });
    assert.deepEqual(await opened(storage, 'chat-a', answers(SENDS.unsaved)), { box: TEXT, notice: { code: 'reply_not_saved' }, changed: true, calls: [KEY] });
});

test('the warning is never removed on a failed or ambiguous answer', async () => {
    const cases = [['still running', answers(SENDS.running)], ['failed, the refund not yet in', answers(SENDS.failed)], ['the route is not open', refusal(503, 'send_close_not_open')],
        ['offline', async () => { throw dropped(); }], ['an odd answer', answers({ closed: 'true' })], ['no answer', answers(null)]];
    for (const [name, answer] of cases) {
        const storage = await leftBy(noAnswer(), { key: KEY });
        const after = await opened(storage, 'chat-a', answer);
        assert.deepEqual([after.changed, after.box, after.notice, kept(storage)], [false, TEXT, { code: 'connection_lost' }, { code: 'connection_lost', key: KEY, sent: MARK }], name);
    }
});

// ---- 8. the store: a mark of the text beside a dropped connection's warning only when the text was given back ----

test('a dropped connection kept by its key had its text given back, so the mark is kept; kept by its job it had not', () => {
    const s = memory();
    const at = `veyrnox_chat_notice_v1:${ME}:chat-a`;
    writeNotice(s, ME, 'chat-a', 'connection_lost', { job: null, key: KEY, sent: TEXT });
    assert.equal(s.getItem(at), `{"code":"connection_lost","key":"${KEY}","sent":"${MARK}"}`, 'the mark, never the text');
    // With a job the reply had started: its message stayed on screen, and was not given back (tests/chatBrokenStream.test.mjs).
    clearNotice(s, ME, 'chat-a'); writeNotice(s, ME, 'chat-a', 'connection_lost', { job: JOB, key: KEY, sent: TEXT });
    assert.equal(s.getItem(at), `{"code":"connection_lost","job":"${JOB}"}`);
    // Stop after text is never given back, whatever it is asked by.
    clearNotice(s, ME, 'chat-a'); writeNotice(s, ME, 'chat-a', 'stop_saving', { key: KEY, sent: TEXT });
    assert.equal(s.getItem(at), `{"code":"stop_saving","key":"${KEY}"}`);
    // Read back the same way: a mark found beside a job, or beside another warning, is not passed on.
    s.setItem(at, JSON.stringify({ code: 'connection_lost', key: KEY, sent: MARK }));
    assert.deepEqual(kept(s), { code: 'connection_lost', key: KEY, sent: MARK });
    s.setItem(at, JSON.stringify({ code: 'connection_lost', job: JOB, sent: MARK }));
    assert.deepEqual(kept(s), { code: 'connection_lost', job: JOB });
    s.setItem(at, JSON.stringify({ code: 'stop_saving', key: KEY, sent: MARK }));
    assert.deepEqual(kept(s), { code: 'stop_saving', key: KEY });
    // The longest notice there is now: still inside the length a page running older code reads.
    clearNotice(s, ME, 'chat-a'); writeNotice(s, ME, 'chat-a', 'connection_lost', { key: KEY, sent: 'x'.repeat(8000) });
    assert.ok(s.getItem(at).length <= 95 && s.getItem(at).length <= MAX_NOTICE, `${s.getItem(at).length} characters`);
    // A page running PR 774's code reads it as the same warning, asked about by the same key, without the mark.
    const n = JSON.parse(s.getItem(at));
    assert.deepEqual([n.code, n.key], ['connection_lost', KEY]);
});

// ---- 9. the shape of send() ----

test('the ending for no final answer is Stop-before-start\'s, with a dropped connection\'s words, and nothing else in send() changed place', () => {
    const block = /\n {6}\} else if \(unsure\) \{\n([\s\S]*?)\n {6}\} else \{\n/.exec(sender);
    assert.ok(block, 'its own branch of the catch block, between a stream that broke and a turn that never started');
    const lines = block[1].split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')).map((l) => l.replace(/ +\/\/.*$/, ''));
    assert.deepEqual(lines, ['        giveBack(false);', '        if (at().left) addDraft(at().home, content);', "        tell('connection_lost');"], 'the chat stays, the text goes back wherever the person is, and the warning is kept with it');
    assert.ok(sender.indexOf('} else if (started) {') < sender.indexOf('} else if (unsure) {'));
    // `unsure` is set in one place, from the server's answer: not "closed", and not a job the look has settled.
    assert.match(sender, /\n {4}let unsure = false;[^\n]*\n {4}let looked = null;[^\n]*\n {4}let started = false;[^\n]*\n {4}try \{\n/);
    // It is set before the server is asked and cleared only by "closed": anything else, a throw included, ends with the warning.
    const ask = /\n {6}\}\)\.catch\(async \(e\) => \{\n([\s\S]*?)\n {6}\}\);\n/.exec(sender)[1];
    assert.ok(ask.indexOf('unsure = true;') > 0 && ask.indexOf('unsure = true;') < ask.indexOf('await askStoppedSend('));
    assert.match(ask, /\n {8}if \(found\.closed\) unsure = false;\n/);
    // CHANGED (amendment 14): the look for a job the server named was written out here. A replay names a job too, so it is
    // one function now, `lookFor`, called from both (tests/chatSendReplay.test.mjs pins it). What it does is the same.
    assert.match(ask, /\n {8}else if \(found\.job\) await lookFor\(found\.job\);[^\n]*\n/);
    assert.match(sender, /const lookFor = async \(job\) => \{ looked = await chatApi\.settleStop\(\{ threadId: thread\.id, jobId: job, text: content, knownIds \}\); if \(looked === 'pending'\) looked = null; else \{ started = true; jobId = job; \} \};/);
    // CHANGED (amendment 14): it was 3. A replay sets it too, before its job is looked for, and nothing there clears it.
    assert.equal(sender.split('unsure = ').length - 1, 4, 'declared, set before the ask, cleared by "closed", set by a replay');
    // The look made for the server's job is the one the ending acts on: the turn is not looked for twice.
    // CHANGED (amendment 14): the line ended at `);`. A look that goes wrong there now counts as not settled, so the send
    // ends with the warning and does not reject with nothing said (tests/chatSendReplay.test.mjs). The look is the same.
    assert.match(sender, /\n {8}const outcome = looked \|\| await chatApi\.settleStop\(\{ threadId: thread\.id, jobId, text: content, knownIds \}\)\.catch\(\(\) => 'pending'\);/);
    // Asked only before `start`, and only for the one error sendTurn raises for a request that got no answer.
    assert.match(sender, /if \(started \|\| !\(e instanceof GatewayError\) \|\| e\.code !== 'send_unanswered'\) throw e;/);
});
