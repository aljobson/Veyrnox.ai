// Stop before the reply's `start`, settled at the moment of Stop where it can be (ADR-0067 amendment 12).
// No job id has reached the browser, so the look for the stopped turn can only read the chat. It nearly always ended
// "not settled", and the chat kept a warning with the send's key until it was next opened (amendment 11). The server
// is now asked about the send by that key as soon as Stop is pressed:
//   1. It closed the send: no reply was charged and none can be. The ending of a job that kept nothing, at once.
//   2. It names the job the send made: that job is looked for, and every ending is the one Stop after `start` has.
//   3. No answer (a refusal, a rate limit, the route not open, too slow, a shape not known): nothing is known, and
//      the ending is the one it was before this, the warning kept with the key.
// And nothing else asks: Stop after `start`, a dropped connection and a message that never started are as they were.
// send() runs for real (tests/chatSendFlow.harness.mjs). Each new ending is held to the old ending it is meant to
// equal by running both and comparing everything the screen and the store were left with.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NEW_CHAT, readCreditsWarning, textMark } from '../app/veyrnox/_lib/chatLocal.js';
import { A, GatewayError, ME, TEXT, afterReload, cutBeforeText, memory, notOpen, refused, reply, run, stopAfterText, stopBeforeText, stopped, toB } from './chatSendFlow.harness.mjs';
import { JOB, JOBS, KEY, OTHER_KEY, SENDS, answers, leftBy, opened, stopBeforeStart } from './chatWarning.harness.mjs';

const MARK = textMark(TEXT);
const kept = (storage, chat = 'chat-a') => readCreditsWarning(storage, ME, chat);
/** Stop before `start`, and Stop after it with no text yet. `meanwhile` is what the person did before pressing Stop. */
const stopEarly = (meanwhile = () => {}) => async (_args, person) => { meanwhile(person); throw stopped(); };
const stopStarted = (meanwhile = () => {}) => async ({ onEvent }, person) => { onEvent('start', { job_id: JOB }); meanwhile(person); throw stopped(); };
const everything = (storage) => Object.fromEntries(Array.from({ length: storage.length }, (_, i) => [storage.key(i), storage.getItem(storage.key(i))]).sort());
/** All a send left behind: what the screen was told, in order, and what is stored. Not which question was asked. */
const ending = ({ log, view, bubbles }, storage) => ({
    box: log.box, notices: log.notices, opened: log.opened, shownOnOpen: log.shownOnOpen, deleted: log.deleted, activeSet: log.activeSet, imagesCleared: log.imagesCleared,
    refreshed: log.refreshed, quietReads: log.quietReads, failures: log.failures, bubbles: bubbles(), shown: view.shown, asked: view.asked, stored: everything(storage),
});
/** Where the person was when the message ended. Each is run from a chat that was open, and from New chat (a chat is made for the message). */
const PLACES = [['stayed', () => {}], ['opened another chat', toB], ['pressed another chat, still loading', (p) => p.press('chat-b')], ['left the chat page', (p) => p.leavesThePage()]];
const FROM = [['a chat', A], ['New chat', null]];
const IMAGES = [{ asset: 'x' }];

test('the server closed the send: the text and its images are back, nothing is kept or said, and the turn is not looked for', async () => {
    const storage = memory();
    const sent = await run({ active: A, turn: stopBeforeStart, storage, key: KEY, closeSend: answers(SENDS.closed), images: IMAGES });
    assert.deepEqual(sent.log.closes, [KEY], 'asked once, by the key the send went out with');
    assert.deepEqual(sent.log.looks, [], 'the answer is final: no read of the job or the chat follows');
    assert.deepEqual(sent.log.box, ['', TEXT], 'emptied at the press, and given back');
    assert.deepEqual(sent.log.notices, [null], 'cleared at the press, and nothing said since');
    assert.equal(sent.log.imagesCleared, 0, 'the images wait with the text');
    assert.deepEqual([sent.bubbles(), sent.log.opened, sent.log.deleted], [[], [], []], 'the bubbles go, and the chat is as it was');
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: TEXT, notice: null }, 'after a page reload: the text, and no warning');
    assert.equal(kept(storage), null);
    // Nothing is left to ask when the chat is next opened.
    assert.deepEqual(await opened(storage, 'chat-a', answers(SENDS.closed)), { box: TEXT, notice: null, changed: false, calls: [] });
});

test('closed is the ending of a job that kept nothing, wherever the person is: a chat made for the message goes, and the text waits where it does today', async () => {
    for (const [from, active] of FROM) for (const [place, meanwhile] of PLACES) {
        const name = `sent from ${from}, ${place}`;
        const a = memory(); const b = memory();
        const closed = await run({ active, turn: stopEarly(meanwhile), storage: a, key: KEY, closeSend: answers(SENDS.closed), images: IMAGES });
        const nothing = await run({ active, turn: stopStarted(meanwhile), settle: 'nothing', storage: b, key: KEY, images: IMAGES });
        assert.deepEqual(ending(closed, a), ending(nothing, b), name);
        assert.deepEqual([closed.log.closes, closed.log.looks, nothing.log.closes, nothing.log.looks], [[KEY], [], [], [JOB]], name);
        assert.deepEqual(closed.log.deleted, active ? [] : ['made'], `${name}: known to be over, so a chat made for it is deleted`);
        assert.equal(kept(a, active ? 'chat-a' : NEW_CHAT), null, name);
    }
    // The person moved while the server was being asked: the ending lands where the message was sent from, the same way.
    const a = memory(); const b = memory();
    const closed = await run({ active: A, turn: stopBeforeStart, storage: a, key: KEY, closeSend: async (_key, person) => { person.opens('chat-b'); return SENDS.closed; }, images: IMAGES });
    const nothing = await run({ active: A, turn: stopStarted(toB), settle: 'nothing', storage: b, key: KEY, images: IMAGES });
    assert.deepEqual(ending(closed, a), ending(nothing, b));
    assert.deepEqual([afterReload(a, 'chat-a'), afterReload(a, 'chat-b'), closed.log.imagesCleared], [{ box: TEXT, notice: null }, { box: '', notice: null }, 1], 'the text waits in its own chat, and the images cannot wait with it');
});

test('closed, with a warning kept for the message before it: that warning stays with its turn, and both are said', async () => {
    const SECOND = 'And who kept the lamp lit?';
    const storage = await leftBy(stopStarted());
    const before = kept(storage);
    assert.deepEqual(before, { code: 'stop_unsure', job: JOB, sent: MARK });
    const { log } = await run({ active: A, turn: stopBeforeStart, storage, key: KEY, closeSend: answers(SENDS.closed), text: SECOND });
    assert.deepEqual(kept(storage), before, 'a message that used no Credits says nothing about the one before it');
    assert.equal(log.notices.at(-1), 'stop_refunded, and before that stop_unsure', 'this Stop first, then the earlier warning');
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: SECOND, notice: { code: 'stop_unsure' } });
    // The earlier turn is still asked about when the chat is opened, alone: the closed send is not part of the warning.
    assert.deepEqual((await opened(storage, 'chat-a', answers(JOBS.running))).calls, [JOB]);
});

test('the send made a job: it is looked for by its id, and each ending is the one Stop after `start` has', async () => {
    for (const settle of ['saved', 'unsaved', 'nothing', 'pending']) for (const [from, active] of FROM) for (const [place, meanwhile] of PLACES) {
        const name = `${settle}, sent from ${from}, ${place}`;
        const a = memory(); const b = memory();
        const found = await run({ active, turn: stopEarly(meanwhile), settle, storage: a, key: KEY, closeSend: answers(SENDS.running), images: IMAGES });
        const after = await run({ active, turn: stopStarted(meanwhile), settle, storage: b, key: KEY, images: IMAGES });
        assert.deepEqual(ending(found, a), ending(after, b), name);
        assert.deepEqual([found.log.closes, found.log.looks, after.log.closes, after.log.looks], [[KEY], [JOB], [], [JOB]], name);
    }
    // Whatever the job was doing when it was named, it is the look that decides.
    for (const [state, send] of Object.entries(SENDS).filter(([, s]) => s.closed === false)) {
        const { log } = await run({ active: A, turn: stopBeforeStart, settle: 'pending', storage: memory(), key: KEY, closeSend: answers(send) });
        assert.deepEqual([log.closes, log.looks], [[KEY], [JOB]], state);
    }
});

test('the send made a job and it had not settled when the look ended: the warning is kept with the job id, not the key', async () => {
    const storage = memory();
    await run({ active: A, turn: stopBeforeStart, settle: 'pending', storage, key: KEY, closeSend: answers(SENDS.queued) });
    assert.deepEqual(kept(storage), { code: 'stop_unsure', job: JOB, sent: MARK });
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: TEXT, notice: { code: 'stop_unsure' } }, 'the same words, with the text');
    // So the next time the chat is opened the job is read, which changes nothing on the server, and the key is not asked about again.
    assert.deepEqual(await opened(storage, 'chat-a', answers(JOBS.running)), { box: TEXT, notice: { code: 'stop_unsure' }, changed: false, calls: [JOB] });
    assert.deepEqual(await opened(storage, 'chat-a', answers(JOBS.refunded)), { box: TEXT, notice: null, changed: true, calls: [JOB] });
    // A warning kept before it is handed on with it, as for any warning that takes another's place.
    const two = await leftBy(stopBeforeStart, { key: OTHER_KEY });
    await run({ active: A, turn: stopBeforeStart, settle: 'pending', storage: two, key: KEY, closeSend: answers(SENDS.running) });
    assert.deepEqual(kept(two), { code: 'stop_unsure', turns: [{ key: OTHER_KEY, sent: MARK }, { job: JOB, sent: MARK }] });
});

test('no answer changes nothing: every ending is the one the route gives with its switch off, the warning kept with the key', async () => {
    const refusal = (status, code) => async () => { throw new GatewayError(code, { status, code }); };
    const none = [['rate limited', refusal(429, 'rate_limited')], ['too many sends closed', refusal(429, 'close_limit')], ['the database gave no answer', refusal(502, 'close_failed')],
        ['a key the route does not take', refusal(400, 'invalid_key')], ['offline', async () => { throw new TypeError('Failed to fetch'); }], ['an empty answer', answers({})], ['no body', answers(null)],
        ['"closed" in a shape the route does not send', answers({ closed: 'true' })], ['closed beside a job', answers({ closed: true, job_id: JOB })], ['only "no job was found"', answers({ found: false })],
        ['a job with no id', answers({ closed: false, state: 'running' })], ['a job id the server could not have made', answers({ closed: false, job_id: 'job-1', state: 'running' })],
        ['an answer that never comes', () => new Promise(() => {}), { askLimitMs: 20 }]];
    for (const settle of ['pending', 'saved', 'unsaved', 'nothing']) for (const [from, active] of FROM) {
        const off = memory();
        const before = await run({ active, turn: stopBeforeStart, settle, storage: off, key: KEY, closeSend: notOpen, images: IMAGES });
        assert.deepEqual([before.log.closes, before.log.looks], [[KEY], [null]], 'asked, refused, and the chat alone is read as it always was');
        for (const [why, closeSend, more = {}] of none) {
            const storage = memory();
            const sent = await run({ active, turn: stopBeforeStart, settle, storage, key: KEY, closeSend, images: IMAGES, ...more });
            assert.deepEqual(ending(sent, storage), ending(before, off), `${why}, ${settle}, sent from ${from}`);
            assert.deepEqual([sent.log.closes, sent.log.looks], [[KEY], [null]], why);
        }
        // An answer that comes after the limit. It arrives here only once the send has ended, so no clock decides the
        // order: the ending is the same, and the late answer changes nothing that was left.
        for (const answer of [SENDS.closed, SENDS.saved]) {
            let arrive;
            const pending = new Promise((resolve) => { arrive = resolve; });
            const storage = memory();
            const sent = await run({ active, turn: stopBeforeStart, settle, storage, key: KEY, closeSend: () => pending, images: IMAGES, askLimitMs: 20 });
            const left = ending(sent, storage);
            assert.deepEqual(left, ending(before, off), `an answer that comes too late, ${settle}, sent from ${from}`);
            arrive(answer); await pending; await new Promise((resolve) => { setImmediate(resolve); });
            assert.deepEqual(ending(sent, storage), left, 'the late answer changes nothing');
        }
    }
    // Not settled is what the look nearly always says with no job id: the text is back, with the warning and the key.
    const storage = memory();
    await run({ active: A, turn: stopBeforeStart, settle: 'pending', storage, key: KEY, closeSend: notOpen });
    assert.deepEqual(kept(storage), { code: 'stop_unsure', key: KEY, sent: MARK });
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: TEXT, notice: { code: 'stop_unsure' } });
    // And it is settled when the chat is next opened, once the server answers (amendment 11).
    assert.deepEqual(await opened(storage, 'chat-a', answers(SENDS.closed)), { box: TEXT, notice: null, changed: true, calls: [KEY] });
});

test('only Stop before `start` asks: once a job id has come, or when the message was not stopped, no send is closed', async () => {
    const closing = { key: KEY, closeSend: answers(SENDS.closed) };
    const others = [['Stop after `start`, before any text', { turn: stopBeforeText() }], ['Stop after text', { turn: stopAfterText() }], ['a dropped connection after `start`', { turn: cutBeforeText() }],
        ['a dropped connection before `start`', { turn: refused(new TypeError('network error')) }], ['refused before it started', { turn: refused(new GatewayError('insufficient_balance', { status: 402, code: 'insufficient_balance' })) }],
        ['a reply that ran to its end', { turn: reply() }], ['a replay', { turn: async () => ({ replay: true }) }], ['an image that would not upload', { turn: reply(), images: IMAGES, upload: async () => { throw new GatewayError('upload_failed', { code: 'upload_failed' }); }, prepare: async () => ({}) , imagesAre: [{ file: {} }] }]];
    for (const [name, { imagesAre, ...how }] of others) for (const settle of ['pending', 'nothing', 'saved']) {
        const { log } = await run({ active: A, settle, storage: memory(), ...closing, ...how, ...(imagesAre && { images: imagesAre }) });
        assert.deepEqual(log.closes, [], `${name}, ${settle}`);
    }
});
