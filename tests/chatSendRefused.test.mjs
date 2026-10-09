// A later message that is refused before it starts (ADR-0067), run through send() itself with the harness of
// tests/chatSendFlow.test.mjs.
// The independent review of PR 724 left one case about Credits open. Stop before any text with the turn not settled
// keeps `stop_unsure` with the given-back text; the person presses Send again; that second message is refused before
// it starts. The refusal took the place of the warning, on screen and in the store, so after a page reload the box
// held the message with nothing saying that its first send may still be saved and use Credits.
// Two changes close it. A kept warning (one of the WARNINGS) is forgotten when the next message is known to have gone
// out (the `start` event, which follows the debit, or the chat being read again for it), not at the press; any other
// notice still goes at the press. And a message that never started does not replace a warning: the warning stays
// kept, and both are said on screen, the refusal first.

import test from 'node:test';
import assert from 'node:assert/strict';
import { NEW_CHAT, readNotice, writeNotice } from '../app/veyrnox/_lib/chatLocal.js';
import { A, GatewayError, ME, TEXT, WARNINGS, afterReload, cutBeforeText, memory, refused, reply, run, stopAfterText, stopBeforeText, stopped, toB } from './chatSendFlow.harness.mjs';

const noCredits = () => new GatewayError('no', { status: 402, code: 'insufficient_balance' });
const tooFast = () => new GatewayError('no', { status: 429, code: 'rate_limited' });
const stopBeforeStart = async () => { throw stopped(); };
/** The fake words for a refusal said together with the warning it must not replace (chatRefusedCopy in run()). */
const said = (refusal, warning) => `${refusal}, and before that ${warning}`;
/** Chat a after Stop before any text with the turn not settled: its text is in its box and the warning is stored. */
async function stoppedUnsure() {
    const storage = memory();
    await run({ active: A, turn: stopBeforeText(), settle: 'pending', storage });
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: TEXT, notice: { code: 'stop_unsure' } });
    return storage;
}

test('Stop before any text, sent again and refused: the warning is still kept with the text, and both are said', async () => {
    const refusals = [
        ['insufficient_balance', { turn: refused(noCredits()) }],
        ['rate_limited', { turn: refused(tooFast()) }],
        ['upload_failed', { images: [{ file: {} }], upload: async () => { throw new GatewayError('upload_failed', { status: 0, code: 'upload_failed' }); } }],
        ['image_unreadable', { images: [{ file: {} }], prepare: async () => { throw new Error('image_unreadable'); } }],
        // No answer at all to the request: nothing says a turn started, so it is told as a refusal with no code of its own.
        [undefined, { turn: refused(new TypeError('network error')) }],
    ];
    for (const [code, how] of refusals) {
        const storage = await stoppedUnsure();
        const { log } = await run({ active: A, storage, turn: reply(), ...how });
        // For the person who never reloads: why this message did not go, and that the one before it may still use Credits.
        assert.deepEqual(log.notices, [null, said(code, 'stop_unsure')], String(code));
        assert.deepEqual([log.box, log.failures, log.opened], [['', TEXT], [], []], String(code));
        // And after a page reload. The money rule: the text is never in the box without the warning.
        assert.deepEqual(afterReload(storage, 'chat-a'), { box: TEXT, notice: { code: 'stop_unsure' } }, String(code));
    }
});

test('the whole sequence: refused, reloaded, refused again, then the message goes out and the warning is forgotten as the reply starts', async () => {
    const storage = await stoppedUnsure();
    await run({ active: A, storage, turn: refused(noCredits()) });
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: TEXT, notice: { code: 'stop_unsure' } });
    const again = await run({ active: A, storage, turn: refused(tooFast()) });
    assert.deepEqual(again.log.notices, [null, said('rate_limited', 'stop_unsure')], 'a second refusal says the same two things');
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: TEXT, notice: { code: 'stop_unsure' } });
    // Topped up and sent again. The warning is kept until the reply starts, which is after the debit, and not after that.
    const seen = {};
    const goes = async ({ onEvent }) => {
        seen.beforeStart = readNotice(storage, ME, 'chat-a');
        onEvent('start', { job_id: 'job-2' });
        seen.afterStart = readNotice(storage, ME, 'chat-a');
        onEvent('delta', { text: 'A lamp' }); onEvent('done', { status: 'completed', credits_charged: 2, message_id: 'm2' });
        return { replay: false };
    };
    const sent = await run({ active: A, storage, turn: goes });
    assert.deepEqual(seen, { beforeStart: { code: 'stop_unsure' }, afterStart: null });
    assert.deepEqual([sent.log.notices, sent.log.opened, sent.log.shownOnOpen], [[null], ['chat-a'], [null]]);
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: '', notice: null });
});

test('a refusal leaves each of the four warnings about Credits where it was, and takes the place of any other notice', async () => {
    for (const code of WARNINGS) {
        const { log, kept } = await run({ active: A, turn: refused(tooFast()), kept: { 'chat-a': code, 'chat-b': 'connection_lost' } });
        assert.deepEqual([kept(), log.dropped], [{ 'chat-a': code, 'chat-b': 'connection_lost' }, []], code);
        assert.deepEqual([log.notices, log.box], [[null, said('rate_limited', code)], ['', TEXT]], code);
    }
    // Every other notice is about a message that is settled: it used no Credits, or the chat itself shows what it used.
    // `connection_saved` is one of these: the saved reply and its price are in the chat.
    for (const code of ['connection_saved', 'connection_refunded', 'insufficient_balance', 'rate_limited', 'provider_cut_off', 'unknown']) {
        const { log, kept } = await run({ active: A, turn: refused(noCredits()), kept: { 'chat-a': code } });
        assert.deepEqual([kept(), log.keptWith['chat-a'], log.notices], [{ 'chat-a': 'insufficient_balance' }, { credits: 2 }, [null, 'insufficient_balance']], code);
    }
});

test('a warning that waits under New chat stays there when the next message is refused, or its chat cannot be made', async () => {
    // The chat the first message was sent in was deleted while its reply was awaited, so its text and its warning are under New chat.
    const under = async () => {
        const storage = memory();
        await run({ active: A, turn: stopBeforeText((p) => p.deletes('chat-a')), settle: 'pending', storage });
        assert.deepEqual(afterReload(storage, NEW_CHAT), { box: TEXT, notice: { code: 'stop_unsure' } });
        return storage;
    };
    // The chat could not be made: nothing was sent, and there is no chat to delete.
    const unmade = await under();
    const none = await run({ active: null, storage: unmade, turn: reply(), making: async () => { throw new GatewayError('no', { status: 500, code: 'gateway_error' }); } });
    assert.deepEqual([none.log.notices, none.log.deleted, none.log.activeSet], [[null, said('gateway_error', 'stop_unsure')], [], []]);
    assert.deepEqual(afterReload(unmade, NEW_CHAT), { box: TEXT, notice: { code: 'stop_unsure' } });
    // The chat was made and the message refused: the chat goes, and the text is back under New chat, beside the warning.
    const made = await under();
    const gone = await run({ active: null, storage: made, turn: refused(noCredits()) });
    assert.deepEqual([gone.log.notices, gone.log.deleted], [[null, said('insufficient_balance', 'stop_unsure')], ['made']]);
    assert.deepEqual(afterReload(made, NEW_CHAT), { box: TEXT, notice: { code: 'stop_unsure' } });
    assert.deepEqual(afterReload(made, 'made'), { box: '', notice: null });
});

test('a second message that starts: whatever way it ends, the warning kept before it is gone, or replaced by its own notice', async () => {
    const nothingKept = async ({ onEvent }) => { onEvent('start', { job_id: 'j' }); onEvent('error', { error: 'provider_cut_off' }); onEvent('done', { status: 'failed' }); return { replay: false }; };
    const endings = [
        ['ran to its end', { turn: reply() }, { box: '', notice: null }],
        ['was stopped before any text, not settled', { turn: stopBeforeText(), settle: 'pending' }, { box: TEXT, notice: { code: 'stop_unsure' } }],
        ['was stopped after text, still being saved', { turn: stopAfterText(), settle: 'pending' }, { box: '', notice: { code: 'stop_saving' } }],
        ['was stopped, charged but not stored', { turn: stopAfterText(), settle: 'unsaved' }, { box: '', notice: { code: 'reply_not_saved' } }],
        ['was stopped with nothing kept', { turn: stopBeforeText(), settle: 'nothing' }, { box: TEXT, notice: null }],
        ['lost its connection with nothing kept', { turn: cutBeforeText(), settle: 'nothing' }, { box: TEXT, notice: { code: 'connection_refunded' } }],
        ['lost its connection, not settled', { turn: cutBeforeText(), settle: 'pending' }, { box: '', notice: { code: 'connection_lost' } }],
        ['lost its connection and was saved', { turn: cutBeforeText(), settle: 'saved' }, { box: '', notice: { code: 'connection_saved' } }],
        ['failed with nothing kept', { turn: nothingKept }, { box: TEXT, notice: { code: 'provider_cut_off' } }],
    ];
    for (const was of WARNINGS) {
        for (const [name, how, left] of endings) {
            const storage = memory();
            writeNotice(storage, ME, 'chat-a', was);
            const { log } = await run({ active: A, storage, ...how });
            assert.deepEqual(afterReload(storage, 'chat-a'), left, `${was}, then a message that started and ${name}`);
            assert.ok(log.shownOnOpen.every((n) => n === null), `${name}: a chat that is read again for the message is not shown the warning kept before it`);
        }
    }
});

test('endings that never see the reply start, and are not refusals: Stop keeps its own warning, and a turn that is found forgets the one before', async () => {
    // Stop before the reply started, not settled: nothing says whether this message went out. Its own warning is the one kept.
    const unsure = memory();
    writeNotice(unsure, ME, 'chat-a', 'reply_not_saved');
    const first = await run({ active: A, storage: unsure, turn: stopBeforeStart, settle: 'pending' });
    assert.deepEqual([afterReload(unsure, 'chat-a'), first.log.notices], [{ box: TEXT, notice: { code: 'stop_unsure' } }, [null, 'stop_unsure']]);
    // Stop before the reply started, and the chat holds the turn: it went out. The chat is read again with nothing kept for it.
    const found = await stoppedUnsure();
    const second = await run({ active: A, storage: found, turn: stopBeforeStart, settle: 'saved' });
    assert.deepEqual([afterReload(found, 'chat-a'), second.log.opened, second.log.shownOnOpen, second.log.notices], [{ box: '', notice: null }, ['chat-a'], [null], [null]]);
    // The server says this very message already ran: the same.
    const replayed = await stoppedUnsure();
    const third = await run({ active: A, storage: replayed, turn: async () => ({ replay: true }) });
    assert.deepEqual([afterReload(replayed, 'chat-a'), third.log.opened, third.log.shownOnOpen], [{ box: '', notice: null }, ['chat-a'], [null]]);
});

test('a closed chat or a signed-out reader is about the whole page: a warning kept for the chat is left as it was', async () => {
    // Neither says anything about this chat, and the message did not go out. (When a session ends, authClient clears the store.)
    for (const [status, code] of [[503, 'chat_not_open'], [401, 'unauthenticated']]) {
        for (const was of WARNINGS) {
            const { log, kept } = await run({ active: A, turn: refused(new GatewayError('no', { status, code })), kept: { 'chat-a': was } });
            assert.deepEqual([kept(), log.dropped, log.failures, log.notices], [{ 'chat-a': was }, [], [code], [null]], `${code}, with ${was} kept`);
        }
        // Any other notice went at the press, as it always did: nothing stale is left beside the given-back text.
        const { log, kept } = await run({ active: A, turn: refused(new GatewayError('no', { status, code })), kept: { 'chat-a': 'rate_limited' } });
        assert.deepEqual([kept(), log.dropped, log.failures, log.notices], [{}, ['chat-a'], [code], [null]], `${code}, with a refusal kept`);
    }
});

test('a notice that is not a warning goes at the press, a warning only when the reply starts', async () => {
    const at = {};
    const watched = (was) => async ({ onEvent }, person) => {
        at[was] = { beforeStart: Object.keys(person.kept()) };
        onEvent('start', { job_id: 'j' });
        at[was].afterStart = Object.keys(person.kept());
        onEvent('done', { status: 'completed', credits_charged: 2, message_id: 'm1' });
        return { replay: false };
    };
    for (const was of ['insufficient_balance', 'connection_saved', 'stop_unsure']) await run({ active: A, turn: watched(was), kept: { 'chat-a': was } });
    // A page reload between the press and the start must not find "Your message was not sent" beside an empty box.
    assert.deepEqual(at.insufficient_balance, { beforeStart: [], afterStart: [] });
    assert.deepEqual(at.connection_saved, { beforeStart: [], afterStart: [] });
    assert.deepEqual(at.stop_unsure, { beforeStart: ['chat-a'], afterStart: [] }, 'it would find the warning, which is still true');
});

test('the warning is looked for where the text goes back to: under New chat when the chat is gone', async () => {
    // The chat was deleted while the message was on its way, and the message was then refused: its text goes under New
    // chat, so the warning that must not be replaced is the one kept there. The screen has fallen back to New chat.
    const gone = await run({ active: A, turn: refused(tooFast(), (p) => p.deletes('chat-a')), kept: { [NEW_CHAT]: 'stop_unsure' } });
    assert.deepEqual([gone.kept(), gone.log.notices, gone.log.saved], [{ [NEW_CHAT]: 'stop_unsure' }, [null, said('rate_limited', 'stop_unsure')], { [NEW_CHAT]: TEXT }]);
    // A warning kept for the chat that was deleted is not carried to New chat: it was about a chat the person chose to
    // delete (the screen forgets it with the chat). The refusal is kept with the text, as any notice is.
    const own = await run({ active: A, turn: refused(tooFast(), (p) => p.deletes('chat-a')), kept: { 'chat-a': 'stop_unsure' } });
    assert.deepEqual([own.kept(), own.log.notices], [{ [NEW_CHAT]: 'rate_limited' }, [null, 'rate_limited']]);
});

test('a message known to have gone out forgets the warning wherever the person is', async () => {
    // A replay, and a Stop before the reply started whose turn was found: neither reads the chat again while another
    // chat is on screen, and both still say the message went out.
    for (const how of [{ turn: async (_args, person) => { person.opens('chat-b'); return { replay: true }; } }, { turn: async (_args, person) => { person.opens('chat-b'); throw stopped(); }, settle: 'saved' }]) {
        const storage = await stoppedUnsure();
        const { log } = await run({ active: A, storage, ...how });
        assert.deepEqual([readNotice(storage, ME, 'chat-a'), log.opened, log.notices], [null, [], [null]]);
    }
});

test('refused after the chat page was left, with a warning kept: the warning stays and the text waits in its chat', async () => {
    const { log, kept } = await run({ active: A, turn: refused(noCredits(), (p) => p.leavesThePage()), kept: { 'chat-a': 'stop_unsure' } });
    assert.deepEqual([kept(), log.notices, log.added, log.box], [{ 'chat-a': 'stop_unsure' }, [null], { 'chat-a': TEXT }, ['']]);
});

test('refused while the person is in another chat, with a warning kept: the warning stays, and nothing is said in the chat on screen', async () => {
    // One notice is kept per chat and the warning is the one that must not be lost, so why this message did not go is said nowhere.
    const { log, kept } = await run({ active: A, turn: refused(tooFast(), toB), kept: { 'chat-a': 'stop_unsure' } });
    assert.deepEqual([kept(), log.notices, log.added, log.box], [{ 'chat-a': 'stop_unsure' }, [null], { 'chat-a': TEXT }, ['']]);
    // Another chat pressed and still loading: the text goes in the box that is still on screen, and no notice is set over a chat that is leaving.
    const leaving = await run({ active: A, turn: refused(tooFast(), (p) => p.press('chat-b')), kept: { 'chat-a': 'stop_unsure' } });
    assert.deepEqual([leaving.kept(), leaving.log.notices, leaving.log.box], [{ 'chat-a': 'stop_unsure' }, [null], ['', TEXT]]);
});

test('a notice the message keeps under a chat made for it takes the place of the warning that waited under New chat', async () => {
    // Stop before the reply started, not settled: the new chat is kept, with the text and its own warning. What waited under New
    // chat was about the message before, and New chat's box is empty now: left there, it would be shown beside nothing.
    const { log, kept } = await run({ active: null, turn: stopBeforeStart, settle: 'pending', kept: { [NEW_CHAT]: 'reply_not_saved' } });
    assert.deepEqual([kept(), log.dropped, log.saved], [{ made: 'stop_unsure' }, [NEW_CHAT], { made: TEXT }]);
});
