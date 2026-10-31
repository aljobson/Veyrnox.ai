// F-05: a shared browser. A chat send that finishes after the signed-in user switched accounts must not write the
// sender's unsent text (or its notice) under the new account's namespace. send() captures the account that began the
// send and fences every late storage write against it; the owner-check itself is the pure draftWriteAllowed helper.
// Run with: node --test --test-concurrency=2 tests/chatSendAccountSwitch.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NEW_CHAT, readDraft, readNotice, draftWriteAllowed } from '../app/veyrnox/_lib/chatLocal.js';
import { A, GatewayError, ME, TEXT, memory, refused, reply, run } from './chatSendFlow.harness.mjs';

const B = 'user-b';
/** A send that reaches the server and is refused before anything is charged: the text is given back (giveBack(true)). */
const provider = () => new GatewayError('the provider gave nothing', { status: 502, code: 'provider_unavailable' });
const CANON = 'You are a continuity canon.';

test('a send refused after the account switched writes nothing under the new account', async () => {
    const storage = memory();
    // The person is signed in as A, sends, then switches to B while the request is in flight; then it is refused.
    await run({ active: A, storage, turn: refused(provider(), (person) => person.switchesAccount(B)) });
    assert.equal(readDraft(storage, B, 'chat-a'), '', "account B never receives account A's unsent text");
    assert.equal(readNotice(storage, B, 'chat-a'), null, "account B never receives account A's notice");
});

test('the same refusal with no switch still gives the sender their text back', async () => {
    const storage = memory();
    await run({ active: A, storage, turn: refused(provider()) });
    assert.equal(readDraft(storage, ME, 'chat-a'), TEXT, 'the normal same-account give-back is unaffected');
});

test('a new-chat send whose account switches during image preparation persists nothing under the new account', async () => {
    const storage = memory();
    // New chat with a local image; the person switches to B while the image is decoding (prepareImage awaits).
    const { log } = await run({
        active: null, storage, images: [{ file: 'photo.jpg' }], turn: reply(),
        duringPrepare: (person) => person.switchesAccount(B),
    });
    assert.equal(log.uploads, 0, "account A's image is never uploaded under account B's credentials");
    assert.equal(log.creates, 0, 'no thread is created under account B');
    assert.deepEqual(log.instructionsReady, [], 'no canon/instruction bind is attempted');
    assert.equal(readDraft(storage, B, NEW_CHAT), '', "account B's draft namespace is untouched");
    assert.equal(readNotice(storage, B, NEW_CHAT), null, "account B's notice namespace is untouched");
});

test('the same new-chat image send with no switch uploads and creates normally', async () => {
    const storage = memory();
    const { log } = await run({ active: null, storage, images: [{ file: 'photo.jpg' }], turn: reply() });
    assert.equal(log.uploads, 1, 'the image uploads for the sender');
    assert.equal(log.creates, 1, 'the thread is created for the sender');
});

test('an Oddling send whose account switches mid-send never binds the canon to the thread', async () => {
    let boundOwner = 'unset';
    const { log } = await run({
        active: null, turn: reply(), requiredInstructions: true, lockedInstructions: CANON,
        whileMaking: (person) => person.switchesAccount(B), // switch while the thread is being created
        onInstructionsReady: async (_id, owner) => { boundOwner = owner; return true; },
    });
    assert.deepEqual(log.instructionsReady, [], 'onInstructionsReady is never reached once the owner changed');
    assert.equal(boundOwner, 'unset', 'the canon-write path never runs under the new account');
});

test('an Oddling send with no switch binds the canon and is told who the sender is', async () => {
    let boundOwner = 'unset';
    const { log } = await run({
        active: null, turn: reply(), requiredInstructions: true, lockedInstructions: CANON,
        onInstructionsReady: async (_id, owner) => { boundOwner = owner; return true; },
    });
    assert.deepEqual(log.instructionsReady, ['made'], 'the bind runs for the sender');
    assert.equal(boundOwner, ME, 'the send owner captured at send start is passed to the canon-write path');
});

test('bindOddlingToThread refuses to write the canon when the account changed, and the hook passes the send owner', () => {
    const workspace = readFileSync(new URL('../app/veyrnox/_components/chat/ChatWorkspace.js', import.meta.url), 'utf8');
    const sender = readFileSync(new URL('../app/veyrnox/_components/chat/useChatSend.js', import.meta.url), 'utf8');
    assert.match(workspace, /const bindOddlingToThread = \(threadId, sendOwner\) => \{/);
    assert.match(workspace, /if \(sendOwner != null && sendOwner !== getStoredUserId\(\)\) return false;/,
        'the canon write refuses once the signed-in account differs from the send owner');
    assert.match(sender, /onInstructionsReady\(thread\.id, sendOwner\)/, 'the hook passes the captured send owner to the bind');
});

test('draftWriteAllowed permits a write only for the unchanged signed-in account', () => {
    assert.equal(draftWriteAllowed('user-a', 'user-a'), true, 'same account: the write proceeds');
    assert.equal(draftWriteAllowed('user-a', 'user-b'), false, 'a switch to another account is blocked');
    assert.equal(draftWriteAllowed('user-a', null), false, 'a sign-out mid-send is blocked');
    assert.equal(draftWriteAllowed(null, null), false, 'a never-signed-in owner never matches');
    assert.equal(draftWriteAllowed(null, 'user-a'), false, 'a null owner never matches a real account');
});
