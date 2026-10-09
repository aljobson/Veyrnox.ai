// A chat stream that breaks after `start` (ADR-0067): the Credits have moved and the server treats the dropped
// connection like Stop, so the screen keeps the chat instead of deleting it and offering the message again.
// What happened to the turn is the reply's job to say, so the screen looks for it as it does after Stop
// (tests/chatStop.test.mjs) and gives the message back only when the job failed with nothing stored.
// The screen is not importable here, so its part is pinned by reading the source. The choice of notice is a plain
// function and is tested directly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lostNotice } from '../app/veyrnox/_lib/chatStop.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const screen = read('../app/veyrnox/_components/chat/ChatWorkspace.js');
// send() and its endings moved out of ChatWorkspace.js into the useChatSend hook, unchanged and at the same indentation, to
// keep the screen file under 500 lines. The patterns that pin send() read the hook; the ones that pin markup read the screen.
const sender = read('../app/veyrnox/_components/chat/useChatSend.js');
// Since the person can open another chat before a send ends (tests/chatSendHome.test.mjs), an ending no longer calls
// open(), setError() or refreshThreads() itself. It calls reload(), tell() and relist(), which do the same while the
// chat the message was sent in is on screen and leave the screen alone when it is not. The patterns below name those.
const api = read('../app/veyrnox/_lib/chatApi.js');

/** The words chatErrorCopy returns for one code. */
function copyFor(code) {
    const copy = new RegExp(`case '${code}': return (['"])(.+?)\\1;`).exec(api);
    assert.ok(copy, `chatErrorCopy knows ${code}`);
    return copy[2];
}

/** The three endings of send()'s catch block: Stop, a stream that broke after `start`, and a turn that never started. */
function catchBranches() {
    const block = /\n    \} catch \(e\) \{\n([\s\S]*?)\n    \} finally \{ setBusy\(false\)/.exec(sender);
    assert.ok(block, 'send() has a catch block followed by its finally');
    // Keyed on the catch block's own indentation, so an if/else added inside a branch does not move the split.
    // The Stop branch is a block of its own since it stopped reloading at once (tests/chatStop.test.mjs covers it).
    const parts = /^ {6}if \(e\?\.name === 'AbortError'\) \{\n([\s\S]*?)\n {6}\} else if \(started\) \{\n([\s\S]*?)\n {6}\} else \{\n([\s\S]*)$/.exec(block[1]);
    assert.ok(parts, 'the catch block branches on AbortError, then on started, then on everything else');
    return { stopped: parts[1], brokenAfterStart: parts[2], neverStarted: parts[3] };
}

test('the screen remembers that the start event arrived, which is when the Credits have been debited', () => {
    // The same handler also keeps the job id, which the Stop branch uses.
    // For a while it also forgot the notice kept for the message before this one. It no longer does: the reply
    // starting says nothing about that message's Credits (tests/chatSendHome.test.mjs).
    assert.match(sender, /if \(ev === 'start'\) \{ started = true; [^\n]*setProgress\(null\); \}/);
    // Declared just before send()'s try, so the catch block can read it.
    assert.match(sender, /\n    let started = false;[^\n]*\n    try \{\n/);
    // On the server, the debit comes before the start event.
    const turn = read('../lib/chatTurn.js');
    const debit = turn.indexOf("rpc('ledger_debit'");
    const start = turn.indexOf("send('start'");
    assert.ok(debit >= 0 && start > debit, 'start is sent after the debit');
});

test('a stream that breaks after start looks for the turn first, and does not reload the chat at once', () => {
    // It used to reload at once. The server's save can land after that reload (and on the deployed Worker usually
    // does), so the reload came back without the turn and could not tell "refunded" from "not saved yet".
    const { brokenAfterStart } = catchBranches();
    const mark = brokenAfterStart.indexOf("status: 'lost'");
    const settle = brokenAfterStart.indexOf('await chatApi.settleStop(');
    const reload = brokenAfterStart.indexOf('await reload()');
    assert.ok(mark >= 0 && settle > mark, 'the question and the text so far stay on screen, marked, before anything is read');
    assert.ok(reload > settle, 'the chat is reloaded only after the turn was looked for');
    // The same look-up as Stop: the job id from `start`, the sent text, and the ids that were on screen before the send.
    assert.match(brokenAfterStart, /settleStop\(\{ threadId: thread\.id, jobId, text: content, knownIds \}\)/);
    assert.doesNotMatch(brokenAfterStart, /chatApi\.remove/, 'the branch never deletes the chat itself');
    assert.doesNotMatch(brokenAfterStart, /setActive\(null\)/, 'nor closes it');
    assert.doesNotMatch(brokenAfterStart, /setText\(content\)/, 'nor puts the message back itself: that is giveBack, for one ending only');
});

test('each ending of a broken stream: saved shows the chat, nothing kept gives the text back, unsettled keeps what is on screen', () => {
    const { brokenAfterStart } = catchBranches();
    // The chat list is refreshed before the endings: a notice set by one of them must be the last word.
    const refresh = brokenAfterStart.indexOf('await relist();');
    const reload = brokenAfterStart.indexOf('const reloaded = ');
    assert.ok(refresh >= 0 && reload > refresh, 'the list is refreshed first');
    // Giving the text back deletes a chat made for it without waiting. A list read after that could bring the chat back.
    assert.ok(brokenAfterStart.indexOf('giveBack(true)') > refresh, 'and the chat list is read before a chat can be deleted');
    // A turn the server kept (or charged and could not store) is shown by reading the chat again, as after Stop.
    // A turn that is not settled is never reloaded: the chat would come back without the text that is on screen.
    assert.match(brokenAfterStart, /const reloaded = \(outcome === 'saved' \|\| outcome === 'unsaved'\) && await reload\(\);/);
    // The job failed and nothing was stored: the Credits came back, so this is the "nothing came back" path. It is the
    // only ending that gives the message back or deletes a chat made for it.
    assert.match(brokenAfterStart, /\n {8}if \(outcome === 'nothing'\) giveBack\(true\);/);
    assert.equal(brokenAfterStart.split('giveBack(').length - 1, 1, 'the text is given back in one ending only');
    // The attached images follow the message, as after Stop: they stay only when it goes back in the box. In every
    // other ending the message is not offered again, so its images are not left behind for the next one.
    assert.match(brokenAfterStart, /\n {8}if \(outcome === 'nothing'\) giveBack\(true\); else att\.clear\(\);/);
    // Not settled, or the chat could not be read (still offline): the text that arrived stays, and a reply bubble with
    // no text in it goes, so nothing is left saying it is checking. Nothing here reads the chat again.
    assert.match(brokenAfterStart, /\n {8}if \(!reloaded\) setMessages\(\(m\) => m\.filter\(\(x\) => x\.id !== pending \|\| x\.content\)\);/);
    assert.equal(brokenAfterStart.split('reload()').length - 1, 1, 'the chat is read again in one place only, and never for a turn that is not settled');
    assert.doesNotMatch(brokenAfterStart, /open\(thread/, 'and never by opening it directly');
});

test('the person is told what happened last, after the reload that would clear the notice', () => {
    const { brokenAfterStart } = catchBranches();
    const lines = brokenAfterStart.split('\n').filter((l) => l.trim() && !l.trim().startsWith('//'));
    // `reloaded || !at().here`: a notice kept for a chat that is not on screen is read after that chat has been opened
    // again, which reloads it (tests/chatSendHome.test.mjs). In the chat itself the second half is false: as before.
    // tell() takes the code lostNotice gives, and keeps it with the chat. For a job that kept nothing the code goes
    // to tellUncharged() instead: the text is back and no Credits were used, which must not take the place of a warning
    // kept for the message before (tests/chatSendHome.test.mjs). With no such warning tellUncharged() is tell().
    assert.match(lines[lines.length - 2], /^ {8}const notice = lostNotice\(outcome, reloaded \|\| !at\(\)\.here\);/);
    assert.match(lines[lines.length - 1], /^ {8}if \(outcome === 'nothing'\) tellUncharged\(notice\); else tell\(notice\);/, 'the notice is the last thing the branch does');
    assert.equal(brokenAfterStart.split('tell(').length - 1, 1, 'and it is set once');
    assert.equal(brokenAfterStart.split('tellUncharged(').length - 1, 1, 'or told once as a message that used no Credits');
    assert.doesNotMatch(brokenAfterStart, /setError\(/, 'never straight onto whatever chat is on screen');
});

test('open() says whether the chat was read, so a failed reload is not taken for the saved turn on screen', () => {
    const open = /\n {2}const open = async \(id\) => \{\n([\s\S]*?)\n {2}\};\n/.exec(screen);
    assert.ok(open, 'the screen has open()');
    // The catch also takes back the press, so a chat that could not be read is not taken for the one asked for, and
    // shows the notice that is stored for the chat still on screen (tests/chatSendHome.test.mjs).
    assert.match(open[1], /return true;\n {4}\} catch \(e\) \{ fail\(e\); if \(giveUp\(chatView\.current, id\)\) \{[^\n]*\} return false; \}$/);
});

test('the notice follows what the job said, and never claims more than is known', () => {
    // Saved and on screen: the chat shows the reply and its price.
    assert.equal(lostNotice('saved', true), 'connection_saved');
    // Saved, but the chat could not be read again (the network is still down): the screen shows only what had arrived.
    assert.equal(lostNotice('saved', false), 'connection_lost');
    // Charged, but its messages could not be stored: that case's own words, whether or not the reload worked.
    assert.equal(lostNotice('unsaved', true), 'reply_not_saved');
    assert.equal(lostNotice('unsaved', false), 'reply_not_saved');
    // The job failed and nothing was stored: the Credits came back. giveBack does not read the chat again.
    assert.equal(lostNotice('nothing', false), 'connection_refunded');
    // Not settled in time, or every read failed: Credits may have been used.
    assert.equal(lostNotice('pending', false), 'connection_lost');
    assert.equal(lostNotice(undefined, false), 'connection_lost', 'an answer it does not know is treated as not settled');
});

test('the words for a turn that is not settled say the connection dropped and that Credits may have been used', () => {
    const copy = copyFor('connection_lost');
    assert.match(copy, /connection dropped/);
    assert.match(copy, /may have used Credits/);
    assert.doesNotMatch(copy, /No Credits|not be charged|Try again|!/);
});

test('the words for nothing kept say the connection dropped, that no Credits were used, and where the message is', () => {
    const copy = copyFor('connection_refunded');
    assert.match(copy, /connection dropped/);
    assert.match(copy, /no Credits were used/i);
    assert.match(copy, /message is back in the box/);
    // Text can have reached the screen before the turn failed to save, so the words do not say that nothing arrived.
    assert.doesNotMatch(copy, /may have|before any|!/);
});

test('the words for a saved turn say the connection dropped and point at the Credits the chat shows', () => {
    const copy = copyFor('connection_saved');
    assert.match(copy, /connection dropped/);
    assert.match(copy, /Credits/);
    // A saved turn can be a reply the provider cut off, which is stored and refunded. So the words promise neither.
    assert.doesNotMatch(copy, /may have|No Credits|no Credits|were used|!/);
});

test('while the turn is looked for the bubble says the connection was lost, and the button says it is checking', () => {
    // Not the Stop wording: the person did not stop anything.
    const { brokenAfterStart } = catchBranches();
    assert.doesNotMatch(brokenAfterStart, /'saving'|setStopping/);
    const checking = brokenAfterStart.indexOf('setChecking(true);');
    assert.ok(checking >= 0 && checking < brokenAfterStart.indexOf('await chatApi.settleStop('), 'the button says Checking from the start of the look-up, not after it');
    // No price, Copy or Star on a reply the server has not been seen to keep.
    assert.match(screen, /const isLive = \(m\) => m\.status === 'streaming' \|\| m\.status === 'saving' \|\| m\.status === 'lost';/);
    // With text: a line under it that stays true if the look-up ends without an answer. Without text: the bubble says
    // what is happening, and is removed if the look-up ends without an answer.
    assert.match(screen, /\(m\.status === 'saving' \|\| m\.status === 'lost'\) && m\.content && <p role="status"[^>]*>\{m\.status === 'saving' \? [^:]+ : 'Connection lost before this reply finished\.'\}<\/p>/);
    assert.match(screen, /m\.status === 'lost' \? 'Connection lost\. Checking what was saved\.' : /);
    // Its own state, cleared when the send ends, as for Stop.
    assert.match(screen, /disabled=\{stopping \|\| checking\}[^\n]*\{stopping \? 'Stopping' : checking \? 'Checking' : 'Stop'\}/);
    assert.match(sender, /\} finally \{ setBusy\(false\); setProgress\(null\); setStopping\(false\); setChecking\(false\);/);
});

test('only a turn that never started deletes the new chat and gives the text back', () => {
    const { stopped, brokenAfterStart, neverStarted } = catchBranches();
    // It used to put the text back and delete the chat with its own lines. It now calls giveBack(true), the one place
    // that decides where given-back text goes, so that the text is not put in the box of another chat the person has
    // opened (tests/chatSendHome.test.mjs). What it does while the person stays in the chat is the same.
    assert.match(neverStarted, /\n {8}giveBack\(true\);\n/);
    assert.doesNotMatch(neverStarted, /setText\(|chatApi\.remove|setActive\(/);
    // In the whole of send(), a chat is deleted in one place only: giveBack(true), for a turn that is known to be over
    // with nothing kept (`done` said so, the job did after a Stop or a dropped connection, or it never started).
    const send = sender.slice(sender.indexOf('async function send()'), sender.indexOf('\n  return { send,'));
    assert.equal(send.split('chatApi.remove(thread.id)').length - 1, 1);
    // Each ending that may still be saved and charged calls it only for a job that kept nothing.
    assert.equal(stopped.split('giveBack(true)').length - 1, 1);
    assert.match(stopped, /\} else if \(outcome === 'nothing'\) \{ giveBack\(true\); /);
    assert.equal(brokenAfterStart.split('giveBack(true)').length - 1, 1);
    assert.match(brokenAfterStart, /if \(outcome === 'nothing'\) giveBack\(true\);/);
});

test('the route header no longer calls DELETE a soft delete', () => {
    const route = read('../app/api/v1/chat/threads/[id]/route.js');
    assert.doesNotMatch(route, /soft delete/);
    assert.match(read('../packages/db/schema/supabase/0203_chat_delete_is_delete.sql'), /DELETE FROM public\.chat_threads WHERE id = p_thread_id/);
});
