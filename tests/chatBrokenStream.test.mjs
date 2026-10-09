// A chat stream that breaks after `start` (ADR-0067): the Credits have moved and the server treats the dropped
// connection like Stop, so the screen keeps the chat instead of deleting it and offering the message again.
// The client modules are not importable here, so the behaviour is pinned by reading the source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const screen = read('../app/veyrnox/_components/chat/ChatWorkspace.js');

/** The three endings of send()'s catch block: Stop, a stream that broke after `start`, and a turn that never started. */
function catchBranches() {
    const block = /\n    \} catch \(e\) \{\n([\s\S]*?)\n    \} finally \{ setBusy\(false\)/.exec(screen);
    assert.ok(block, 'send() has a catch block followed by its finally');
    // Keyed on the catch block's own indentation, so an if/else added inside a branch does not move the split.
    const parts = /^( {6}if \(e\?\.name === 'AbortError'\)[^\n]*)\n {6}else if \(started\) \{\n([\s\S]*?)\n {6}\} else \{\n([\s\S]*)$/.exec(block[1]);
    assert.ok(parts, 'the catch block branches on AbortError, then on started, then on everything else');
    return { stopped: parts[1], brokenAfterStart: parts[2], neverStarted: parts[3] };
}

test('the screen remembers that the start event arrived, which is when the Credits have been debited', () => {
    assert.match(screen, /if \(ev === 'start'\) \{ started = true; setProgress\(null\); \}/);
    // Declared just before send()'s try, so the catch block can read it.
    assert.match(screen, /\n    let started = false;[^\n]*\n    try \{\n/);
    // On the server, the debit comes before the start event.
    const turn = read('../lib/chatTurn.js');
    const debit = turn.indexOf("rpc('ledger_debit'");
    const start = turn.indexOf("send('start'");
    assert.ok(debit >= 0 && start > debit, 'start is sent after the debit');
});

test('a stream that breaks after start keeps the chat and reloads it, as Stop does', () => {
    const { stopped, brokenAfterStart } = catchBranches();
    assert.match(stopped, /await open\(thread\.id\); await refreshThreads\(\);/);
    assert.match(brokenAfterStart, /await open\(thread\.id\); await refreshThreads\(\);/);
    assert.doesNotMatch(brokenAfterStart, /chatApi\.remove/, 'the chat is not deleted');
    assert.doesNotMatch(brokenAfterStart, /setActive\(null\)/, 'the chat stays open');
    assert.doesNotMatch(brokenAfterStart, /setText\(content\)/, 'the message is not offered for sending again');
});

test('the person is told the connection dropped, after the reload that would clear the notice', () => {
    const { brokenAfterStart } = catchBranches();
    const reload = brokenAfterStart.indexOf('await open(thread.id)');
    const notice = brokenAfterStart.indexOf("setError(chatErrorCopy('connection_lost'))");
    assert.ok(reload >= 0 && notice > reload, 'the notice is set after open(), which clears it');
    // If the reload failed too (still offline), an empty reply bubble must not go on saying Thinking.
    assert.match(brokenAfterStart, /setMessages\(\(m\) => m\.filter\(\(x\) => x\.id !== pending \|\| x\.content\)\)/);
});

test('the words say the connection dropped and that Credits may have been used', () => {
    const copy = /case 'connection_lost': return (['"])(.+?)\1;/.exec(read('../app/veyrnox/_lib/chatApi.js'));
    assert.ok(copy, 'chatErrorCopy knows connection_lost');
    assert.match(copy[2], /connection dropped/);
    assert.match(copy[2], /may have used Credits/);
    assert.doesNotMatch(copy[2], /No Credits|not be charged|Try again|!/);
});

test('only a turn that never started deletes the new chat and gives the text back', () => {
    const { neverStarted } = catchBranches();
    assert.match(neverStarted, /setText\(content\)/);
    assert.match(neverStarted, /if \(created && thread\) \{ chatApi\.remove\(thread\.id\)\.catch\(\(\) => \{\}\);/);
    // In the whole of send(), a chat is deleted in two places only: here, and when `done` says nothing came back and
    // the Credits were returned.
    const send = screen.slice(screen.indexOf('async function send()'), screen.indexOf('if (!ready) return'));
    assert.equal(send.split('chatApi.remove(thread.id)').length - 1, 2);
});

test('the route header no longer calls DELETE a soft delete', () => {
    const route = read('../app/api/v1/chat/threads/[id]/route.js');
    assert.doesNotMatch(route, /soft delete/);
    assert.match(read('../packages/db/schema/supabase/0203_chat_delete_is_delete.sql'), /DELETE FROM public\.chat_threads WHERE id = p_thread_id/);
});
