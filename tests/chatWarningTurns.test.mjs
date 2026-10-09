// A kept warning about Credits is settled when the browser has no job id for its turn (ADR-0067 amendment 11).
// PR 764 kept the reply's job id with a warning and asked it when the chat was opened. It named two warnings it could
// not settle, and both kept the old behaviour: a warning that could stay long after its turn was in fact refunded.
//   1. Stop before `start`: no job id ever reached the browser. The send's own idempotency key is kept in its place.
//      The server is asked about that send by its key: it answers with the job the send made, or, when it made none,
//      closes the key so that no reply can ever be charged for it, and says so.
//   2. "No job for this key" is trusted only as that statement, `closed: true`. A failed read, a rate limit, a route
//      that is not open, or any other shape is no answer, and the warning stays.
//   3. One warning for several turns: it keeps every turn it stands for (four at most, then none) and goes only when
//      every one of them is settled. When they settled differently, the chat says what is true of all of them.
//   4. The given-back text: the box is emptied only while it still holds exactly a message that is now in the chat.
//   5. What is kept is checked by shape on write and on read: tests/chatLocalTurns.test.mjs.
// send() runs for real against the real store; the chat arrives on screen the way open() does it (chatWarning.harness.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NEW_CHAT, readCreditsWarning, readNotice, textMark, turnsOf, writeDraft, writeNotice } from '../app/veyrnox/_lib/chatLocal.js';
import { askKeptWarning, keptTurnVerdict, settleKeptWarning } from '../app/veyrnox/_lib/chatWarning.js';
import { A, ME, TEXT, afterReload, memory, run, stopped } from './chatSendFlow.harness.mjs';
import { JOB, JOBS, KEY, OTHER_JOB, OTHER_KEY, SENDS, answers, byId, cutAfter, cutAfterStart, leftBy, opened, stopBeforeStart, stopBeforeText, stoppedAfterText, stoppedBeforeText } from './chatWarning.harness.mjs';

const api = readFileSync(new URL('../app/veyrnox/_lib/chatApi.js', import.meta.url), 'utf8');
const MARK = textMark(TEXT);
const FIRST = 'What is a lighthouse for?';
const kept = (storage, chat = 'chat-a') => readCreditsWarning(storage, ME, chat);
/** Two sends from the same chat, neither settled when its look ended. Each `more` goes to run(): `key`, `text`. */
const twice = async (first, second, firstMore = {}, secondMore = {}) => leftBy(second, { storage: await leftBy(first, firstMore), ...secondMore });

// ---- 1. Stop before `start`: the send's own key ----

test('Stop before the reply started keeps the key the send went out with, and a mark of the text that was given back', async () => {
    const storage = await leftBy(stopBeforeStart, { key: KEY });
    assert.deepEqual(kept(storage), { code: 'stop_unsure', key: KEY, sent: MARK });
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: TEXT, notice: { code: 'stop_unsure' } }, 'the screen reads the same words as before');
    // Once `start` has come there is a job id, and that is what is kept: reading a job changes nothing on the server.
    assert.deepEqual(kept(await leftBy(stopBeforeText, { key: KEY })), { code: 'stop_unsure', job: JOB, sent: MARK });
    // A chat made for the message stays for a turn that is not settled, and holds the warning the same way.
    assert.deepEqual(kept(await leftBy(stopBeforeStart, { active: null, key: KEY }), 'made'), { code: 'stop_unsure', key: KEY, sent: MARK });
});

test('a turn with a job is read by its job id, and a turn with only a key is asked about by that key: never the other way round', async () => {
    const jobs = []; const sends = [];
    const getJob = async (id) => { jobs.push(id); return JOBS.refunded; };
    const closeSend = async (key) => { sends.push(key); return SENDS.closed; };
    const warning = { code: 'stop_unsure', turns: [{ job: JOB, sent: MARK }, { key: KEY, sent: MARK }] };
    assert.deepEqual(await askKeptWarning({ warning, getJob, closeSend }), { warning, verdicts: ['refunded', 'refunded'] });
    assert.deepEqual([jobs, sends], [[JOB], [KEY]]);
    // With nothing to ask a key by, a turn that has only a key cannot be settled: no answer, and nothing thrown.
    assert.equal(await askKeptWarning({ warning: { code: 'stop_unsure', key: KEY }, getJob }), null);
    assert.deepEqual(jobs, [JOB], 'the key was not read as a job');
});

// ---- 2. what the answer to a key says ----

test('"no reply was charged for this send" is taken only from the server saying it has closed the key', () => {
    assert.equal(keptTurnVerdict(SENDS.closed), 'refunded', 'no Credits were used, and none can be');
    // The send did make a job: the answer is that job, read as any job is.
    assert.equal(keptTurnVerdict(SENDS.saved), 'saved');
    assert.equal(keptTurnVerdict(SENDS.unsaved), 'unsaved');
    assert.equal(keptTurnVerdict(SENDS.refunded), 'refunded');
    for (const send of [SENDS.queued, SENDS.running, SENDS.failed]) assert.equal(keptTurnVerdict(send), null, send.state);
    // `closed` has to be the boolean the route sends, alone. Beside a job's state it is not an answer this knows.
    const odd = [{ closed: 'true' }, { closed: 1 }, { closed: 'yes' }, { closed: false }, { closed: null }, { closed: true, state: 'running' }, { closed: true, state: 'failed', refunded: true },
        { closed: true, state: 'succeeded' }, { closed: true, job_id: JOB }, { found: false }, { job: null }, { error: 'send_close_not_open' }, { error: 'not_found' }, { ok: true }];
    for (const answer of odd) assert.equal(keptTurnVerdict(answer), null, JSON.stringify(answer));
});

test('Stop before the reply started, and the send never reached the charge: opening the chat takes the warning away, and the text stays in the box', async () => {
    const storage = await leftBy(stopBeforeStart, { key: KEY });
    assert.deepEqual(await opened(storage, 'chat-a', answers(SENDS.closed)), { box: TEXT, notice: null, changed: true, calls: [KEY] });
    assert.equal(kept(storage), null);
    // And it is over: the next time the chat is opened nothing is asked.
    assert.deepEqual(await opened(storage, 'chat-a', answers(SENDS.closed)), { box: TEXT, notice: null, changed: false, calls: [] });
});

test('Stop before the reply started, and the send did make a job: its job settles the warning the way a kept job does', async () => {
    // Debited a moment after Stop, then failed and refunded: gone, and the message is still in the box.
    let storage = await leftBy(stopBeforeStart, { key: KEY });
    assert.deepEqual(await opened(storage, 'chat-a', answers(SENDS.refunded)), { box: TEXT, notice: null, changed: true, calls: [KEY] });
    // Saved late: the same message is in the chat, charged, and in the box. The unchanged text is taken out of the box.
    storage = await leftBy(stopBeforeStart, { key: KEY });
    assert.deepEqual(await opened(storage, 'chat-a', answers(SENDS.saved)), { box: '', notice: { code: 'stop_saved' }, changed: true, calls: [KEY] });
    assert.equal(kept(storage), null, 'what is kept now is not a warning: the chat shows the reply and its price');
    // Text the person has changed since is theirs.
    storage = await leftBy(stopBeforeStart, { key: KEY });
    writeDraft(storage, ME, 'chat-a', `${TEXT} And its keeper.`);
    assert.deepEqual(await opened(storage, 'chat-a', answers(SENDS.saved)), { box: `${TEXT} And its keeper.`, notice: { code: 'stop_saved' }, changed: true, calls: [KEY] });
    // Charged, and not in the chat: said, and never asked about again.
    storage = await leftBy(stopBeforeStart, { key: KEY });
    assert.deepEqual(await opened(storage, 'chat-a', answers(SENDS.unsaved)), { box: TEXT, notice: { code: 'reply_not_saved' }, changed: true, calls: [KEY] });
    assert.deepEqual(await opened(storage, 'chat-a', answers(SENDS.closed)), { box: TEXT, notice: { code: 'reply_not_saved' }, changed: false, calls: [] });
});

test('the warning is never removed while nothing final can be said about the send', async () => {
    const refusal = (status, code) => async () => { throw Object.assign(new Error(code), { status, code }); };
    const cases = [['its job is still queued', answers(SENDS.queued)], ['its job is still running', answers(SENDS.running)], ['its job failed, the refund not yet in', answers(SENDS.failed)],
        ['the request failed', async () => { throw new Error('offline'); }], ['rate limited', refusal(429, 'rate_limited')], ['the route is not open', refusal(503, 'send_close_not_open')],
        ['the database gave no answer', refusal(502, 'internal')], ['too many sends closed', refusal(429, 'close_limit')], ['an empty answer', answers({})], ['no answer', answers(null)],
        ['"closed" in a shape the route does not send', answers({ closed: 'true' })], ['only "no job was found"', answers({ found: false })]];
    for (const [name, answer] of cases) {
        const storage = await leftBy(stopBeforeStart, { key: KEY });
        const before = { ...afterReload(storage, 'chat-a'), warning: kept(storage) };
        const after = await opened(storage, 'chat-a', answer);
        assert.equal(after.changed, false, name);
        assert.deepEqual({ box: after.box, notice: after.notice, warning: kept(storage) }, before, name);
        // It is asked again the next time the chat is opened, and goes when the answer comes.
        assert.equal((await opened(storage, 'chat-a', answers(SENDS.closed))).notice, null, name);
    }
    // An answer that hangs is cut off by the same limit as a job read, and is no answer.
    const storage = await leftBy(stopBeforeStart, { key: KEY });
    const asked = await askKeptWarning({ warning: kept(storage), getJob: answers(JOBS.refunded), closeSend: () => new Promise(() => {}), limitMs: 30 });
    assert.equal(asked, null);
    assert.equal(settleKeptWarning(storage, ME, 'chat-a', asked), false);
});

// ---- 3. one warning, several turns ----
// A chat keeps one warning. An ending that keeps a warning of its own takes the place of the one kept before it (#736).
// PR 764's independent review found that settling the second's job then removed the only notice while the first turn
// could still be saved and charged, with its text in the box, and PR 764 kept no job with such a warning.

test('a warning that takes the place of another keeps every turn it now stands for', async () => {
    // Stop before any text twice, neither settled.
    assert.deepEqual(kept(await twice(stopBeforeText, stoppedBeforeText(OTHER_JOB))), { code: 'stop_unsure', turns: [{ job: JOB, sent: MARK }, { job: OTHER_JOB, sent: MARK }] });
    // The first Stop came before `start`, the second after it: a key, then a job.
    assert.deepEqual(kept(await twice(stopBeforeStart, stoppedBeforeText(OTHER_JOB), { key: KEY })), { code: 'stop_unsure', turns: [{ key: KEY, sent: MARK }, { job: OTHER_JOB, sent: MARK }] });
    // Both before `start`.
    assert.deepEqual(kept(await twice(stopBeforeStart, stopBeforeStart, { key: KEY }, { key: OTHER_KEY })), { code: 'stop_unsure', turns: [{ key: KEY, sent: MARK }, { key: OTHER_KEY, sent: MARK }] });
    // The second ended some other way that is not settled. Each turn keeps the mark of its own text, or none: only a
    // message that was given back has one.
    let storage = await twice(stopBeforeText, stoppedAfterText(OTHER_JOB));
    assert.deepEqual(kept(storage), { code: 'stop_saving', turns: [{ job: JOB, sent: MARK }, { job: OTHER_JOB }] });
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: '', notice: { code: 'stop_saving' } });
    assert.deepEqual(kept(await twice(stopBeforeText, cutAfter(OTHER_JOB))), { code: 'connection_lost', turns: [{ job: JOB, sent: MARK }, { job: OTHER_JOB }] });
    assert.deepEqual(kept(await twice(cutAfterStart, stoppedBeforeText(OTHER_JOB))), { code: 'stop_unsure', turns: [{ job: JOB }, { job: OTHER_JOB, sent: MARK }] });
    // A second message with other words: each mark is of its own message.
    storage = await twice(stopBeforeText, stoppedBeforeText(OTHER_JOB), { text: FIRST });
    assert.deepEqual(kept(storage), { code: 'stop_unsure', turns: [{ job: JOB, sent: textMark(FIRST) }, { job: OTHER_JOB, sent: MARK }] });
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: TEXT, notice: { code: 'stop_unsure' } }, 'the box holds the message that was given back last');
});

test('a warning for two turns goes only when both are settled: one answer, a failed read or a turn still running changes nothing', async () => {
    const waiting = [['the first is still running', { [JOB]: JOBS.running, [OTHER_JOB]: JOBS.refunded }], ['the second is still running', { [JOB]: JOBS.refunded, [OTHER_JOB]: JOBS.running }],
        ['the first was saved and the second is still running', { [JOB]: JOBS.saved, [OTHER_JOB]: JOBS.running }], ['the second was charged and not stored, the first has its refund on the way', { [JOB]: JOBS.failed, [OTHER_JOB]: JOBS.unsaved }],
        ['the first cannot be read', { [OTHER_JOB]: JOBS.refunded }], ['neither can be read', {}]];
    for (const [name, map] of waiting) {
        const storage = await twice(stopBeforeText, stoppedBeforeText(OTHER_JOB));
        const before = { ...afterReload(storage, 'chat-a'), warning: kept(storage) };
        const after = await opened(storage, 'chat-a', byId(map));
        assert.deepEqual([after.changed, after.calls], [false, [JOB, OTHER_JOB]], `${name}: both are asked, every time`);
        assert.deepEqual({ box: after.box, notice: after.notice, warning: kept(storage) }, before, name);
        // Asked again the next time, and gone once both have an answer.
        assert.deepEqual(await opened(storage, 'chat-a', answers(JOBS.refunded)), { box: TEXT, notice: null, changed: true, calls: [JOB, OTHER_JOB] }, name);
        assert.equal(kept(storage), null);
    }
    // A key and a job: the same. The send that never started is closed, the one that did was refunded.
    const storage = await twice(stopBeforeStart, stoppedBeforeText(OTHER_JOB), { key: KEY });
    assert.equal((await opened(storage, 'chat-a', byId({ [KEY]: SENDS.closed, [OTHER_JOB]: JOBS.running }))).changed, false);
    assert.equal((await opened(storage, 'chat-a', byId({ [KEY]: SENDS.running, [OTHER_JOB]: JOBS.refunded }))).changed, false);
    assert.deepEqual(await opened(storage, 'chat-a', byId({ [KEY]: SENDS.closed, [OTHER_JOB]: JOBS.refunded })), { box: TEXT, notice: null, changed: true, calls: [KEY, OTHER_JOB] });
});

test('two turns that settled differently: the chat says what is true of both, and the box is emptied only of a message that is now in the chat', async () => {
    const words = /case 'turns_settled': return (['"])(.+?)\1;/.exec(api);
    assert.ok(words, 'chatErrorCopy has words for turns_settled');
    // True whichever of them were saved: a saved reply is in the chat with its price, and one that is not there cost nothing.
    assert.equal(words[2], 'Some messages here ended before we knew if they were saved. Each reply that was saved now shows in this chat with its price. A message that does not show here used no Credits.');
    const both = () => twice(stopBeforeText, stoppedBeforeText(OTHER_JOB), { text: FIRST });
    // The first was saved and the second refunded. The box holds the second message, which is in no chat: it stays.
    // "You do not need to send that message again" would be read as being about it, so those words are not used.
    let storage = await both();
    assert.deepEqual(await opened(storage, 'chat-a', byId({ [JOB]: JOBS.saved, [OTHER_JOB]: JOBS.refunded })), { box: TEXT, notice: { code: 'turns_settled' }, changed: true, calls: [JOB, OTHER_JOB] });
    assert.equal(kept(storage), null, 'not a warning: every charge is in the chat with its price');
    assert.deepEqual(await opened(storage, 'chat-a', answers(JOBS.saved)), { box: TEXT, notice: { code: 'turns_settled' }, changed: false, calls: [] }, 'said until the next message is sent, and not asked again');
    // The second was saved and the first refunded. The box holds exactly the saved message: it is taken out.
    storage = await both();
    assert.deepEqual(await opened(storage, 'chat-a', byId({ [JOB]: JOBS.refunded, [OTHER_JOB]: JOBS.saved })), { box: '', notice: { code: 'turns_settled' }, changed: true, calls: [JOB, OTHER_JOB] });
    // Both were saved: the same.
    storage = await both();
    assert.deepEqual(await opened(storage, 'chat-a', answers(JOBS.saved)), { box: '', notice: { code: 'turns_settled' }, changed: true, calls: [JOB, OTHER_JOB] });
    // The same words sent twice, the first saved and the second refunded: the box holds a message that is in the chat.
    storage = await twice(stopBeforeText, stoppedBeforeText(OTHER_JOB));
    assert.deepEqual(await opened(storage, 'chat-a', byId({ [JOB]: JOBS.saved, [OTHER_JOB]: JOBS.refunded })), { box: '', notice: { code: 'turns_settled' }, changed: true, calls: [JOB, OTHER_JOB] });
    // Text the person has changed since is theirs, whatever was saved.
    storage = await both();
    writeDraft(storage, ME, 'chat-a', `${TEXT} And its keeper.`);
    assert.deepEqual(await opened(storage, 'chat-a', answers(JOBS.saved)), { box: `${TEXT} And its keeper.`, notice: { code: 'turns_settled' }, changed: true, calls: [JOB, OTHER_JOB] });
});

test('one of several turns was charged and could not be stored: that is what the chat says, whatever the others did', async () => {
    const both = () => twice(stopBeforeText, stoppedBeforeText(OTHER_JOB), { text: FIRST });
    // With a refund: the charge that the chat does not show is the thing to say. The box is in no chat, so it stays.
    for (const map of [{ [JOB]: JOBS.unsaved, [OTHER_JOB]: JOBS.refunded }, { [JOB]: JOBS.refunded, [OTHER_JOB]: JOBS.unsaved }, { [JOB]: JOBS.unsaved, [OTHER_JOB]: JOBS.unsaved }]) {
        const storage = await both();
        assert.deepEqual(await opened(storage, 'chat-a', byId(map)), { box: TEXT, notice: { code: 'reply_not_saved' }, changed: true, calls: [JOB, OTHER_JOB] }, JSON.stringify(map));
        // Still a warning about Credits, with nothing to ask: it stays until a later message is saved, as it always has.
        assert.deepEqual(kept(storage), { code: 'reply_not_saved' });
        assert.deepEqual(await opened(storage, 'chat-a', answers(JOBS.refunded)), { box: TEXT, notice: { code: 'reply_not_saved' }, changed: false, calls: [] });
    }
    // With one that was saved: the same notice (one is kept per chat, and this is the charge the chat does not show).
    // The saved message is taken out of the box all the same, so it is not one press from being paid for twice.
    let storage = await both();
    assert.deepEqual(await opened(storage, 'chat-a', byId({ [JOB]: JOBS.unsaved, [OTHER_JOB]: JOBS.saved })), { box: '', notice: { code: 'reply_not_saved' }, changed: true, calls: [JOB, OTHER_JOB] });
    storage = await both();
    assert.deepEqual(await opened(storage, 'chat-a', byId({ [JOB]: JOBS.saved, [OTHER_JOB]: JOBS.unsaved })), { box: TEXT, notice: { code: 'reply_not_saved' }, changed: true, calls: [JOB, OTHER_JOB] });
});

test('a saved turn that never gave its text back says nothing, as it does alone: the chat shows what was kept and its price', async () => {
    // Stop after text (still being saved), then Stop before any text. The first was saved, the second refunded.
    let storage = await twice(stoppedAfterText(JOB), stoppedBeforeText(OTHER_JOB));
    assert.deepEqual(kept(storage), { code: 'stop_unsure', turns: [{ job: JOB }, { job: OTHER_JOB, sent: MARK }] });
    assert.deepEqual(await opened(storage, 'chat-a', byId({ [JOB]: JOBS.saved, [OTHER_JOB]: JOBS.refunded })), { box: TEXT, notice: null, changed: true, calls: [JOB, OTHER_JOB] });
    // The other way round: the message that was given back is the one that was saved.
    storage = await twice(stoppedAfterText(JOB), stoppedBeforeText(OTHER_JOB));
    assert.deepEqual(await opened(storage, 'chat-a', byId({ [JOB]: JOBS.refunded, [OTHER_JOB]: JOBS.saved })), { box: '', notice: { code: 'turns_settled' }, changed: true, calls: [JOB, OTHER_JOB] });
    // Neither gave its text back (a dropped connection, then Stop after text): both saved, nothing said, the box left alone.
    storage = await twice(cutAfterStart, stoppedAfterText(OTHER_JOB));
    writeDraft(storage, ME, 'chat-a', TEXT);
    assert.deepEqual(await opened(storage, 'chat-a', answers(JOBS.saved)), { box: TEXT, notice: null, changed: true, calls: [JOB, OTHER_JOB] });
});

test('past four turns a warning keeps none, so it is never asked about and stays until a later message is saved', async () => {
    const ids = ['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000006'];
    const storage = memory();
    for (const [i, job] of ids.entries()) {
        await run({ active: A, turn: stoppedBeforeText(job), settle: 'pending', storage });
        assert.deepEqual(turnsOf(kept(storage)).map((t) => t.job), i < 4 ? ids.slice(0, i + 1) : [], `after ${i + 1}`);
    }
    for (const job of Object.values(JOBS)) assert.deepEqual(await opened(storage, 'chat-a', answers(job)), { box: TEXT, notice: { code: 'stop_unsure' }, changed: false, calls: [] });
    // Four are all asked about, and settle together.
    const four = memory();
    for (const job of ids.slice(0, 4)) await run({ active: A, turn: stoppedBeforeText(job), settle: 'pending', storage: four });
    assert.deepEqual(await opened(four, 'chat-a', answers(JOBS.refunded)), { box: TEXT, notice: null, changed: true, calls: ids.slice(0, 4) });
});

test('a warning that takes the place of one with nothing to ask has nothing to ask either: it stands for a turn it cannot list', async () => {
    const never = async (storage, code, box) => {
        assert.deepEqual(kept(storage), { code });
        for (const job of Object.values(JOBS)) assert.deepEqual(await opened(storage, 'chat-a', answers(job)), { box, notice: { code }, changed: false, calls: [] }, `${code} ${job.state}`);
    };
    // The first Stop came before `start` and its key is not one the browser makes (this harness's default).
    await never(await twice(stopBeforeStart, stoppedBeforeText(OTHER_JOB)), 'stop_unsure', TEXT);
    // The first was charged and could not be stored: settled, and a warning all the same. The next takes its place.
    await never(await twice(stoppedAfterText(JOB), stoppedBeforeText(OTHER_JOB), { settle: 'unsaved' }), 'stop_unsure', TEXT);
    // A warning kept by the screen before turns were listed (PR 764): one that took the place of another, with no job.
    const storage = memory(); writeDraft(storage, ME, 'chat-a', TEXT);
    writeNotice(storage, ME, 'chat-a', 'stop_unsure');
    await run({ active: A, turn: stoppedAfterText(OTHER_JOB), settle: 'pending', storage });
    await never(storage, 'stop_saving', '');
});

test('the earlier warning waited under New chat, and the next message made a chat: the warning kept for that chat holds both turns', async () => {
    // The first message's chat was deleted while its reply was on its way, so its warning is under New chat. The next
    // message is sent from New chat, a chat is made for it, and it is stopped the same way: that chat stays for its
    // turn, and its warning takes the place of the one under New chat.
    const storage = memory();
    await run({ active: A, turn: async (args, person) => { args.onEvent('start', { job_id: JOB }); person.deletes('chat-a'); throw stopped(); }, settle: 'pending', storage });
    assert.deepEqual(kept(storage, NEW_CHAT), { code: 'stop_unsure', job: JOB, sent: MARK });
    await run({ active: null, turn: stoppedBeforeText(OTHER_JOB), settle: 'pending', storage });
    assert.equal(readNotice(storage, ME, NEW_CHAT), null, 'forgotten there: the message went out from New chat');
    assert.deepEqual(kept(storage, 'made'), { code: 'stop_unsure', turns: [{ job: JOB, sent: MARK }, { job: OTHER_JOB, sent: MARK }] });
    assert.equal((await opened(storage, 'made', byId({ [JOB]: JOBS.running, [OTHER_JOB]: JOBS.refunded }))).changed, false);
    assert.deepEqual(await opened(storage, 'made', answers(JOBS.refunded)), { box: TEXT, notice: null, changed: true, calls: [JOB, OTHER_JOB] });
});

test('two messages whose chats were deleted leave one warning under New chat for both, and it is settled for both', async () => {
    // Each chat was deleted while its reply was on its way: each warning lands under New chat (chatSendHome.js), the
    // second over the first. PR 764 kept the second's job there, alone.
    const B = { id: 'chat-b', model_id: 'm' };
    const left = async () => {
        const storage = memory();
        await run({ active: A, turn: async (args, person) => { args.onEvent('start', { job_id: JOB }); person.deletes('chat-a'); throw stopped(); }, settle: 'pending', storage });
        await run({ active: B, turn: async (args, person) => { args.onEvent('start', { job_id: OTHER_JOB }); person.deletes('chat-b'); throw stopped(); }, settle: 'pending', storage });
        return storage;
    };
    let storage = await left();
    assert.deepEqual(turnsOf(kept(storage, NEW_CHAT)).map((t) => t.job), [JOB, OTHER_JOB]);
    assert.equal((await opened(storage, NEW_CHAT, byId({ [JOB]: JOBS.running, [OTHER_JOB]: JOBS.refunded }))).changed, false);
    assert.equal((await opened(storage, NEW_CHAT, answers(JOBS.refunded))).notice, null);
    // Charged and not stored: said. Saved: New chat has no chat to show the reply, so the warning stays, and it is not asked about again.
    storage = await left();
    assert.deepEqual((await opened(storage, NEW_CHAT, byId({ [JOB]: JOBS.refunded, [OTHER_JOB]: JOBS.unsaved }))).notice, { code: 'reply_not_saved' });
    // Under New chat the box is never emptied, whatever was saved: there is no chat on screen that shows the message.
    storage = await left();
    writeDraft(storage, ME, NEW_CHAT, TEXT);
    assert.deepEqual(await opened(storage, NEW_CHAT, byId({ [JOB]: JOBS.saved, [OTHER_JOB]: JOBS.unsaved })), { box: TEXT, notice: { code: 'reply_not_saved' }, changed: true, calls: [JOB, OTHER_JOB] });
    storage = await left();
    const before = readNotice(storage, ME, NEW_CHAT);
    const after = await opened(storage, NEW_CHAT, byId({ [JOB]: JOBS.saved, [OTHER_JOB]: JOBS.refunded }));
    assert.deepEqual([after.notice, after.changed], [before, true]);
    assert.deepEqual(kept(storage, NEW_CHAT), { code: before.code });
    assert.deepEqual((await opened(storage, NEW_CHAT, answers(JOBS.saved))).calls, []);
});

test('answers for the turns that were read are not acted on once the warning stands for another turn as well', async () => {
    const storage = await twice(stopBeforeText, stoppedBeforeText(OTHER_JOB));
    const asked = await askKeptWarning({ warning: kept(storage), getJob: answers(JOBS.refunded), closeSend: answers(SENDS.closed) });
    assert.deepEqual(asked.verdicts, ['refunded', 'refunded']);
    // A third message ended the same way while those two were being read.
    await run({ active: A, turn: stopBeforeStart, settle: 'pending', storage, key: KEY });
    assert.equal(turnsOf(kept(storage)).length, 3);
    assert.equal(settleKeptWarning(storage, ME, 'chat-a', asked), false);
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: TEXT, notice: { code: 'stop_unsure' } });
    // The same number of turns, but not the same ones, or not the same text: not the warning that was read.
    for (const turns of [[{ job: JOB, sent: MARK }, { job: 'aaaaaaaa-0000-4000-8000-000000000009', sent: MARK }], [{ job: OTHER_JOB, sent: MARK }, { job: JOB, sent: MARK }], [{ job: JOB }, { job: OTHER_JOB, sent: MARK }]]) {
        assert.equal(settleKeptWarning(storage, ME, 'chat-a', { warning: { code: 'stop_unsure', turns }, verdicts: ['refunded', 'refunded'] }), false, JSON.stringify(turns));
    }
    // The same for sends kept by their keys: an answer about one key says nothing of a warning kept with another.
    const early = await leftBy(stopBeforeStart, { key: KEY });
    assert.equal(settleKeptWarning(early, ME, 'chat-a', { warning: { code: 'stop_unsure', key: OTHER_KEY, sent: MARK }, verdicts: ['refunded'] }), false);
    assert.deepEqual(kept(early), { code: 'stop_unsure', key: KEY, sent: MARK });
    const both = await twice(stopBeforeStart, stopBeforeStart, { key: KEY }, { key: OTHER_KEY });
    for (const turns of [[{ key: KEY, sent: MARK }, { key: 'vx-aaaaaaaa-0000-4000-8000-000000000009', sent: MARK }], [{ key: OTHER_KEY, sent: MARK }, { key: KEY, sent: MARK }], [{ job: JOB, sent: MARK }, { key: OTHER_KEY, sent: MARK }]]) {
        assert.equal(settleKeptWarning(both, ME, 'chat-a', { warning: { code: 'stop_unsure', turns }, verdicts: ['refunded', 'refunded'] }), false, JSON.stringify(turns));
    }
    assert.equal(turnsOf(kept(both)).length, 2);
});

test('a browser that cannot make a key: the message ends like any that never started, with its text back', async () => {
    // The key is made inside the guarded part of send(), as it was when it was made in the call itself. Outside it, a
    // throw left the box empty and the composer busy until the page was reloaded.
    const storage = memory();
    const sent = [];
    const { log } = await run({ active: A, turn: async (args) => { sent.push(args); return { replay: false }; }, storage, key: () => { throw new TypeError('crypto.randomUUID is not a function'); } });
    assert.deepEqual(sent, [], 'nothing went out');
    assert.deepEqual(log.box, ['', TEXT], 'emptied at the press, and given back');
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: TEXT, notice: { code: 'unknown' } }, 'said, as any failure before the reply starts is');
    assert.equal(kept(storage), null, 'nothing was charged, so nothing warns of Credits');
});
