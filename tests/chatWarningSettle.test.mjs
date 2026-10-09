// A kept warning about Credits is taken away when the server says the turn it warns about has settled (ADR-0067).
// PR 736 kept such a warning through a later message that starts and is refunded, and named this as the proper fix
// for the other half: nothing kept with the warning let the screen ask the server about its turn, so it was forgotten
// only by a later message from that chat being saved or keeping a warning of its own, by the chat being deleted, or by
// the session ending. After Stop before any text with the turn not settled, a turn that was refunded seconds later
// left "If a reply is still saved, it will show in this chat and use Credits" beside the given-back text for good.
// Now the job id that came with `start` is kept with the warning (chatLocal.js), and when the chat is opened, a page
// reload included, its job is read before the chat is (chatWarning.js). Five choices, each tested below:
//   1. kept with the warning: the job id, and for `stop_unsure` a mark of the text that was given back
//   2. what each answer does; a failed or ambiguous read never removes a warning
//   3. a turn that was saved after all: the given-back text is taken out of the box when it is still exactly the message
//   4. Stop before `start` has no job: nothing here removes that warning
//   5. `stop_saving` and `connection_lost` are settled the same way; `reply_not_saved` is never asked about
// And one rule the independent review of the first commit found missing: a chat keeps one warning, so a warning that
// takes the place of another stands for two turns, and one job cannot answer for both. It keeps no job.
// send() runs for real against the real store (tests/chatSendFlow.harness.mjs); the screen's open() is pinned by pattern.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NEW_CHAT, readCreditsWarning, readDraft, readNotice, textMark, writeDraft, writeNotice } from '../app/veyrnox/_lib/chatLocal.js';
import { KEPT_READ_LIMIT_MS, askKeptWarning, keptTurnVerdict, settleKeptWarning } from '../app/veyrnox/_lib/chatWarning.js';
import { A, ME, TEXT, afterReload, memory, run, stopped } from './chatSendFlow.harness.mjs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const screen = read('../app/veyrnox/_components/chat/ChatWorkspace.js');
const sender = read('../app/veyrnox/_components/chat/useChatSend.js');
const settler = read('../app/veyrnox/_lib/chatWarning.js');
const api = read('../app/veyrnox/_lib/chatApi.js');

const JOB = '6f1d2c3a-0b4e-4c5d-8e9f-a1b2c3d4e5f6';
const OTHER_JOB = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
/** GET /api/v1/jobs/:id, as the route answers for a chat reply. */
const JOBS = {
    queued: { state: 'queued', refunded: false, credits: 2 },
    running: { state: 'running', refunded: false, credits: 2 },
    failed: { state: 'failed', refunded: false, credits: 2, error_code: 'user_canceled' }, // the refund is a second step
    refunded: { state: 'failed', refunded: true, credits: 2, error_code: 'user_canceled' },
    saved: { state: 'succeeded', refunded: false, credits: 2 },
    unsaved: { state: 'succeeded', refunded: false, credits: 2, error_code: 'reply_not_saved' },
};
const answers = (job) => async () => job;

/** Server scripts for send(). The job id is one the server could have made: anything else is not kept (chatLocal.js). */
const stoppedBeforeText = (job) => async ({ onEvent }) => { onEvent('start', { job_id: job }); throw stopped(); };
const stoppedAfterText = (job) => async ({ onEvent }) => { onEvent('start', { job_id: job }); onEvent('delta', { text: 'A lamp' }); throw stopped(); };
const cutAfter = (job) => async ({ onEvent }) => { onEvent('start', { job_id: job }); throw new TypeError('network error'); };
const stopBeforeText = stoppedBeforeText(JOB);
const stopBeforeStart = async () => { throw stopped(); };
const stopAfterText = stoppedAfterText(JOB);
const cutAfterStart = cutAfter(JOB);

/** A chat left by a send whose turn was not settled when the look for it ended. */
async function leftBy(turn, { active = A, settle = 'pending' } = {}) {
    const storage = memory();
    await run({ active, turn, settle, storage });
    return storage;
}
/**
 * The chat arrives on screen, the way open() does it: the job of its kept warning is read, then the chat, then the
 * store is settled, and the screen reads the box and the notice from the store.
 */
async function opened(storage, chat, getJob) {
    const calls = [];
    const asked = await askKeptWarning({ warning: readCreditsWarning(storage, ME, chat), getJob: (id) => { calls.push(id); return getJob(id); } });
    const changed = settleKeptWarning(storage, ME, chat, asked);
    return { ...afterReload(storage, chat), changed, calls };
}

// ---- 2. what a job says ----

test('a job settles a turn only when it succeeded, or failed with the refund landed', () => {
    assert.equal(keptTurnVerdict(JOBS.saved), 'saved');
    assert.equal(keptTurnVerdict(JOBS.unsaved), 'unsaved', 'charged, and not in the chat');
    assert.equal(keptTurnVerdict(JOBS.refunded), 'refunded');
    // Not settled: still going, or failed with the Credits not yet back (the refund is a second step and can be in flight).
    for (const job of [JOBS.queued, JOBS.running, JOBS.failed]) assert.equal(keptTurnVerdict(job), null, job.state);
    // Anything this does not know is no answer. `refunded` has to be the boolean the route sends.
    const odd = [undefined, null, '', 'succeeded', 42, [], {}, { state: 'done' }, { state: 'SUCCEEDED' }, { state: null, refunded: true }, { refunded: true },
        { state: 'failed', refunded: 'true' }, { state: 'failed', refunded: 1 }, { state: 'failed' }, { state: 'refunded', refunded: true }, { error: 'not_found' }];
    for (const job of odd) assert.equal(keptTurnVerdict(job), null, JSON.stringify(job));
});

test('the job is asked by the id kept with the warning, once, and nothing is asked when there is none', async () => {
    const calls = [];
    const getJob = async (id) => { calls.push(id); return JOBS.refunded; };
    const warning = { code: 'stop_unsure', job: JOB, sent: textMark(TEXT) };
    assert.deepEqual(await askKeptWarning({ warning, getJob }), { warning, verdict: 'refunded' });
    assert.deepEqual(calls, [JOB]);
    // No warning kept, or one with no job (Stop before `start`, or `reply_not_saved`): no request is made.
    for (const none of [null, undefined, { code: 'stop_unsure' }, { code: 'reply_not_saved' }, { code: 'stop_unsure', job: '' }]) {
        assert.equal(await askKeptWarning({ warning: none, getJob }), null, JSON.stringify(none));
    }
    assert.deepEqual(calls, [JOB], 'still the one request');
});

test('a read that fails, hangs or says the turn is not settled is no answer', async () => {
    const warning = { code: 'connection_lost', job: JOB };
    const failing = [new Error('offline'), Object.assign(new Error('rate_limited'), { status: 429, code: 'rate_limited' }),
        Object.assign(new Error('not_found'), { status: 404, code: 'not_found' }), Object.assign(new Error('internal'), { status: 502 })];
    for (const error of failing) assert.equal(await askKeptWarning({ warning, getJob: async () => { throw error; } }), null, error.message);
    assert.equal(await askKeptWarning({ warning, getJob: () => { throw new Error('thrown before any promise'); } }), null);
    for (const job of [JOBS.queued, JOBS.running, JOBS.failed, null, {}]) assert.equal(await askKeptWarning({ warning, getJob: answers(job) }), null, JSON.stringify(job));
    // The read runs before the chat is read, and has no time limit of its own: opening a chat must not hang on it.
    const began = Date.now();
    const hung = new Promise((resolve) => { setTimeout(() => resolve('still waiting'), 1500).unref(); });
    assert.equal(await Promise.race([askKeptWarning({ warning, getJob: () => new Promise(() => {}), limitMs: 30 }), hung]), null, 'the limit answers a read that never does');
    assert.ok(Date.now() - began < 1000, 'the limit answered');
    // An answer that arrives after the limit is too late: what was decided stands.
    const late = new Promise((resolve) => { setTimeout(() => resolve(JOBS.refunded), 60); });
    assert.equal(await askKeptWarning({ warning, getJob: () => late, limitMs: 20 }), null);
    assert.equal(KEPT_READ_LIMIT_MS, 2000);
    // The limit's timer is cleared whichever side answers, so nothing is left running after a chat has opened.
    assert.match(settler, /\n {2}\} finally \{\n {4}clearTimeout\(timer\);\n {2}\}\n/);
});

// ---- 1. what the send keeps with the warning ----

test('send() keeps the job with each warning about a turn that had started, and nothing with one that had not', async () => {
    // Stop after `start` and before the first words, the turn not settled: the text is back, with the job and a mark of that text.
    let storage = await leftBy(stopBeforeText);
    assert.deepEqual(readCreditsWarning(storage, ME, 'chat-a'), { code: 'stop_unsure', job: JOB, sent: textMark(TEXT) });
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: TEXT, notice: { code: 'stop_unsure' } }, 'the screen reads the same words as before');
    // 4. Stop before `start`: no job id ever reached the browser.
    storage = await leftBy(stopBeforeStart);
    assert.deepEqual(readCreditsWarning(storage, ME, 'chat-a'), { code: 'stop_unsure' });
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: TEXT, notice: { code: 'stop_unsure' } });
    // 5. The other two always follow `start`. Neither gives the text back, so neither keeps a mark.
    storage = await leftBy(stopAfterText);
    assert.deepEqual(readCreditsWarning(storage, ME, 'chat-a'), { code: 'stop_saving', job: JOB });
    storage = await leftBy(cutAfterStart);
    assert.deepEqual(readCreditsWarning(storage, ME, 'chat-a'), { code: 'connection_lost', job: JOB });
    // Charged and not stored is settled: there is nothing to ask, so no job is kept.
    storage = await leftBy(stopAfterText, { settle: 'unsaved' });
    assert.deepEqual(readCreditsWarning(storage, ME, 'chat-a'), { code: 'reply_not_saved' });
    // A chat made for the message stays when its turn is not settled, and holds the warning the same way.
    storage = await leftBy(stopBeforeText, { active: null });
    assert.deepEqual(readCreditsWarning(storage, ME, 'made'), { code: 'stop_unsure', job: JOB, sent: textMark(TEXT) });
    // The job is handed to tell() for every notice (the store keeps it only beside the three): one place, not three call sites.
    // No job when this notice takes the place of a warning that is still kept (`over`, tested below).
    assert.match(sender, /\n {4}const tell = \(code, extra\) => \{ const over = !!heldWarning\(from\); forgetEarlier\(\); const \{ home, here \} = at\(\); keepNotice\(home, code, \{ \.\.\.extra, job: over \? null : jobId, sent: content \}\); if \(here\) setError\(chatErrorCopy\(code, extra\)\); \};\n/);
});

// ---- one warning, two turns ----
// Found by the independent review of the first commit. A chat keeps one warning. An ending that keeps a warning of its
// own takes the place of the one kept before it (#736), and kept its own job. Settling that job then removed the only
// notice, while the turn of the warning it had replaced could still be saved and charged, with its text in the box.

test('a warning that takes the place of another warning keeps no job, so it is never asked about and stays as it did before jobs were kept', async () => {
    const twice = async (first, second) => { const storage = await leftBy(first); await run({ active: A, turn: second, settle: 'pending', storage }); return storage; };
    const never = async (storage, code, box) => {
        assert.deepEqual(readCreditsWarning(storage, ME, 'chat-a'), { code }, 'no job and no mark');
        for (const job of Object.values(JOBS)) assert.deepEqual(await opened(storage, 'chat-a', answers(job)), { box, notice: { code }, changed: false, calls: [] }, `${code} ${job.state}`);
    };
    // Stop before any text twice, neither settled. The second job may be refunded while the first is still running.
    await never(await twice(stopBeforeText, stoppedBeforeText(OTHER_JOB)), 'stop_unsure', TEXT);
    // The first Stop came before `start` (no job to ask), the second after it: the second's job says nothing of the first.
    await never(await twice(stopBeforeStart, stoppedBeforeText(OTHER_JOB)), 'stop_unsure', TEXT);
    // The second ended some other way that is not settled: still saving after Stop, or a dropped connection.
    await never(await twice(stopBeforeText, stoppedAfterText(OTHER_JOB)), 'stop_saving', '');
    await never(await twice(stopBeforeText, cutAfter(OTHER_JOB)), 'connection_lost', '');
    await never(await twice(cutAfterStart, stoppedBeforeText(OTHER_JOB)), 'stop_unsure', TEXT);
    // A chain: the third takes the place of one that had no job, and has none either.
    const storage = await twice(stopBeforeText, stoppedBeforeText(OTHER_JOB));
    await run({ active: A, turn: stoppedBeforeText(JOB), settle: 'pending', storage });
    await never(storage, 'stop_unsure', TEXT);
});

test('the earlier warning waited under New chat, and the next message made a chat: the warning kept for that chat has no job', async () => {
    // The first message's chat was deleted while its reply was on its way, so its warning is under New chat. The next
    // message is sent from New chat, a chat is made for it, and it is stopped the same way: that chat stays for its
    // turn, and its warning takes the place of the one under New chat.
    const storage = memory();
    await run({ active: A, turn: async (args, person) => { args.onEvent('start', { job_id: JOB }); person.deletes('chat-a'); throw stopped(); }, settle: 'pending', storage });
    assert.deepEqual(readCreditsWarning(storage, ME, NEW_CHAT), { code: 'stop_unsure', job: JOB, sent: textMark(TEXT) });
    await run({ active: null, turn: stoppedBeforeText(OTHER_JOB), settle: 'pending', storage });
    assert.equal(readNotice(storage, ME, NEW_CHAT), null, 'forgotten there: the message went out from New chat');
    assert.deepEqual(readCreditsWarning(storage, ME, 'made'), { code: 'stop_unsure' });
    assert.deepEqual(await opened(storage, 'made', answers(JOBS.refunded)), { box: TEXT, notice: { code: 'stop_unsure' }, changed: false, calls: [] });
});

test('a warning keeps its job when nothing unsettled is kept before it', async () => {
    // The earlier warning was settled when its chat was opened: the next one stands for one turn again.
    let storage = await leftBy(stopBeforeText);
    assert.equal((await opened(storage, 'chat-a', answers(JOBS.refunded))).notice, null);
    await run({ active: A, turn: stoppedBeforeText(OTHER_JOB), settle: 'pending', storage });
    assert.deepEqual(readCreditsWarning(storage, ME, 'chat-a'), { code: 'stop_unsure', job: OTHER_JOB, sent: textMark(TEXT) });
    // A notice that is not a warning was kept before it (a refusal): it says nothing about Credits that could still move.
    storage = memory(); writeNotice(storage, ME, 'chat-a', 'insufficient_balance', { credits: 2 });
    await run({ active: A, turn: stopBeforeText, settle: 'pending', storage });
    assert.deepEqual(readCreditsWarning(storage, ME, 'chat-a'), { code: 'stop_unsure', job: JOB, sent: textMark(TEXT) });
    // A later message that used no Credits leaves the earlier warning kept, with its own job (#736): one turn, one job.
    storage = await leftBy(stopBeforeText);
    await run({ active: A, turn: stoppedBeforeText(OTHER_JOB), settle: 'nothing', storage });
    assert.deepEqual(readCreditsWarning(storage, ME, 'chat-a'), { code: 'stop_unsure', job: JOB, sent: textMark(TEXT) });
    assert.deepEqual(await opened(storage, 'chat-a', answers(JOBS.refunded)), { box: TEXT, notice: null, changed: true, calls: [JOB] });
    // Another chat's warning is not this chat's: it takes nothing from a warning kept here.
    storage = memory(); writeNotice(storage, ME, 'chat-b', 'connection_lost', { job: OTHER_JOB });
    await run({ active: A, turn: stopBeforeText, settle: 'pending', storage });
    assert.deepEqual(readCreditsWarning(storage, ME, 'chat-a'), { code: 'stop_unsure', job: JOB, sent: textMark(TEXT) });
    assert.deepEqual(readCreditsWarning(storage, ME, 'chat-b'), { code: 'connection_lost', job: OTHER_JOB });
});

// ---- 2. each answer, for the case in the task: Stop before any text ----

test('Stop before any text, and the job has failed and been refunded: opening the chat takes the warning away, and the text stays in the box', async () => {
    const storage = await leftBy(stopBeforeText);
    const after = await opened(storage, 'chat-a', answers(JOBS.refunded));
    assert.deepEqual(after, { box: TEXT, notice: null, changed: true, calls: [JOB] });
    assert.equal(readCreditsWarning(storage, ME, 'chat-a'), null);
    // And it is over: the next time the chat is opened nothing is asked.
    assert.deepEqual(await opened(storage, 'chat-a', answers(JOBS.refunded)), { box: TEXT, notice: null, changed: false, calls: [] });
});

test('the warning is never removed on a turn that is not settled, a failed read or an answer that says nothing', async () => {
    const down = async () => { throw new Error('offline'); };
    const limited = async () => { throw Object.assign(new Error('rate_limited'), { status: 429 }); };
    const missing = async () => { throw Object.assign(new Error('not_found'), { status: 404 }); };
    const cases = [['still queued', answers(JOBS.queued)], ['still running', answers(JOBS.running)], ['failed, the refund not yet in', answers(JOBS.failed)],
        ['the read failed', down], ['the reads are rate limited', limited], ['the job is not this person\'s, or is gone', missing], ['an empty answer', answers({})], ['no answer', answers(null)]];
    for (const leave of [stopBeforeText, stopAfterText, cutAfterStart]) {
        for (const [name, getJob] of cases) {
            const storage = await leftBy(leave);
            const before = { ...afterReload(storage, 'chat-a'), warning: readCreditsWarning(storage, ME, 'chat-a') };
            const after = await opened(storage, 'chat-a', getJob);
            assert.equal(after.changed, false, name);
            assert.deepEqual({ box: after.box, notice: after.notice, warning: readCreditsWarning(storage, ME, 'chat-a') }, before, name);
            // It is asked again the next time the chat is opened, and goes when the answer comes.
            assert.equal((await opened(storage, 'chat-a', answers(JOBS.refunded))).notice, null, name);
        }
    }
});

// ---- 3. the turn was saved after all ----

test('Stop before any text, and the turn was saved late: the unchanged text is taken out of the box, and the chat says a reply was saved', async () => {
    const storage = await leftBy(stopBeforeText);
    // The same message is now in the chat, charged, and in the box. It is in the chat word for word, so nothing is lost
    // by taking it out of the box, and the person is not left one press from paying for it twice.
    assert.deepEqual(await opened(storage, 'chat-a', answers(JOBS.saved)), { box: '', notice: { code: 'stop_saved' }, changed: true, calls: [JOB] });
    assert.equal(readCreditsWarning(storage, ME, 'chat-a'), null, 'what is kept now is not a warning: the chat shows the reply and its price');
    assert.deepEqual(await opened(storage, 'chat-a', answers(JOBS.saved)), { box: '', notice: { code: 'stop_saved' }, changed: false, calls: [] });
    const words = /case 'stop_saved': return (['"])(.+?)\1;/.exec(api);
    assert.ok(words, 'chatErrorCopy has words for stop_saved');
    // "its price", not "the Credits it used": a reply on a free allowance is shown as Free. The last sentence is the point of it.
    assert.equal(words[2], 'A reply was saved after you pressed Stop. This chat shows it and its price. You do not need to send that message again.');
});

test('text the person has changed since it was given back is theirs: it stays, and the chat still says a reply was saved', async () => {
    const changes = [`${TEXT} And its keeper.`, 'Something else.', ` ${TEXT}`, `${TEXT}\n\ntyped before`, TEXT.toLowerCase()];
    for (const typed of changes) {
        const storage = await leftBy(stopBeforeText);
        writeDraft(storage, ME, 'chat-a', typed);
        assert.deepEqual(await opened(storage, 'chat-a', answers(JOBS.saved)), { box: typed, notice: { code: 'stop_saved' }, changed: true, calls: [JOB] }, JSON.stringify(typed));
    }
    // An emptied box stays empty, and a mark that is not there (storage that was changed by hand) takes nothing out.
    let storage = await leftBy(stopBeforeText);
    writeDraft(storage, ME, 'chat-a', '');
    assert.deepEqual(await opened(storage, 'chat-a', answers(JOBS.saved)), { box: '', notice: { code: 'stop_saved' }, changed: true, calls: [JOB] });
    storage = memory();
    writeDraft(storage, ME, 'chat-a', TEXT); writeNotice(storage, ME, 'chat-a', 'stop_unsure', { job: JOB });
    assert.deepEqual(await opened(storage, 'chat-a', answers(JOBS.saved)), { box: TEXT, notice: { code: 'stop_saved' }, changed: true, calls: [JOB] });
});

test('Stop before any text, and the reply was charged but could not be stored: the warning becomes the one that says so, and the text stays', async () => {
    const storage = await leftBy(stopBeforeText);
    assert.deepEqual(await opened(storage, 'chat-a', answers(JOBS.unsaved)), { box: TEXT, notice: { code: 'reply_not_saved' }, changed: true, calls: [JOB] });
    // Still a warning about Credits, so a later refusal does not take its place. It has no job: it is never asked about again.
    assert.deepEqual(readCreditsWarning(storage, ME, 'chat-a'), { code: 'reply_not_saved' });
    assert.deepEqual(await opened(storage, 'chat-a', answers(JOBS.refunded)), { box: TEXT, notice: { code: 'reply_not_saved' }, changed: false, calls: [] });
});

// ---- 4. Stop before `start` ----

test('Stop before the reply started: there is no job to ask, so nothing here removes the warning', async () => {
    const storage = await leftBy(stopBeforeStart);
    for (const job of Object.values(JOBS)) {
        assert.deepEqual(await opened(storage, 'chat-a', answers(job)), { box: TEXT, notice: { code: 'stop_unsure' }, changed: false, calls: [] });
    }
    assert.deepEqual(readCreditsWarning(storage, ME, 'chat-a'), { code: 'stop_unsure' });
});

// ---- 5. the other warnings ----

test('still saving after Stop, or a dropped connection: a turn that was saved or refunded takes the warning away and says nothing in its place', async () => {
    for (const [leave, code] of [[stopAfterText, 'stop_saving'], [cutAfterStart, 'connection_lost']]) {
        for (const job of [JOBS.saved, JOBS.refunded]) {
            const storage = await leftBy(leave);
            assert.deepEqual(readNotice(storage, ME, 'chat-a'), { code });
            // The chat is read after the job, so it shows what was kept and its price, or that nothing was.
            assert.deepEqual(await opened(storage, 'chat-a', answers(job)), { box: '', notice: null, changed: true, calls: [JOB] }, `${code} ${job.state}`);
        }
        // Neither gave the text back, so the box is the person's own: it is left alone even if they typed the same words again.
        const storage = await leftBy(leave);
        writeDraft(storage, ME, 'chat-a', TEXT);
        assert.deepEqual(await opened(storage, 'chat-a', answers(JOBS.saved)), { box: TEXT, notice: null, changed: true, calls: [JOB] }, code);
        // Charged and not stored: said, as after Stop before any text.
        const charged = await leftBy(leave);
        assert.deepEqual(await opened(charged, 'chat-a', answers(JOBS.unsaved)), { box: '', notice: { code: 'reply_not_saved' }, changed: true, calls: [JOB] }, code);
    }
});

test('a reply that was charged and not stored is never asked about: it is settled, and stays until a later message accounts for Credits', async () => {
    const storage = await leftBy(stopAfterText, { settle: 'unsaved' });
    for (const job of Object.values(JOBS)) {
        assert.deepEqual(await opened(storage, 'chat-a', answers(job)), { box: '', notice: { code: 'reply_not_saved' }, changed: false, calls: [] });
    }
});

// ---- the store is changed only for the warning that was asked about ----

test('a warning that was replaced or forgotten while its job was read is left as it is', async () => {
    const asked = { warning: { code: 'stop_unsure', job: JOB, sent: textMark(TEXT) }, verdict: 'refunded' };
    // A later message from the chat ended with a warning of its own, about another job.
    let storage = await leftBy(stopBeforeText);
    writeNotice(storage, ME, 'chat-a', 'connection_lost', { job: OTHER_JOB });
    assert.equal(settleKeptWarning(storage, ME, 'chat-a', asked), false);
    assert.deepEqual(readCreditsWarning(storage, ME, 'chat-a'), { code: 'connection_lost', job: OTHER_JOB });
    // The same warning again, for a later send that was stopped the same way: its job is another one.
    writeNotice(storage, ME, 'chat-a', 'stop_unsure', { job: OTHER_JOB, sent: TEXT });
    assert.equal(settleKeptWarning(storage, ME, 'chat-a', { ...asked, verdict: 'saved' }), false);
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: TEXT, notice: { code: 'stop_unsure' } }, 'neither the warning nor the text is touched');
    // The same job under another warning (not something send() does): the answer was for the one that was read.
    writeNotice(storage, ME, 'chat-a', 'stop_saving', { job: JOB });
    assert.equal(settleKeptWarning(storage, ME, 'chat-a', asked), false);
    // Forgotten: a later message was saved, or the chat was deleted. Nothing is put back.
    storage = await leftBy(stopBeforeText);
    writeNotice(storage, ME, 'chat-a', 'connection_saved');
    assert.equal(settleKeptWarning(storage, ME, 'chat-a', { ...asked, verdict: 'unsaved' }), false);
    assert.deepEqual(readNotice(storage, ME, 'chat-a'), { code: 'connection_saved' });
    // No answer, or an answer this does not know: nothing.
    storage = await leftBy(stopBeforeText);
    for (const none of [null, undefined, { warning: asked.warning, verdict: null }, { warning: asked.warning, verdict: 'pending' }, { warning: asked.warning, verdict: 'nothing' }]) {
        assert.equal(settleKeptWarning(storage, ME, 'chat-a', none), false, JSON.stringify(none));
    }
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: TEXT, notice: { code: 'stop_unsure' } });
    // Another chat's warning and draft are not this chat's.
    writeDraft(storage, ME, 'chat-b', TEXT); writeNotice(storage, ME, 'chat-b', 'stop_unsure', { job: JOB, sent: TEXT });
    assert.equal(settleKeptWarning(storage, ME, 'chat-a', { ...asked, verdict: 'saved' }), true);
    assert.deepEqual(afterReload(storage, 'chat-b'), { box: TEXT, notice: { code: 'stop_unsure' } });
    // With no user, or storage that throws, nothing is read, nothing is changed and nothing is thrown.
    assert.equal(settleKeptWarning(storage, null, 'chat-b', asked), false);
    const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
    assert.equal(settleKeptWarning(blocked, ME, 'chat-b', asked), false);
});

// ---- a warning kept under New chat: its chat is gone, so there is no chat to read ----

test('a warning kept under New chat goes when its job was refunded, says so when it was charged, and stays when the job says saved', async () => {
    // The chat was deleted while its reply was on its way: the text and the warning wait under New chat (chatSendHome.js).
    const left = async () => { const storage = memory(); await run({ active: A, turn: async (args, person) => { args.onEvent('start', { job_id: JOB }); person.deletes('chat-a'); throw stopped(); }, settle: 'pending', storage }); return storage; };
    let storage = await left();
    assert.deepEqual(readCreditsWarning(storage, ME, NEW_CHAT), { code: 'stop_unsure', job: JOB, sent: textMark(TEXT) });
    assert.deepEqual(await opened(storage, NEW_CHAT, answers(JOBS.refunded)), { box: TEXT, notice: null, changed: true, calls: [JOB] });
    storage = await left();
    assert.deepEqual(await opened(storage, NEW_CHAT, answers(JOBS.unsaved)), { box: TEXT, notice: { code: 'reply_not_saved' }, changed: true, calls: [JOB] });
    // "Saved" needs a chat that shows the reply and its price. New chat shows none, so the warning stays. The answer is
    // final, so the job is let go: the warning is not asked about on every page load from then on.
    storage = await left();
    assert.deepEqual(await opened(storage, NEW_CHAT, answers(JOBS.saved)), { box: TEXT, notice: { code: 'stop_unsure' }, changed: true, calls: [JOB] });
    assert.deepEqual(readCreditsWarning(storage, ME, NEW_CHAT), { code: 'stop_unsure' });
    assert.deepEqual(await opened(storage, NEW_CHAT, answers(JOBS.saved)), { box: TEXT, notice: { code: 'stop_unsure' }, changed: false, calls: [] });
});

// ---- the screen ----

test('opening a chat reads the job of its kept warning before the chat, and settles the store before the notice and the box are read from it', () => {
    const open = /\n {2}const open = async \(id\) => \{\n([\s\S]*?)\n {2}\};\n/.exec(screen);
    assert.ok(open, 'the screen has open()');
    // The job first: the server stores a turn in the same step that ends its job, so a chat read after a finished job
    // shows what that turn left. Read the other way round, the warning could go while the screen showed the chat without the reply.
    assert.match(open[1], /\n {4}try \{\n {6}const asked = await askKept\(id\);[^\n]*\n {6}const r = await chatApi\.get\(id\);\n/);
    // The whole of it, line for line, from the press to the screen: nothing sits between the answer and the settle that
    // could change the answer, and nothing reads the notice or the draft before the settle.
    assert.match(open[1], /^ {4}ask\(chatView\.current, id\);\n {4}try \{\n {6}const asked = await askKept\(id\);[^\n]*\n {6}const r = await chatApi\.get\(id\);\n {6}\/\/[^\n]*\n {6}if \(chatView\.current\.asked !== id\) \{ if \(chatView\.current\.shown === id\) setMessages\(r\.messages\); return false; \}\n {6}settleKept\(id, asked\);[^\n]*\n {6}setPersonaId\(''\); setActive\(r\.thread\);[^\n]*\n {6}setText\(readDraft\([^\n]*return true;\n {4}\} catch \(e\) \{[^\n]*\}$/);
    assert.equal(open[1].split('asked').length - 1, 3, 'the word appears where the answer is made, where it is used, and in the check of the press: the answer is not changed between');
    // Only for a chat that arrives on screen: a read overtaken by another press changes nothing, and neither does one that failed.
    const at = (s) => { const i = open[1].indexOf(s); assert.ok(i >= 0, s); return i; };
    assert.ok(at('if (chatView.current.asked !== id)') < at('settleKept(id, asked);'));
    assert.ok(at('settleKept(id, asked);') < at('setError(waiting(id));') && at('settleKept(id, asked);') < at('setText(readDraft('));
    assert.ok(at('settleKept(id, asked);') < at('} catch (e) {'));
    assert.equal(open[1].split('settleKept(').length - 1, 1);
    assert.equal(open[1].split('askKept(').length - 1, 1);
    // The two helpers: the warning is read from the store for the stored user, and the job is read by chatApi.job.
    assert.match(screen, /\nconst askKept = \(chatId\) => askKeptWarning\(\{ warning: heldWarning\(chatId\), getJob: chatApi\.job \}\);\n/);
    assert.match(screen, /\nconst settleKept = \(chatId, asked\) => settleKeptWarning\(store\(\), getStoredUserId\(\), chatId, asked\);\n/);
    assert.match(screen, /import \{ askKeptWarning, settleKeptWarning \} from '\.\.\/\.\.\/_lib\/chatWarning';/);
});

test('New chat shows what is kept at once and asks after: the screen changes only while New chat is on it and still says that warning', () => {
    const settleNew = /\n {2}const settleNew = async \(\) => \{\n([\s\S]*?)\n {2}\};\n/.exec(screen);
    assert.ok(settleNew, 'the screen has settleNew()');
    assert.match(settleNew[1], /^ {4}const asked = await askKept\(NEW_CHAT\);\n/);
    assert.equal(settleNew[1].split('\n').length, 4, 'four lines, each pinned here: the answer goes straight to the settle');
    // Nothing was changed in the store, or the person has opened a chat since: the screen is left as it is. Another
    // chat can be showing the very same words, for a warning of its own.
    assert.match(settleNew[1], /\n {4}if \(!settleKept\(NEW_CHAT, asked\) \|\| !onScreen\(chatView\.current, NEW_CHAT\)\) return;\n/);
    // A notice set since (a refusal said together with the warning, a failed read) is not this warning's words: it stays.
    assert.match(settleNew[1], /\n {4}const was = chatErrorCopy\(asked\.warning\.code, asked\.warning\);\n {4}setError\(\(now\) => \(now === was \? waiting\(NEW_CHAT\) : now\)\);$/);
    // On a page that has just loaded, and each time New chat is shown.
    assert.match(screen, /\n {2}useEffect\(\(\) => \{ settleNew\(\); \}, \[\]\);[^\n]*\n/);
    const clear = /\n {2}const clear = \(\) => \{([^\n]*)\};\n/.exec(screen);
    assert.match(clear[1], / setStarredOnly\(false\); settleNew\(\); $/);
    assert.equal(screen.split('settleNew(').length - 1, 2, 'the two calls');
    // The screen still forgets a notice itself in one place only (a deleted chat), and never keeps one (tests/chatSendHome.test.mjs).
    assert.equal(screen.split('settleKept(').length - 1, 2, 'open() and settleNew()');
});

test('the settle module asks nothing itself and changes only the store', () => {
    // One import, the store, with its extension so the tests load it directly. The job read is handed in.
    assert.deepEqual([...settler.matchAll(/^import [^\n]+$/gm)].map((m) => m[0]), ["import { NEW_CHAT, clearNotice, readCreditsWarning, readDraft, textMark, writeDraft, writeNotice } from './chatLocal.js';"]);
    assert.doesNotMatch(settler, /fetch\(|gatewayFetch|chatApi|window\.|localStorage|setError|setText/);
});
