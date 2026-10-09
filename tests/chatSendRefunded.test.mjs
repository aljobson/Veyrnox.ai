// A later message that starts and then ends with nothing charged (ADR-0067), run through send() itself with the
// harness of tests/chatSendFlow.test.mjs.
// PR 730 left one case for the owner. Stop before any text with the turn not settled keeps `stop_unsure` with the
// given-back text; the person presses Send again; that second message starts, and the warning was forgotten at
// `start`; the second then ends with nothing kept and its Credits returned (Stop, a dropped connection, a reply that
// failed). Its text came back with that ending's own "No Credits were used", or with nothing after Stop, and with
// nothing about the first send, which may still be saved and use Credits if its turn is slow to settle.
// Two changes close it. A kept warning (one of the WARNINGS) is no longer forgotten when the reply starts: only by an
// ending that accounts for Credits itself, which is the message being saved to the chat (read again when it is on
// screen) or a warning of the message's own. And an ending that gives the text back with nothing charged is told the way a refusal is
// (tests/chatSendRefused.test.mjs): the warning stays kept, and both are said on screen, the ending first.

import test from 'node:test';
import assert from 'node:assert/strict';
import { NEW_CHAT, writeNotice } from '../app/veyrnox/_lib/chatLocal.js';
import { A, ME, TEXT, WARNINGS, afterReload, cutBeforeText, memory, reply, run, stopBeforeText, toB } from './chatSendFlow.harness.mjs';

/** The fake words for an ending said together with the warning it must not replace (chatUnchargedCopy in run()). */
const said = (ending, warning) => `${ending}, and before that ${warning}`;
/** The reply started, then the server said it failed with nothing kept: the error it names, then `done`. */
const failedWith = (error, meanwhile = () => {}) => async ({ onEvent }, person) => {
    onEvent('start', { job_id: 'job-2' }); meanwhile(person); onEvent('error', { error }); onEvent('done', { status: 'failed', credits_charged: 0 });
    return { replay: false };
};
/**
 * Every way a message that started can end with its text given back and nothing charged: what the ending says of
 * itself, its name, and how the server and the person play it. `meanwhile` is what the person does once it has started.
 * Stop is the one that says nothing on its own: `stop_refunded` is said only beside a warning.
 */
const refunded = (meanwhile) => [
    ['stop_refunded', 'Stop, and the job failed and was refunded', { turn: stopBeforeText(meanwhile), settle: 'nothing' }],
    ['connection_refunded', 'a dropped connection with nothing kept', { turn: cutBeforeText(meanwhile), settle: 'nothing' }],
    ['provider_cut_off', 'a reply the provider cut off before any text', { turn: failedWith('provider_cut_off', meanwhile) }],
    ['provider_unavailable', 'a provider that gave nothing', { turn: failedWith('provider_unavailable', meanwhile) }],
    ['turn_not_saved', 'a turn that could not be finished', { turn: failedWith('turn_not_saved', meanwhile) }],
];
/** Chat a after Stop before any text with the turn not settled: its text is in its box and the warning is stored. */
async function stoppedUnsure() {
    const storage = memory();
    await run({ active: A, turn: stopBeforeText(), settle: 'pending', storage });
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: TEXT, notice: { code: 'stop_unsure' } });
    return storage;
}

test('Stop before any text, sent again, and the second message starts and ends with nothing charged: the warning is still kept with the text, and both are said', async () => {
    for (const [code, name, how] of refunded()) {
        const storage = await stoppedUnsure();
        const { log } = await run({ active: A, storage, ...how });
        // For the person who never reloads: what happened to this message, and that the one before it may still use Credits.
        assert.deepEqual(log.notices, [null, said(code, 'stop_unsure')], name);
        assert.deepEqual([log.box, log.opened, log.deleted, log.failures], [['', TEXT], [], [], []], name);
        // And after a page reload. The money rule: the text is never in the box without the warning.
        assert.deepEqual(afterReload(storage, 'chat-a'), { box: TEXT, notice: { code: 'stop_unsure' } }, name);
    }
});

test('while the second reply arrives the warning is still kept, so a page reload in the middle finds it; a reply that is saved forgets it', async () => {
    const storage = await stoppedUnsure();
    const seen = [];
    const look = () => seen.push(afterReload(storage, 'chat-a'));
    const goes = async ({ onEvent }) => {
        look(); onEvent('start', { job_id: 'job-2' }); look(); onEvent('delta', { text: 'A lamp' }); look();
        onEvent('done', { status: 'completed', credits_charged: 2, message_id: 'm2' });
        return { replay: false };
    };
    const sent = await run({ active: A, storage, turn: goes });
    // The box is empty: the message has gone out. The warning is still true of the message before it, and nothing has
    // accounted for that one yet. A page reload here also cuts this reply off, which the server saves like a Stop.
    assert.deepEqual(seen, Array(3).fill({ box: '', notice: { code: 'stop_unsure' } }), 'before the reply starts, as it starts, and while its text arrives');
    // The reply was saved: the chat is read again, without the warning, and it stays gone.
    assert.deepEqual([sent.log.notices, sent.log.opened, sent.log.shownOnOpen], [[null], ['chat-a'], [null]]);
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: '', notice: null });
});

test('the whole sequence: stopped, sent again and refunded, reloaded, refunded another way, then the message goes out and the warning is forgotten', async () => {
    const storage = await stoppedUnsure();
    await run({ active: A, storage, turn: stopBeforeText(), settle: 'nothing' });
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: TEXT, notice: { code: 'stop_unsure' } });
    const again = await run({ active: A, storage, turn: failedWith('provider_unavailable') });
    assert.deepEqual(again.log.notices, [null, said('provider_unavailable', 'stop_unsure')], 'a third send that is refunded says the same two things');
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: TEXT, notice: { code: 'stop_unsure' } });
    const sent = await run({ active: A, storage, turn: reply() });
    assert.deepEqual([sent.log.notices, sent.log.opened, sent.log.shownOnOpen], [[null], ['chat-a'], [null]]);
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: '', notice: null });
});

test('every such ending leaves each of the four warnings where it was, and any other notice went at the press as before', async () => {
    for (const was of WARNINGS) {
        for (const [code, name, how] of refunded()) {
            const { log, kept } = await run({ active: A, ...how, kept: { 'chat-a': was, 'chat-b': 'connection_lost' } });
            assert.deepEqual([kept(), log.dropped], [{ 'chat-a': was, 'chat-b': 'connection_lost' }, []], `${was}, then ${name}`);
            assert.deepEqual([log.notices, log.box], [[null, said(code, was)], ['', TEXT]], `${was}, then ${name}`);
        }
    }
    // Every other notice is about a message that is settled, and was forgotten when Send was pressed. The ending then
    // keeps what it kept before this change: its own notice, or nothing after Stop.
    for (const was of ['connection_saved', 'connection_refunded', 'insufficient_balance', 'rate_limited', 'provider_cut_off', 'unknown']) {
        for (const [code, name, how] of refunded()) {
            const own = code === 'stop_refunded' ? null : code;
            const { log, kept } = await run({ active: A, ...how, kept: { 'chat-a': was } });
            assert.deepEqual([kept(), log.notices, log.dropped], [own ? { 'chat-a': own } : {}, own ? [null, own] : [null], ['chat-a']], `${was}, then ${name}`);
        }
    }
});

test('Stop with nothing kept and no warning before it still says nothing, and keeps nothing', async () => {
    const { log, kept } = await run({ active: A, turn: stopBeforeText(), settle: 'nothing' });
    assert.deepEqual([log.notices, log.box, kept()], [[null], ['', TEXT], {}]);
    const storage = memory();
    await run({ active: A, turn: stopBeforeText(), settle: 'nothing', storage });
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: TEXT, notice: null });
});

test('the server says the reply was stopped with nothing charged and names no error: told as Stop with nothing kept', async () => {
    const canceled = async ({ onEvent }) => { onEvent('start', { job_id: 'j' }); onEvent('done', { status: 'canceled', credits_charged: 0 }); return { replay: false }; };
    const held = await run({ active: A, turn: canceled, kept: { 'chat-a': 'stop_unsure' } });
    assert.deepEqual([held.kept(), held.log.notices, held.log.box], [{ 'chat-a': 'stop_unsure' }, [null, said('stop_refunded', 'stop_unsure')], ['', TEXT]]);
    const alone = await run({ active: A, turn: canceled });
    assert.deepEqual([alone.kept(), alone.log.notices, alone.log.box], [{}, [null], ['', TEXT]]);
});

test('a warning that waits under New chat stays there when a chat is made for the next message and that message is refunded', async () => {
    for (const [code, name, how] of refunded()) {
        // The chat the first message was sent in was deleted while its reply was awaited, so its text and its warning are under New chat.
        const storage = memory();
        await run({ active: A, turn: stopBeforeText((p) => p.deletes('chat-a')), settle: 'pending', storage });
        assert.deepEqual(afterReload(storage, NEW_CHAT), { box: TEXT, notice: { code: 'stop_unsure' } });
        // Sent again from New chat: a chat is made, the reply starts, and it ends with nothing. The chat goes, and the
        // text is back under New chat beside the warning.
        const { log } = await run({ active: null, storage, ...how });
        assert.deepEqual([log.notices, log.deleted, log.activeSet], [[null, said(code, 'stop_unsure')], ['made'], ['made', null]], name);
        assert.deepEqual(afterReload(storage, NEW_CHAT), { box: TEXT, notice: { code: 'stop_unsure' } }, name);
        assert.deepEqual(afterReload(storage, 'made'), { box: '', notice: null }, name);
    }
});

test('the warning is looked for where the text goes back to: under New chat when the chat was deleted while the reply arrived', async () => {
    const deleted = failedWith('provider_cut_off', (p) => p.deletes('chat-a'));
    const gone = await run({ active: A, turn: deleted, kept: { [NEW_CHAT]: 'stop_unsure' } });
    assert.deepEqual([gone.kept(), gone.log.notices, gone.log.saved], [{ [NEW_CHAT]: 'stop_unsure' }, [null, said('provider_cut_off', 'stop_unsure')], { [NEW_CHAT]: TEXT }]);
    // A warning kept for the chat that was deleted is not carried to New chat (the screen forgets it with the chat):
    // the ending's own notice is kept with the text, as any notice is.
    const own = await run({ active: A, turn: deleted, kept: { 'chat-a': 'stop_unsure' } });
    assert.deepEqual([own.kept(), own.log.notices], [{ [NEW_CHAT]: 'provider_cut_off' }, [null, 'provider_cut_off']]);
});

test('refunded while the person is somewhere else: the warning stays, the text waits in its chat, and nothing is said on the screen they are on', async () => {
    // One notice is kept per chat and the warning is the one that must not be lost, so what this message ended with is said nowhere.
    for (const [, name, how] of refunded(toB)) {
        const { log, kept } = await run({ active: A, ...how, kept: { 'chat-a': 'stop_unsure' } });
        assert.deepEqual([kept(), log.notices, log.added, log.box], [{ 'chat-a': 'stop_unsure' }, [null], { 'chat-a': TEXT }, ['']], `in another chat: ${name}`);
    }
    // The chat page was left: the turn is over, so the text waits in its chat, beside the warning.
    for (const [, name, how] of refunded((p) => p.leavesThePage())) {
        const { log, kept } = await run({ active: A, ...how, kept: { 'chat-a': 'stop_unsure' } });
        assert.deepEqual([kept(), log.notices, log.added, log.box], [{ 'chat-a': 'stop_unsure' }, [null], { 'chat-a': TEXT }, ['']], `the page was left: ${name}`);
    }
    // Another chat pressed and still loading: the text goes in the box that is still on screen, and no notice is set over a chat that is leaving.
    for (const [, name, how] of refunded((p) => p.press('chat-b'))) {
        const { log, kept } = await run({ active: A, ...how, kept: { 'chat-a': 'stop_unsure' } });
        assert.deepEqual([kept(), log.notices, log.box], [{ 'chat-a': 'stop_unsure' }, [null], ['', TEXT]], `on the way to another chat: ${name}`);
    }
});

test('through the real store, from another chat: the text is added to the chat it was sent from, where the warning still is', async () => {
    const storage = await stoppedUnsure();
    await run({ active: A, storage, turn: cutBeforeText(toB), settle: 'nothing' });
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: TEXT, notice: { code: 'stop_unsure' } });
    assert.deepEqual(afterReload(storage, 'chat-b'), { box: '', notice: null }, 'and nothing lands in the chat on screen');
    // A warning kept for another chat is not this message's to keep or to say.
    const other = memory();
    writeNotice(other, ME, 'chat-b', 'connection_lost');
    const { log } = await run({ active: A, storage: other, turn: cutBeforeText(), settle: 'nothing' });
    assert.deepEqual([log.notices, afterReload(other, 'chat-a'), afterReload(other, 'chat-b').notice], [[null, 'connection_refunded'], { box: TEXT, notice: { code: 'connection_refunded' } }, { code: 'connection_lost' }]);
});

test('the chat list is read before the ending is said, so a list read that fails does not cover what was just said', async () => {
    // The screen says so when its list read fails, over whatever notice is on it. After Stop and after a dropped
    // connection the list was already read first. After a reply that failed it was read last, which was harmless
    // while that ending had only its own notice to lose: now the warning about the message before is said there too
    // (the independent review of this change).
    for (const [code, name, how] of refunded()) {
        const { log, kept } = await run({ active: A, ...how, kept: { 'chat-a': 'stop_unsure' }, listFails: true });
        assert.deepEqual([log.notices, kept()], [[null, 'list_failed', said(code, 'stop_unsure')], { 'chat-a': 'stop_unsure' }], name);
    }
    // With no warning kept the ending's own notice is the last word too.
    const alone = await run({ active: A, turn: failedWith('provider_cut_off'), listFails: true });
    assert.deepEqual([alone.log.notices, alone.kept()], [[null, 'list_failed', 'provider_cut_off'], { 'chat-a': 'provider_cut_off' }]);
    // A chat made for the message is deleted after the list is read, not before: a list read after the delete was
    // sent could bring the chat back.
    const made = await run({ active: null, turn: failedWith('provider_cut_off'), kept: { [NEW_CHAT]: 'stop_unsure' }, listFails: true });
    assert.deepEqual([made.log.notices, made.log.deleted, made.log.refreshed], [[null, 'list_failed', said('provider_cut_off', 'stop_unsure')], ['made'], 1]);
});
