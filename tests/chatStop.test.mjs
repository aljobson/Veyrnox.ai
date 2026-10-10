// After Stop (ADR-0067): the server saves the stopped turn a moment after the browser lets go, so the screen reads the
// job and the chat a few times instead of reloading once and showing a chat without the turn.
// The reading is a plain module and is tested directly. The screen is not importable here, so its part is pinned by
// reading the source, as in chatBrokenStream.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STOP_ASK_LIMIT_MS, STOP_LIMIT_MS, STOP_WAITS_MS, askStoppedSend, findSavedTurn, settleStoppedTurn } from '../app/veyrnox/_lib/chatStop.js';
import { KEPT_READ_LIMIT_MS, keptTurnVerdict } from '../app/veyrnox/_lib/chatWarning.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const screen = read('../app/veyrnox/_components/chat/ChatWorkspace.js');
// send() and its endings moved out of ChatWorkspace.js into the useChatSend hook, unchanged and at the same indentation, to
// keep the screen file under 500 lines. The patterns that pin send() read the hook; the ones that pin markup read the screen.
const sender = read('../app/veyrnox/_components/chat/useChatSend.js');
// Since the person can open another chat before a send ends (tests/chatSendHome.test.mjs), an ending no longer calls
// open(), setError() or refreshThreads() itself. It calls reload(), tell() and relist(), which do the same while the
// chat the message was sent in is on screen and leave the screen alone when it is not. The patterns below name those.
const api = read('../app/veyrnox/_lib/chatApi.js');

const TEXT = 'Write about tea.';
const old = [
    { id: 'm1', role: 'user', content: 'Earlier question' },
    { id: 'm2', role: 'assistant', content: 'Earlier answer', status: 'complete', credits: 1 },
];
const saved = [
    { id: 'm3', role: 'user', content: TEXT },
    { id: 'm4', role: 'assistant', content: 'Tea is', status: 'canceled', credits: 1 },
];
const known = new Set(old.map((m) => m.id));

/** Fakes for one Stop: `jobs` and `chats` are what each read returns, in order; the last one repeats. An Error is thrown. */
function harness({ jobs = [], chats = [] }) {
    const log = { waits: [], jobReads: 0, chatReads: 0 };
    const next = (list, n) => {
        const v = list[Math.min(n, list.length - 1)];
        if (v instanceof Error) throw v;
        return v;
    };
    return {
        log,
        deps: {
            wait: async (ms) => { log.waits.push(ms); },
            getJob: async () => next(jobs, log.jobReads++),
            getThread: async () => ({ messages: next(chats, log.chatReads++) }),
        },
    };
}

test('the saved turn is the new question with this text and the reply after it', () => {
    assert.deepEqual(findSavedTurn([...old, ...saved], known, TEXT), { user: saved[0], reply: saved[1] });
    assert.equal(findSavedTurn(old, known, TEXT), null, 'a chat without the turn');
    assert.equal(findSavedTurn([...old, ...saved], known, 'Something else'), null, 'another message is not this send');
    assert.equal(findSavedTurn([...old, saved[0]], known, TEXT), null, 'a question with no reply is not a saved turn');
    assert.equal(findSavedTurn(undefined, known, TEXT), null);
});

test('a message the screen already had is never taken for this send, even with the same text', () => {
    const repeat = [{ id: 'm1', role: 'user', content: TEXT }, { id: 'm2', role: 'assistant', content: 'First answer', status: 'complete', credits: 1 }];
    assert.equal(findSavedTurn(repeat, new Set(['m1', 'm2']), TEXT), null);
    assert.deepEqual(findSavedTurn([...repeat, ...saved], new Set(['m1', 'm2']), TEXT), { user: saved[0], reply: saved[1] });
});

test('when the same text was sent twice, the later turn is this send', () => {
    // An earlier Stop can leave its turn unsaved on screen; if that one lands too, both are new to the screen.
    const earlier = [{ id: 'e1', role: 'user', content: TEXT }, { id: 'e2', role: 'assistant', content: 'First', status: 'canceled', credits: 1 }];
    assert.deepEqual(findSavedTurn([...old, ...earlier, ...saved], known, TEXT), { user: saved[0], reply: saved[1] });
});

test('the waits add up to about three seconds, and there are only a few', () => {
    const total = STOP_WAITS_MS.reduce((a, b) => a + b, 0);
    assert.ok(STOP_WAITS_MS.length >= 3 && STOP_WAITS_MS.length <= 5, 'a bounded number of tries');
    assert.ok(total >= 2000 && total <= 3000, `about three seconds in all, got ${total} ms`);
    assert.ok(STOP_WAITS_MS[0] >= 200, 'the first read waits: the save is never there at once');
    assert.ok(STOP_LIMIT_MS > total && STOP_LIMIT_MS <= 4000, 'the limit leaves room for the reads and still ends in about three seconds');
});

test('a read that hangs does not leave Stop hanging: the look-up ends at the time limit, and reads no further', async () => {
    const h = harness({ jobs: [{ state: 'running' }], chats: [old] });
    const hung = { ...h.deps, getJob: () => { h.log.jobReads += 1; return new Promise(() => {}); } };
    const before = Date.now();
    assert.equal(await settleStoppedTurn({ jobId: 'job-1', text: TEXT, knownIds: known, ...hung, limitMs: 30 }), 'pending');
    assert.ok(Date.now() - before < 1000, 'it answered at the limit, not when the read came back');
    assert.equal(h.log.jobReads, 1);

    // The limit answers while the job read of a try is still out: that try does not go on to read the chat.
    const mid = harness({ jobs: [{ state: 'failed', refunded: true }], chats: [old] });
    const lateJob = { ...mid.deps, getJob: async () => { mid.log.jobReads += 1; await new Promise((resolve) => { setTimeout(resolve, 80); }); return { state: 'failed', refunded: true }; } };
    assert.equal(await settleStoppedTurn({ jobId: 'job-1', text: TEXT, knownIds: known, ...lateJob, limitMs: 30 }), 'pending');
    await new Promise((resolve) => { setTimeout(resolve, 150); });
    assert.equal(mid.log.chatReads, 0, 'no chat read after the limit');

    // Slow rather than hung: the limit answers, and the tries that were left are not made.
    const slow = harness({ jobs: [{ state: 'running' }], chats: [old] });
    const real = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
    assert.equal(await settleStoppedTurn({ jobId: 'job-1', text: TEXT, knownIds: known, ...slow.deps, wait: () => real(40), limitMs: 60 }), 'pending');
    await real(150);
    assert.equal(slow.log.jobReads, 1, 'no read after the limit');
});

test('Stop after text: once the job has finished the turn is saved, with no need to read the chat', async () => {
    const h = harness({ jobs: [{ state: 'running' }, { state: 'succeeded' }], chats: [new Error('offline')] });
    assert.equal(await settleStoppedTurn({ jobId: 'job-1', text: TEXT, knownIds: known, ...h.deps }), 'saved');
    assert.deepEqual(h.log.waits, STOP_WAITS_MS.slice(0, 2), 'it waits before each read and stops once the job has finished');
    // The messages are stored in the same step that ends the job, so a finished job is enough. The screen reloads the
    // chat itself; a chat read that failed here must not turn a saved reply into "still saving".
    assert.equal(h.log.chatReads, 0);
});

test('Stop before any text: the job failed, the Credits are back and nothing was stored', async () => {
    const h = harness({ jobs: [{ state: 'failed', refunded: true }], chats: [old] });
    assert.equal(await settleStoppedTurn({ jobId: 'job-1', text: TEXT, knownIds: known, ...h.deps }), 'nothing');
    assert.equal(h.log.waits.length, 1);
});

test('a reply the provider cut off is stored although its job failed: that is a saved turn', async () => {
    const cut = [saved[0], { ...saved[1], status: 'error', credits: 0 }];
    const h = harness({ jobs: [{ state: 'failed', refunded: true }], chats: [[...old, ...cut]] });
    assert.equal(await settleStoppedTurn({ jobId: 'job-1', text: TEXT, knownIds: known, ...h.deps }), 'saved');
});

test('a failed job whose refund has not landed is read again, so the balance shown afterwards is the final one', async () => {
    const h = harness({ jobs: [{ state: 'failed', refunded: false }, { state: 'failed', refunded: true }], chats: [old] });
    assert.equal(await settleStoppedTurn({ jobId: 'job-1', text: TEXT, knownIds: known, ...h.deps }), 'nothing');
    assert.equal(h.log.waits.length, 2);
    assert.equal(h.log.chatReads, 1, 'the chat is read once the refund is in');
});

test('a refund that never shows in time still ends as nothing came back, on the last try', async () => {
    const h = harness({ jobs: [{ state: 'failed', refunded: false }], chats: [old] });
    assert.equal(await settleStoppedTurn({ jobId: 'job-1', text: TEXT, knownIds: known, ...h.deps }), 'nothing');
    assert.deepEqual(h.log.waits, STOP_WAITS_MS);
});

test('the save has not landed when the tries run out: pending, after a bounded number of reads', async () => {
    const h = harness({ jobs: [{ state: 'running' }], chats: [old] });
    assert.equal(await settleStoppedTurn({ jobId: 'job-1', text: TEXT, knownIds: known, ...h.deps }), 'pending');
    assert.deepEqual(h.log.waits, STOP_WAITS_MS);
    assert.equal(h.log.jobReads, STOP_WAITS_MS.length);
    assert.equal(h.log.chatReads, 0);
});

test('a reply that was charged but could not be stored is its own ending, not a saved turn', async () => {
    // lib/chatTurn.js ends such a job STORED with this error code and no messages (ADR-0067 amendment 9).
    assert.match(read('../packages/db/schema/supabase/0233_chat_settle_unsaved_turn.sql'), /state = 'STORED', error_code = 'reply_not_saved'/);
    const h = harness({ jobs: [{ state: 'succeeded', error_code: 'reply_not_saved' }], chats: [old] });
    assert.equal(await settleStoppedTurn({ jobId: 'job-1', text: TEXT, knownIds: known, ...h.deps }), 'unsaved');
});

test('the time limit is cleared when the look-up ends first, so nothing is left running', async (t) => {
    const cleared = t.mock.method(globalThis, 'clearTimeout');
    const h = harness({ jobs: [{ state: 'succeeded' }], chats: [old] });
    assert.equal(await settleStoppedTurn({ jobId: 'job-1', text: TEXT, knownIds: known, ...h.deps }), 'saved');
    assert.equal(cleared.mock.callCount(), 1);
});

test('Stop before the start event: no job id, so the chat alone is read', async () => {
    const found = harness({ chats: [old, [...old, ...saved]] });
    assert.equal(await settleStoppedTurn({ jobId: null, text: TEXT, knownIds: known, ...found.deps }), 'saved');
    assert.equal(found.log.jobReads, 0);
    assert.equal(found.log.chatReads, 2);

    const never = harness({ chats: [old] });
    assert.equal(await settleStoppedTurn({ jobId: null, text: TEXT, knownIds: known, ...never.deps }), 'pending');
    assert.equal(never.log.chatReads, STOP_WAITS_MS.length);
});

test('a read that fails is not an answer: the next try decides', async () => {
    const jobDown = harness({ jobs: [new Error('offline')], chats: [old, [...old, ...saved]] });
    assert.equal(await settleStoppedTurn({ jobId: 'job-1', text: TEXT, knownIds: known, ...jobDown.deps }), 'saved', 'without the job, the chat alone is enough');

    const chatDown = harness({ jobs: [{ state: 'failed', refunded: true }], chats: [new Error('offline')] });
    assert.equal(await settleStoppedTurn({ jobId: 'job-1', text: TEXT, knownIds: known, ...chatDown.deps }), 'pending', 'never "nothing came back" on a chat that could not be read');

    const allDown = harness({ jobs: [new Error('offline')], chats: [new Error('offline')] });
    assert.equal(await settleStoppedTurn({ jobId: 'job-1', text: TEXT, knownIds: known, ...allDown.deps }), 'pending');
});

// ---- Stop before `start`: the send is asked about by its own key, at the moment of Stop ----
// No job id reached the browser, so the look above can only read the chat, and nearly always ends 'pending'. The
// server can say at once what became of the send (POST /api/v1/chat/sends/close, ADR-0067 amendment 11): it closed
// the key, so no reply was charged and none can be, or it names the job that send made.

const KEY = 'vx-1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const JOB = '6f1d2c3a-0b4e-4c5d-8e9f-a1b2c3d4e5f6';
const NO_ANSWER = { closed: false, job: null };
const says = (answer) => async () => answer;
const refuses = (status, code) => async () => { throw Object.assign(new Error(code), { status, code }); };

test('asked by its key, the server says it closed the send, or names the job that send made', async () => {
    const asked = [];
    const route = (answer) => async (key) => { asked.push(key); return answer; };
    assert.deepEqual(await askStoppedSend({ key: KEY, closeSend: route({ closed: true }) }), { closed: true, job: null });
    // The job is named whatever it is doing: the look that follows reads it by its id, as after `start`.
    for (const job of [{ state: 'queued', refunded: false }, { state: 'running', refunded: false }, { state: 'failed', refunded: false }, { state: 'failed', refunded: true }, { state: 'succeeded', refunded: false }, { state: 'succeeded', refunded: false, error_code: 'reply_not_saved' }]) {
        assert.deepEqual(await askStoppedSend({ key: KEY, closeSend: route({ closed: false, job_id: JOB, credits: 2, model_id: 'm', ...job }) }), { closed: false, job: JOB }, JSON.stringify(job));
    }
    assert.deepEqual(asked, Array(7).fill(KEY), 'asked once each time, by the key');
});

test('anything else is no answer: a refusal, a rate limit, the route not open, a failed request', async () => {
    const none = [['the route is not open (its switch is off)', refuses(503, 'send_close_not_open')], ['rate limited', refuses(429, 'rate_limited')], ['too many sends closed', refuses(429, 'close_limit')],
        ['the database gave no answer', refuses(502, 'close_failed')], ['a key the route does not take', refuses(400, 'invalid_key')], ['signed out', refuses(401, 'unauthenticated')],
        ['another account signed in', refuses(409, 'account_changed')], ['offline', async () => { throw new TypeError('Failed to fetch'); }], ['a throw that is not an error', async () => { throw null; }],
        ['a route that throws at once', () => { throw new Error('sync'); }]];
    for (const [name, closeSend] of none) assert.deepEqual(await askStoppedSend({ key: KEY, closeSend }), NO_ANSWER, name);
});

test('an answer in a shape the route does not send is no answer, and "closed" is read exactly as a kept warning reads it', async () => {
    // tests/chatWarningTurns.test.mjs holds keptTurnVerdict to the same list: `closed` is the boolean, alone.
    const odd = [{ closed: 'true' }, { closed: 1 }, { closed: 'yes' }, { closed: null }, { closed: true, state: 'running' }, { closed: true, state: 'failed', refunded: true }, { closed: true, state: 'succeeded' },
        { closed: true, job_id: JOB }, { found: false }, { job: null }, { error: 'send_close_not_open' }, { error: 'not_found' }, { ok: true }, {}, null, undefined, 'closed', true, 0, [], [{ closed: true }],
        // Alone means alone: any other field beside it, even an empty one, and it is not the statement the route makes.
        { closed: true, job_id: null }, { closed: true, state: null }, { closed: true, state: undefined }, { closed: true, error: 'close_failed' }, { closed: true, ok: false }, { closed: true, job: JOB }, { closed: true, refunded: true }];
    for (const answer of odd) {
        assert.deepEqual(await askStoppedSend({ key: KEY, closeSend: says(answer) }), NO_ANSWER, JSON.stringify(answer));
        assert.notEqual(keptTurnVerdict(answer), 'refunded', `the kept warning does not take it for closed either: ${JSON.stringify(answer)}`);
    }
    assert.equal(keptTurnVerdict({ closed: true }), 'refunded');
    // A job is named only by `closed: false` and an id the server could have made. Without both, nothing is known.
    const noJob = [{ closed: false }, { closed: false, state: 'running' }, { closed: false, job_id: null }, { closed: false, job_id: '' }, { closed: false, job_id: 'job-1' }, { closed: false, job_id: 42 },
        { closed: false, job_id: `${JOB}0` }, { closed: false, job_id: ` ${JOB}` }, { closed: false, job_id: KEY }, { closed: false, job_id: [JOB] }, { job_id: JOB, state: 'running' }, { closed: 0, job_id: JOB }, { closed: 'false', job_id: JOB }];
    for (const answer of noJob) assert.deepEqual(await askStoppedSend({ key: KEY, closeSend: says(answer) }), NO_ANSWER, JSON.stringify(answer));
});

test('an answer that hangs does not leave Stop hanging: the question ends at its time limit, as no answer', async () => {
    const before = Date.now();
    assert.deepEqual(await askStoppedSend({ key: KEY, closeSend: () => new Promise(() => {}), limitMs: 30 }), NO_ANSWER);
    assert.ok(Date.now() - before < 1000, 'it answered at the limit');
    // An answer that has not come by the limit is not waited for. It arrives here only after "no answer" was said, so
    // no clock decides the order.
    for (const answer of [{ closed: true }, { closed: false, job_id: JOB, state: 'running' }]) {
        let arrive;
        const pending = new Promise((resolve) => { arrive = resolve; });
        assert.deepEqual(await askStoppedSend({ key: KEY, closeSend: () => pending, limitMs: 30 }), NO_ANSWER, JSON.stringify(answer));
        arrive(answer); await pending;
    }
    // Slow, and inside the limit: it is waited for.
    const slow = () => new Promise((resolve) => { setTimeout(() => resolve({ closed: true }), 20); });
    assert.deepEqual(await askStoppedSend({ key: KEY, closeSend: slow, limitMs: 60_000 }), { closed: true, job: null });
    // The same limit as the same question asked when a chat is opened (chatWarning.js): one number for one route.
    assert.equal(STOP_ASK_LIMIT_MS, KEPT_READ_LIMIT_MS);
    assert.ok(STOP_ASK_LIMIT_MS + STOP_LIMIT_MS <= 6000, 'with the look after it, Stop still ends in a few seconds at the very worst');
});

test('with no limit handed in, the question waits STOP_ASK_LIMIT_MS and not a millisecond more', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const turn = () => new Promise((resolve) => { setImmediate(resolve); });
    let said = null;
    const asking = askStoppedSend({ key: KEY, closeSend: () => new Promise(() => {}) }).then((v) => { said = v; });
    await turn();
    t.mock.timers.tick(STOP_ASK_LIMIT_MS - 1);
    await turn();
    assert.equal(said, null, 'still waiting one millisecond before the limit');
    t.mock.timers.tick(1);
    await asking;
    assert.deepEqual(said, NO_ANSWER);
});

test('the question\'s time limit is cleared when the answer comes first, and with no key nothing is asked', async (t) => {
    const cleared = t.mock.method(globalThis, 'clearTimeout');
    assert.deepEqual(await askStoppedSend({ key: KEY, closeSend: says({ closed: true }) }), { closed: true, job: null });
    assert.equal(cleared.mock.callCount(), 1);
    assert.deepEqual(await askStoppedSend({ key: KEY, closeSend: refuses(503, 'send_close_not_open') }), NO_ANSWER);
    assert.equal(cleared.mock.callCount(), 2, 'after a refusal too');
    let calls = 0;
    const counted = async () => { calls += 1; return { closed: true }; };
    for (const key of [null, undefined, '', 42, {}]) assert.deepEqual(await askStoppedSend({ key, closeSend: counted }), NO_ANSWER, String(key));
    assert.equal(calls, 0);
    assert.deepEqual(await askStoppedSend({ key: KEY }), NO_ANSWER, 'nothing to ask with');
});

// ---- the screen ----

/** The Stop ending of send()'s catch block. */
function stopBranch() {
    const block = /\n {6}if \(e\?\.name === 'AbortError'\) \{\n([\s\S]*?)\n {6}\} else if \(started\) \{\n/.exec(sender);
    assert.ok(block, 'the catch block opens with the Stop branch');
    return block[1];
}

test('Stop no longer reloads the chat at once: the bubble is marked, then the turn is looked for', () => {
    const stop = stopBranch();
    const mark = stop.indexOf("status: 'saving'");
    const settle = stop.indexOf('await chatApi.settleStop(');
    const reload = stop.indexOf('await reload()');
    assert.ok(mark >= 0 && settle > mark, 'the text so far stays on screen, marked as being saved, before anything is read');
    assert.ok(reload > settle, 'the chat is reloaded only after the turn was looked for');
    assert.match(stop, /settleStop\(\{ threadId: thread\.id, jobId, text: content, knownIds \}\)/);
});

test('Stop before the start event: the send is asked about first, by its key, and only then is the turn looked for', () => {
    const stop = stopBranch();
    const mark = stop.indexOf("status: 'saving'");
    const ask = stop.indexOf('await askStoppedSend(');
    const settle = stop.indexOf('await chatApi.settleStop(');
    assert.ok(mark >= 0 && ask > mark, 'the button says Stopping while the server is asked');
    assert.ok(settle > ask, 'the question comes before the look');
    // Only with no job id: once `start` has come the job is read, and reading a job changes nothing on the server.
    assert.match(stop, /\n {8}const asked = jobId \? null : await askStoppedSend\(\{ key, closeSend: chatApi\.closeSend \}\);\n/);
    // The send made a job: that id is the one looked for, and the one kept with a warning (tell() hands on jobId).
    assert.match(stop, /\n {8}if \(asked\?\.job\) jobId = asked\.job;\n/);
    // The server closed the send: the ending of a job that kept nothing, with no look at all. Anything else: the look,
    // in the words it has always had (the same call a dropped connection makes, tests/chatBrokenStream.test.mjs).
    assert.match(stop, /\n {8}const outcome = asked\?\.closed \? 'nothing' : await chatApi\.settleStop\(\{ threadId: thread\.id, jobId, text: content, knownIds \}\);\n/);
    // Asked in two places in the whole hook, with this one function: Stop before `start` (here), and since amendment 13 a
    // message whose own request got no answer before `start` (tests/chatSendUnanswered.test.mjs). It was one. A stream
    // that broke after `start`, a refusal and a turn that never started do not close a send.
    assert.equal(sender.split('askStoppedSend(').length - 1, 2);
    assert.equal(sender.split('chatApi.closeSend').length - 1, 2);
    assert.equal(stop.split('askStoppedSend(').length - 1, 1, 'once in the Stop branch');
    assert.match(api, /\nexport \{ makeIdempotencyKey, lostNotice, askStoppedSend \};\n/);
    assert.match(api, /\nimport \{ askStoppedSend, lostNotice, settleStoppedTurn \} from '\.\/chatStop';\n/);
    // The look itself has no imports, so the route is handed in.
    assert.doesNotMatch(read('../app/veyrnox/_lib/chatStop.js'), /^import |\brequire\(/m);
});

test('the start event gives the job id, and the ids already on screen are noted before the send', () => {
    // For a while it also forgot the notice kept for the message before this one. A warning about Credits now waits
    // for an ending that accounts for them (tests/chatSendHome.test.mjs), so the handler is as it was.
    assert.match(sender, /if \(ev === 'start'\) \{ started = true; jobId = d\.job_id; setProgress\(null\); \}/);
    assert.match(sender, /const knownIds = new Set\(messages\.map\(\(x\) => x\.id\)\);/);
});

test('each ending of a Stop: saved shows the chat, nothing came back gives the text back, pending says so', () => {
    const stop = stopBranch();
    // The chat list is refreshed before the endings: a notice set by one of them must be the last word.
    const refresh = stop.indexOf('await relist();');
    assert.ok(refresh >= 0 && refresh < stop.indexOf("if (outcome === 'saved'"), 'the list is refreshed first');
    assert.match(stop, /if \(outcome === 'saved' \|\| outcome === 'unsaved'\) \{\n {10}att\.clear\(\);/, 'the images were sent: the next reply starts clean');
    assert.match(stop, /if \(outcome === 'saved' \|\| outcome === 'unsaved'\) \{\n[^}]*await reload\(\);/);
    // Charged but not stored: the same words as when a reply that ran to its end could not be stored, after the reload
    // that would clear them.
    assert.match(stop, /await reload\(\);[^\n]*\n {10}if \(outcome === 'unsaved'\) tell\('reply_not_saved'\);/);
    // Nothing came back: the text goes back and nothing is said, as before. Unless a warning about Credits is kept for
    // the chat: then both are said, this Stop first (besideWarning(), tests/chatSendHome.test.mjs).
    assert.match(stop, /\} else if \(outcome === 'nothing'\) \{ giveBack\(true\); besideWarning\('stop_refunded'\); \}/);
    // Not settled, and no text had arrived (Stop before `start`, or after it but before the first words): there is
    // nothing on screen to keep, so the message goes back. The chat is kept, since nothing says the turn is over, and
    // the person is told a reply may still land.
    assert.match(sender, /if \(ev === 'delta'\) \{ hadText = true; setMessages\(/);
    // tell() takes the code: it is kept with the chat, so the notice is still there after a page reload, and the words
    // are made from it (tests/chatSendHome.test.mjs).
    assert.match(stop, /else if \(!hadText\) \{\n[^}]*giveBack\(false\); tell\('stop_unsure'\);\n {8}\} else \{/);
    const pending = stop.slice(stop.indexOf("tell('stop_unsure')"));
    assert.match(pending, /tell\('stop_saving'\)/);
    assert.doesNotMatch(pending, /setText\(content\)|giveBack|chatApi\.remove|open\(thread\.id\)|reload\(/, 'pending keeps the text on screen and the chat as it is');
    assert.doesNotMatch(stop, /chatApi\.remove/, 'the Stop branch deletes a chat only through giveBack(true)');
});

test('giving the text back deletes a chat made for the message only when the turn is known to be over', () => {
    const give = /\n {4}const giveBack = \(over\) => \{\n([\s\S]*?)\n {4}\};\n/.exec(sender);
    assert.ok(give, 'send() has one place that gives the text back');
    assert.match(give[1], /setText\(content\)/);
    assert.match(give[1], /if \(over && created\) \{ chatApi\.remove\(thread\.id\)\.catch\(\(\) => \{\}\);/);
    // The same path as a `done` event that says nothing came back. Its notice was told with tell(); it is told as a
    // message that used no Credits, and with no error named it is this Stop's words beside a kept warning.
    assert.match(sender, /\n {8}giveBack\(true\);\n {8}if \(streamError\) tellUncharged\(streamError\); else besideWarning\('stop_refunded'\);/);
});

test('a reply that is still being saved shows no price, and the button says it is stopping', () => {
    // 'lost' is the same for a dropped connection (tests/chatBrokenStream.test.mjs), so the pattern stops before it.
    assert.match(screen, /const isLive = \(m\) => m\.status === 'streaming' \|\| m\.status === 'saving'/);
    assert.match(screen, /!isLive\(m\) && <Footer /, 'no price, Copy or Star until the saved reply is shown');
    // One line under the text serves both look-ups (Stop here, a dropped connection in tests/chatBrokenStream.test.mjs).
    assert.match(screen, /m\.status === 'lost'\) && m\.content && <p role="status"[^>]*>\{m\.status === 'saving' \? 'Stopped\. Saving this reply\.' : /);
    // The button is also disabled, and reads "Checking", while a turn cut off by a dropped connection is looked for.
    assert.match(screen, /disabled=\{stopping \|\| checking\}[^\n]*\{stopping \? 'Stopping' : /);
    // Its own state, cleared when the send ends. A bubble an earlier Stop left as 'saving' must not disable the button
    // on the next reply, so the button does not read the messages.
    assert.match(stopBranch(), /setStopping\(true\);/);
    assert.match(sender, /\} finally \{ setBusy\(false\); setProgress\(null\); setStopping\(false\);/);
});

test('looking for the stopped turn reads the job and the chat, then refreshes the balance in the nav', () => {
    assert.match(api, /job: \(id\) => gatewayFetch\(`\/jobs\/\$\{encodeURIComponent\(id\)\}`\),/);
    const settle = /\n {2}settleStop: async \(\{ threadId, jobId, text, knownIds \}\) => \{\n([\s\S]*?)\n {2}\},\n/.exec(api);
    assert.ok(settle, 'chatApi has settleStop');
    assert.match(settle[1], /getThread: \(\) => chatApi\.get\(threadId\), getJob: chatApi\.job/);
    const found = settle[1].indexOf('await settleStoppedTurn(');
    const balance = settle[1].indexOf('notifyBalanceChanged()');
    assert.ok(found >= 0 && balance > found, 'the balance is refreshed after the turn has settled, not at the moment of the Stop');
});

test('a Stop before any text says a reply may still land, and does not promise either way', () => {
    const copy = /case 'stop_unsure': return (['"])(.+?)\1;/.exec(api);
    assert.ok(copy, 'chatErrorCopy knows stop_unsure');
    assert.match(copy[2], /before any text arrived/);
    assert.match(copy[2], /If a reply is still saved/);
    assert.match(copy[2], /use Credits/);
    assert.doesNotMatch(copy[2], /No Credits|not be charged|Try again|!/);
});

test('Stop with nothing kept has words for when a warning is kept beside it: nothing was saved and no Credits were used', () => {
    // On its own this ending says nothing (the text is simply back in the box). The words are for the screen only, said
    // before "Before that:" and the kept warning, which alone would read as being about this Stop.
    const copy = /case 'stop_refunded': return (['"])(.+?)\1;/.exec(api);
    assert.ok(copy, 'chatErrorCopy knows stop_refunded');
    assert.match(copy[2], /^Stopped\. /);
    assert.match(copy[2], /Nothing was saved and no Credits were used/);
    assert.match(copy[2], /message is back in the box/);
    // Text can have reached the screen before the turn failed to save, so the words do not say that nothing arrived.
    assert.doesNotMatch(copy[2], /may|still|before any|Try again|!/);
});

test('the words say the reply is still being saved and may use Credits', () => {
    const copy = /case 'stop_saving': return (['"])(.+?)\1;/.exec(api);
    assert.ok(copy, 'chatErrorCopy knows stop_saving');
    assert.match(copy[2], /still saving/);
    assert.match(copy[2], /may use Credits/);
    assert.doesNotMatch(copy[2], /No Credits|not be charged|Try again|!/);
});
