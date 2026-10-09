// send() run for real, with the screen and the network faked (ADR-0067). The other chat tests pin send() by reading
// its source, which cannot show what a whole ending does when the person is somewhere else. The harness that loads
// the hook and plays the server and the person is tests/chatSendFlow.harness.mjs (it was the top of this file until
// tests/chatSendRefused.test.mjs needed it too).
// `kept` is the notice store as the hook sees it: one code per chat, written by keepNotice and forgotten by dropNotice.
// It took the place of the notices the view held in memory (`held()` in these tests until then): every ending that
// held a notice now keeps it, and an ending in the chat on screen keeps its notice as well as showing it.
// A kept notice is forgotten when the next message from its chat is known to have gone out, not at the press, and a
// message that is refused before it starts does not replace a warning about Credits: tests/chatSendRefused.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NEW_CHAT } from '../app/veyrnox/_lib/chatLocal.js';
import { onScreen } from '../app/veyrnox/_lib/chatSendHome.js';
import { A, GatewayError, TEXT, afterReload, cutBeforeText, memory, refused, reply, run, stopAfterText, stopBeforeText, toB } from './chatSendFlow.harness.mjs';

// ---- staying in the chat: as before ----

test('stayed, the reply was saved: the chat is read again and the list refreshed, with no notice', async () => {
    const { log, kept } = await run({ active: A, turn: reply() });
    assert.deepEqual(log.opened, ['chat-a']);
    assert.deepEqual(log.notices, [null], 'only the clearing as the message was sent');
    assert.deepEqual(log.box, [''], 'the box was emptied and nothing was put back');
    assert.deepEqual([log.refreshed, log.quietReads, log.imagesCleared], [1, 0, 1]);
    assert.deepEqual(kept(), {});
});

test('stayed, Stop before any text and not settled: the text is back in the box with the notice, and the chat is kept', async () => {
    const { log, bubbles, kept } = await run({ active: A, turn: stopBeforeText(), settle: 'pending' });
    assert.deepEqual(log.box, ['', TEXT]);
    assert.deepEqual(log.notices, [null, 'stop_unsure']);
    assert.deepEqual(log.saved, { 'chat-a': TEXT });
    // The money case. The text is stored, so it is back in the box after a page reload: the notice is stored beside it.
    assert.deepEqual(kept(), { 'chat-a': 'stop_unsure' }, 'on screen and kept: a reload must not leave the text without it');
    assert.deepEqual([log.deleted, log.opened, log.imagesCleared, bubbles()], [[], [], 0, []]);
});

test('stayed, a new chat, the connection dropped and nothing was kept: the chat goes and the text is under New chat', async () => {
    const { log, view, kept } = await run({ active: null, turn: cutBeforeText(), settle: 'nothing' });
    assert.deepEqual(log.activeSet, ['made', null], 'the new chat was on screen, then closed');
    assert.deepEqual(log.deleted, ['made']);
    assert.deepEqual(log.box, ['', TEXT]);
    assert.deepEqual(log.saved, { [NEW_CHAT]: TEXT });
    assert.deepEqual(log.notices, [null, 'connection_refunded']);
    assert.deepEqual(kept(), { [NEW_CHAT]: 'connection_refunded' }, 'beside the text, where a reload shows both');
    assert.equal(onScreen(view, NEW_CHAT), true);
});

test('stayed, refused before it started: text back, the refusal shown, a chat made for it deleted', async () => {
    const { log, kept } = await run({ active: null, turn: refused(new GatewayError('no', { status: 402, code: 'insufficient_balance' })) });
    assert.deepEqual(log.box, ['', TEXT]);
    assert.deepEqual(log.notices, [null, 'insufficient_balance']);
    assert.deepEqual(log.deleted, ['made']);
    assert.deepEqual([kept(), log.keptWith[NEW_CHAT]], [{ [NEW_CHAT]: 'insufficient_balance' }, { credits: 2 }], 'kept with the price its words need');
    // Any other refusal was shown by the screen's fail() while its chat was on screen, and kept nowhere. It is told
    // like every other notice now, so it is kept with the text it gives back. The words are the same.
    const plain = await run({ active: A, turn: refused(new GatewayError('no', { status: 429, code: 'rate_limited' })) });
    assert.deepEqual([plain.log.notices, plain.log.failures, plain.log.deleted, plain.log.box], [[null, 'rate_limited'], [], [], ['', TEXT]]);
    assert.deepEqual(plain.kept(), { 'chat-a': 'rate_limited' });
    // A closed chat or a signed-out reader is about the whole page: said by the screen, and not kept with any chat.
    const out = await run({ active: A, turn: refused(new GatewayError('no', { status: 401, code: 'unauthenticated' })) });
    assert.deepEqual([out.log.failures, out.log.notices, out.kept()], [['unauthenticated'], [null], {}]);
    // A failure with no code at all still leaves something with the text (the store keeps it as 'unknown').
    const bare = await run({ active: A, turn: refused(new Error('boom')) });
    assert.deepEqual([bare.log.failures, bare.log.box, Object.keys(bare.kept())], [[], ['', TEXT], ['chat-a']]);
});

// ---- in another chat when the send ended ----

test('elsewhere, the reply was saved: nothing on screen changes, and the list is read quietly', async () => {
    const { log, kept } = await run({ active: A, turn: reply(toB), listDown: true });
    assert.deepEqual(log.opened, [], 'no pull back to the chat the message was sent in');
    assert.deepEqual(log.notices, [null]);
    assert.deepEqual(log.box, ['']);
    assert.deepEqual([log.refreshed, log.quietReads, log.failures], [0, 1, []], 'a list read that fails says nothing in another chat');
    assert.deepEqual(kept(), {});
});

test('elsewhere, Stop and the job says saved, or charged but not stored', async () => {
    const saved = await run({ active: A, turn: stopAfterText(toB), settle: 'saved' });
    assert.deepEqual([saved.log.opened, saved.log.notices, saved.kept()], [[], [null], {}]);
    const unsaved = await run({ active: A, turn: stopAfterText(toB), settle: 'unsaved' });
    assert.deepEqual([unsaved.log.opened, unsaved.log.notices], [[], [null]]);
    assert.deepEqual(unsaved.kept(), { 'chat-a': 'reply_not_saved' }, 'the Credits were used: it waits for the chat');
});

test('elsewhere, Stop before any text and not settled: the text waits in its chat with the notice that says a reply may still land', async () => {
    const { log, kept } = await run({ active: A, turn: stopBeforeText(toB), settle: 'pending', images: [{ asset: 'x' }] });
    assert.deepEqual(log.box, [''], 'nothing goes in the box of the chat on screen');
    assert.deepEqual(log.added, { 'chat-a': TEXT });
    assert.deepEqual(log.saved, {});
    assert.deepEqual(kept(), { 'chat-a': 'stop_unsure' });
    assert.deepEqual([log.notices, log.deleted, log.imagesCleared], [[null], [], 1]);
});

test('elsewhere, a chat made for the message and nothing kept: it is deleted, and text and notice wait under New chat', async () => {
    const { log, kept, view } = await run({ active: null, turn: cutBeforeText(toB), settle: 'nothing' });
    assert.deepEqual(log.activeSet, ['made'], 'the screen is not told to close a chat while another is on it');
    assert.deepEqual(log.deleted, ['made']);
    assert.deepEqual(log.added, { [NEW_CHAT]: TEXT });
    assert.deepEqual(kept(), { [NEW_CHAT]: 'connection_refunded' });
    assert.deepEqual([log.box, log.notices], [[''], [null]]);
    assert.equal(onScreen(view, 'chat-b'), true);
});

test('elsewhere, a dropped connection: saved says so for when the chat is opened, not settled says Credits may have been used', async () => {
    const cutAfterText = async ({ onEvent }, person) => { onEvent('start', { job_id: 'j' }); onEvent('delta', { text: 'A lamp' }); person.opens('chat-b'); throw new TypeError('network error'); };
    const saved = await run({ active: A, turn: cutAfterText, settle: 'saved' });
    assert.deepEqual([saved.log.opened, saved.kept()], [[], { 'chat-a': 'connection_saved' }]);
    const pending = await run({ active: A, turn: cutAfterText, settle: 'pending' });
    assert.deepEqual([pending.log.opened, pending.kept(), pending.log.added], [[], { 'chat-a': 'connection_lost' }, {}]);
});

test('elsewhere, refused before it started: the refusal waits with the text, but a closed chat or a signed-out reader is said at once', async () => {
    const { log, kept } = await run({ active: A, turn: refused(new GatewayError('no', { status: 429, code: 'rate_limited' }), toB) });
    assert.deepEqual([log.failures, log.notices, log.added, kept()], [[], [null], { 'chat-a': TEXT }, { 'chat-a': 'rate_limited' }]);
    const signedOut = await run({ active: A, turn: refused(new GatewayError('no', { status: 401, code: 'unauthenticated' }), toB) });
    assert.deepEqual([signedOut.log.failures, signedOut.kept()], [['unauthenticated'], {}]);
});

test('a chat made for the message goes on screen with its bubbles only if the person is still where they sent it from', async () => {
    const stayed = await run({ active: null, turn: reply() });
    assert.deepEqual(stayed.log.activeSet, ['made'], 'still on the chat that had not started: it becomes the new chat');
    assert.deepEqual(stayed.bubbles(), ['user:complete', 'assistant:streaming'], 'the fake open() does not replace them');
    assert.deepEqual(stayed.log.opened, ['made']);
    const left = await run({ active: null, turn: reply(), whileMaking: toB });
    assert.deepEqual(left.log.activeSet, [], 'another chat was opened while it was made: it only joins the list');
    assert.deepEqual([left.bubbles(), left.log.opened, left.log.notices], [[], [], [null]]);
});

// ---- on the way somewhere ----

test('another chat pressed and still loading: the text goes in the box that is still on screen and in its draft, the notice waits', async () => {
    const { log, kept } = await run({ active: A, turn: stopBeforeText((p) => p.press('chat-b')), settle: 'pending' });
    assert.deepEqual(log.saved, { 'chat-a': TEXT });
    assert.deepEqual(log.box, ['', TEXT], 'so that if chat b does not load, the message is in front of them');
    assert.deepEqual(kept(), { 'chat-a': 'stop_unsure' }, 'chat b arriving would wipe a notice set now; after a failed read the screen shows the kept one');
    assert.deepEqual(log.notices, [null]);
});

test('on the way back to the chat when the reply was saved: it is read again', async () => {
    const { log } = await run({ active: A, turn: reply((p) => { p.opens('chat-b'); p.press('chat-a'); }) });
    assert.deepEqual(log.opened, ['chat-a'], 'the read that is already out may predate the save');
});

// ---- the chat page was left ----

test('the page was left, Stop before any text and not settled: the text is not kept, and the notice waits for the chat', async () => {
    const { log, kept } = await run({ active: A, turn: stopBeforeText((p) => p.leavesThePage()), settle: 'pending' });
    // Unchanged: the text is not given back here. It was not, because the notice had nowhere to go; whether it should be
    // now that the notice is kept is a separate decision.
    assert.deepEqual([log.saved, log.added], [{}, {}], 'a turn that may still be saved and charged is never offered again without the warning');
    assert.deepEqual(log.box, ['']);
    assert.deepEqual([log.opened, log.deleted, log.notices], [[], [], [null]]);
    // It was held on a view that nothing would read again, and so lost. Stored, it is shown when the chat is opened.
    assert.deepEqual(kept(), { 'chat-a': 'stop_unsure' }, 'the person is told a reply may still land and use Credits');
});

test('the page was left and nothing was kept: the turn is over, so the text waits in its chat', async () => {
    const { log, kept } = await run({ active: A, turn: stopBeforeText((p) => p.leavesThePage()), settle: 'nothing' });
    assert.deepEqual(log.added, { 'chat-a': TEXT });
    assert.deepEqual([log.box, log.opened], [[''], []]);
    assert.deepEqual(kept(), {}, 'Stop with nothing kept says nothing, here as on screen');
    // A dropped connection with nothing kept does say so, and that waits with the text for the chat to be opened again.
    const cut = await run({ active: A, turn: cutBeforeText((p) => p.leavesThePage()), settle: 'nothing' });
    assert.deepEqual([cut.log.added, cut.log.notices, cut.kept()], [{ 'chat-a': TEXT }, [null], { 'chat-a': 'connection_refunded' }]);
});

// ---- the person deleted the chat while the reply streamed ----

test('the sent chat was deleted by the person: what the server says about the reply is shown under New chat', async () => {
    const turn = async ({ onEvent }, person) => {
        onEvent('start', { job_id: 'j' }); onEvent('delta', { text: 'A lamp' });
        person.deletes('chat-a');
        onEvent('error', { error: 'reply_not_saved' }); onEvent('done', { status: 'completed', credits_charged: 2 });
        return { replay: false };
    };
    const { log, view, kept } = await run({ active: A, turn });
    assert.equal(onScreen(view, NEW_CHAT), true);
    assert.deepEqual(log.opened, [], 'a chat that is gone is not read again');
    // Set before the reload and again after it, as it always was; here there is no chat left to reload.
    assert.deepEqual(log.notices, [null, 'reply_not_saved', 'reply_not_saved'], 'charged and not stored: said where the person is, which is New chat');
    assert.deepEqual(kept(), { [NEW_CHAT]: 'reply_not_saved' }, 'kept once, by the second: under New chat, never under a chat that is gone');
});

// ---- what is kept, and when it is forgotten ----

test('a message that goes out from a chat forgets the notice kept for that chat, and no other', async () => {
    const waiting = { 'chat-a': 'stop_unsure', 'chat-b': 'connection_lost', [NEW_CHAT]: 'connection_refunded' };
    const fromA = await run({ active: A, turn: reply(), kept: waiting });
    assert.deepEqual(fromA.log.dropped, ['chat-a']);
    assert.deepEqual(fromA.kept(), { 'chat-b': 'connection_lost', [NEW_CHAT]: 'connection_refunded' });
    // From a chat that has not started: the notice under New chat. The chat made for the message has none.
    const fromNew = await run({ active: null, turn: reply(), kept: waiting });
    assert.deepEqual(fromNew.log.dropped, [NEW_CHAT]);
    assert.deepEqual(fromNew.kept(), { 'chat-a': 'stop_unsure', 'chat-b': 'connection_lost' });
});

test('a press that sends nothing forgets nothing', async () => {
    const { log, kept } = await run({ active: A, turn: reply(), kept: { 'chat-a': 'stop_unsure' }, text: '   ' });
    assert.deepEqual([log.dropped, log.notices, log.box], [[], [], []]);
    assert.deepEqual(kept(), { 'chat-a': 'stop_unsure' });
});

test('the same message sent again and ending the same way keeps the notice again', async () => {
    // The person was told, pressed Send anyway, and Stop came before any text once more: the warning is back with the text.
    const { log, kept } = await run({ active: A, turn: stopBeforeText(), settle: 'pending', kept: { 'chat-a': 'stop_unsure' } });
    assert.deepEqual(log.dropped, ['chat-a']);
    assert.deepEqual([log.notices, kept()], [[null, 'stop_unsure'], { 'chat-a': 'stop_unsure' }]);
});

test('a reply that was saved with a stream error: its notice is on screen for the reload only, and is not kept', async () => {
    // The reload shows the saved messages with their real status and clears the notice. Were it kept, the chat the
    // reload reads would arrive with it and it would stay there until the next message.
    const cutOff = async ({ onEvent }) => {
        onEvent('start', { job_id: 'j' }); onEvent('delta', { text: 'A lamp' });
        onEvent('error', { error: 'provider_cut_off' }); onEvent('done', { status: 'completed', credits_charged: 2, message_id: 'm1' });
        return { replay: false };
    };
    const { log, kept } = await run({ active: A, turn: cutOff });
    assert.deepEqual([log.notices, log.opened, kept()], [[null, 'provider_cut_off'], ['chat-a'], {}]);
    // Nothing was kept of the reply: the text goes back, and that notice does stay with it.
    const nothing = async ({ onEvent }) => { onEvent('start', { job_id: 'j' }); onEvent('error', { error: 'provider_cut_off' }); onEvent('done', { status: 'failed' }); return { replay: false }; };
    const back = await run({ active: A, turn: nothing });
    assert.deepEqual([back.log.notices, back.log.box, back.kept()], [[null, 'provider_cut_off'], ['', TEXT], { 'chat-a': 'provider_cut_off' }]);
});

test('a chat made for the message and kept: its text and its notice are both under the new chat, not under New chat', async () => {
    // Sent from a chat that has not started, Stop before any text, not settled: the chat is kept for a reply that may still land.
    const { log, kept } = await run({ active: null, turn: stopBeforeText(), settle: 'pending' });
    assert.deepEqual([log.activeSet, log.deleted, log.dropped], [['made'], [], [NEW_CHAT]]);
    assert.deepEqual([log.saved, kept(), log.notices], [{ made: TEXT }, { made: 'stop_unsure' }, [null, 'stop_unsure']]);
    // The same with another chat opened first: neither is on screen, both wait under the new chat.
    const away = await run({ active: null, turn: stopBeforeText(toB), settle: 'pending' });
    assert.deepEqual([away.log.added, away.kept(), away.log.notices], [{ made: TEXT }, { made: 'stop_unsure' }, [null]]);
});

// ---- through the real store: what a page reload finds ----

test('after a reload the chat has its text and its notice: Stop before any text, in the chat and from another', async () => {
    for (const meanwhile of [undefined, toB]) {
        const storage = memory();
        await run({ active: A, turn: stopBeforeText(meanwhile), settle: 'pending', storage });
        assert.deepEqual(afterReload(storage, 'chat-a'), { box: TEXT, notice: { code: 'stop_unsure' } }, 'the money case: never the text without the warning');
        assert.deepEqual(afterReload(storage, 'chat-b'), { box: '', notice: null }, 'and neither in another chat');
        // Sent again and it runs to its end: the warning is gone, and stays gone.
        await run({ active: A, turn: reply(), storage });
        assert.equal(afterReload(storage, 'chat-a').notice, null);
    }
});

test('after a reload a refusal still names its price, and a chat that is gone leaves both under New chat', async () => {
    const storage = memory();
    await run({ active: null, turn: refused(new GatewayError('no', { status: 402, code: 'insufficient_balance' })), storage });
    assert.deepEqual(afterReload(storage, NEW_CHAT), { box: TEXT, notice: { code: 'insufficient_balance', credits: 2 } });
    assert.deepEqual(afterReload(storage, 'made'), { box: '', notice: null }, 'nothing under the chat that was made for it and deleted');
    // A failure with no code leaves the general notice with the text, never nothing.
    const bare = memory();
    await run({ active: A, turn: refused(new Error('boom')), storage: bare });
    assert.deepEqual(afterReload(bare, 'chat-a'), { box: TEXT, notice: { code: 'unknown' } });
});

test('after a reload a notice that came with no text is there too, and one that was never kept is not', async () => {
    const storage = memory();
    await run({ active: A, turn: stopAfterText(), settle: 'pending', storage });
    assert.deepEqual(afterReload(storage, 'chat-a'), { box: '', notice: { code: 'stop_saving' } });
    const clean = memory();
    await run({ active: A, turn: reply(), storage: clean });
    assert.deepEqual(afterReload(clean, 'chat-a'), { box: '', notice: null });
});

test('Stop after text, still being saved: the notice is kept with the chat, and no text is given back', async () => {
    const { log, kept } = await run({ active: A, turn: stopAfterText(), settle: 'pending' });
    assert.deepEqual([log.notices, log.box, log.saved, kept()], [[null, 'stop_saving'], [''], {}, { 'chat-a': 'stop_saving' }]);
});
