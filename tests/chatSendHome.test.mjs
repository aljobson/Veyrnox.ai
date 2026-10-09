// A send that ends after the person opened another chat, or pressed New chat (ADR-0067). A reply can take a while and
// nothing stops them leaving. Owner decision, 2026-10-09: everything stays with the chat the message was sent in.
// Nothing on the screen changes except the chat list; given-back text waits in that chat's stored draft and its
// notice is held until that chat is opened; when that chat no longer exists, both wait under New chat.
// Which chat an ending belongs to, and whether that chat is on screen, is a plain module and is tested directly.
// The screen and the send hook are not importable here, so their part is pinned by reading the source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NEW_CHAT } from '../app/veyrnox/_lib/chatLocal.js';
import { ask, enter, forget, giveUp, hold, land, leave, newChatView, onScreen, sendHome } from '../app/veyrnox/_lib/chatSendHome.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const screen = read('../app/veyrnox/_components/chat/ChatWorkspace.js');
const sender = read('../app/veyrnox/_components/chat/useChatSend.js');
const send = sender.slice(sender.indexOf('async function send()'), sender.indexOf('\n  return { send,'));

/** A screen showing chat `id`, pressed and loaded. */
function showing(id) {
    const view = newChatView();
    ask(view, id); land(view, id);
    return view;
}

/** Which chat an ending belongs to, whether it may change the screen, and whether its box is the one on screen. */
function where(view, sentId) {
    const { home, here, showing: boxShown } = sendHome(view, sentId);
    return { home, here, showing: boxShown };
}

// ---- which chat an ending belongs to ----

test('a screen that has just loaded shows a chat that has not started', () => {
    const view = newChatView();
    assert.equal(onScreen(view, NEW_CHAT), true);
    // A message sent before any chat was made for it belongs to New chat.
    assert.deepEqual(where(view, null), { home: NEW_CHAT, here: true, showing: true });
});

test('while the chat the message was sent in is on screen, its ending lands on the screen', () => {
    assert.deepEqual(where(showing('a'), 'a'), { home: 'a', here: true, showing: true });
});

test('once another chat is pressed the ending no longer lands on screen, even before that chat has loaded', () => {
    const view = showing('a');
    ask(view, 'b');
    // Chat a is still what the screen shows, but the person has asked to leave it: text put in its box now would be
    // carried into chat b's draft when b arrives, and a notice would be wiped a moment later.
    // `showing` says the box on screen is still chat a's, so given-back text can go in it as well as in a's stored draft.
    assert.deepEqual(where(view, 'a'), { home: 'a', here: false, showing: true });
    land(view, 'b');
    assert.deepEqual(where(view, 'a'), { home: 'a', here: false, showing: false });
});

test('pressing New chat while a reply is in flight leaves the ending with its chat', () => {
    const view = showing('a');
    ask(view, NEW_CHAT); land(view, NEW_CHAT);
    assert.deepEqual(where(view, 'a'), { home: 'a', here: false, showing: false });
});

test('coming back to the chat counts once it has loaded, not at the press', () => {
    const view = showing('b');
    ask(view, 'a');
    assert.equal(sendHome(view, 'a').here, false, 'chat b is still on screen');
    land(view, 'a');
    assert.equal(sendHome(view, 'a').here, true);
});

test('a pressed chat that could not be read leaves the person where they were', () => {
    const view = showing('a');
    ask(view, 'b'); giveUp(view, 'b');
    assert.equal(onScreen(view, 'a'), true);
    // A failed read of a chat the person has already moved on from changes nothing.
    ask(view, 'b'); ask(view, 'c'); giveUp(view, 'b');
    assert.equal(view.asked, 'c');
});

test('a pressed chat that could not be read: what was held meanwhile for the chat still on screen is handed over', () => {
    // The person pressed chat b, the send in chat a ended while b was being read (so its notice was held), and then b
    // could not be read. They are still looking at chat a, and nothing would ever open it again to show the notice.
    const view = showing('a');
    ask(view, 'b');
    hold(view, 'a', 'If a reply is still saved, it will use Credits.');
    assert.equal(giveUp(view, 'b'), 'If a reply is still saved, it will use Credits.');
    assert.equal(onScreen(view, 'a'), true);
    assert.equal(land(view, 'a'), null, 'handed over once');
    // Nothing was held: nothing to hand over. A press the person has moved on from hands over nothing either.
    ask(view, 'b');
    assert.equal(giveUp(view, 'b'), null);
    ask(view, 'b'); ask(view, 'c'); hold(view, 'a', 'x');
    assert.equal(giveUp(view, 'b'), null);
});

test('on the way back to the chat: it is not on screen yet, but it is the one to read again', () => {
    const view = showing('b');
    ask(view, 'a');
    // A read of chat a is already out, and may have been answered before the reply was saved. The ending reads it
    // again, so the person does not arrive at a chat that is missing the reply they were charged for.
    assert.equal(sendHome(view, 'a').coming, true);
    assert.equal(sendHome(view, 'a').here, false);
    land(view, 'a');
    assert.equal(sendHome(view, 'a').coming, false);
    assert.equal(sendHome(view, 'b').coming, false, 'a chat that was left is not on its way');
});

test('a chat page that has been left has no screen to change and no notice to show', () => {
    // The person followed a link away from Chat while a send was still ending. Nothing will ever read this view again.
    const view = showing('a');
    leave(view);
    assert.deepEqual(sendHome(view, 'a'), { home: 'a', here: false, showing: false, coming: false, left: true });
    // The same object is entered again when the page's effects run twice, as they do in development.
    enter(view);
    assert.deepEqual(sendHome(view, 'a'), { home: 'a', here: true, showing: true, coming: false, left: false });
});

test('a message sent from a chat that has not started stays with New chat until a chat is made for it', () => {
    const view = newChatView();
    ask(view, 'b');
    assert.deepEqual(where(view, null), { home: NEW_CHAT, here: false, showing: true });
});

// ---- a chat that no longer exists ----

test('a chat deleted while it is on screen: the screen falls back to New chat, and the ending lands there', () => {
    const view = showing('a');
    assert.equal(forget(view, 'a'), true, 'it was the chat on screen');
    assert.equal(onScreen(view, NEW_CHAT), true);
    assert.deepEqual(where(view, 'a'), { home: NEW_CHAT, here: true, showing: true });
});

test('a chat deleted while another is on screen: its text and notice wait under New chat', () => {
    const view = showing('b');
    assert.equal(forget(view, 'a'), false);
    assert.equal(onScreen(view, 'b'), true, 'the screen is left alone');
    assert.deepEqual(where(view, 'a'), { home: NEW_CHAT, here: false, showing: false });
});

test('a chat deleted after another was pressed: the screen falls back, and the pressed chat is still on its way', () => {
    const view = showing('a');
    ask(view, 'b');
    assert.equal(forget(view, 'a'), true, 'it was still what the screen showed');
    assert.equal(view.shown, NEW_CHAT);
    assert.equal(view.asked, 'b', 'the read of chat b is not dropped when it lands');
    // The screen now shows a chat that has not started, which is where this message's text belongs: it goes in that
    // box. If chat b then fails to load, the person is left on New chat with their message in front of them.
    assert.deepEqual(where(view, 'a'), { home: NEW_CHAT, here: false, showing: true });
    giveUp(view, 'b');
    assert.deepEqual(where(view, 'a'), { home: NEW_CHAT, here: true, showing: true });
});

test('a chat that is opened again exists: its endings land in it', () => {
    // A chat made for a message is deleted without waiting for the server. If that delete failed, the chat is back in
    // the list after the next read, and a message sent from it must not be filed under New chat.
    const view = showing('b');
    forget(view, 'a');
    assert.equal(where(view, 'a').home, NEW_CHAT);
    ask(view, 'a'); land(view, 'a');
    assert.deepEqual(where(view, 'a'), { home: 'a', here: true, showing: true });
});

// ---- the notice ----

test('a notice for a chat that is not on screen is held, and shown once, when that chat is opened', () => {
    const view = showing('b');
    hold(view, 'a', 'It may have used Credits.');
    assert.equal(land(view, 'b'), null, 'never in another chat');
    assert.equal(land(view, NEW_CHAT), null, 'nor under New chat');
    ask(view, 'a');
    assert.equal(land(view, 'a'), 'It may have used Credits.');
    assert.equal(land(view, 'a'), null, 'once');
});

test('a later notice for the same chat replaces the one held', () => {
    const view = showing('b');
    hold(view, 'a', 'first'); hold(view, 'a', 'second');
    assert.equal(land(view, 'a'), 'second');
});

test('a notice held for a chat is dropped when that chat is deleted', () => {
    const view = showing('b');
    hold(view, 'a', 'Check this chat before you send again.');
    forget(view, 'a');
    assert.equal(land(view, 'a'), null);
    assert.equal(land(view, NEW_CHAT), null, 'it does not move to New chat: it was about a chat the person chose to delete');
});

// ---- the screen: which chat is asked for and which is shown ----

test('opening a chat notes the press first, and a read that lands after another press is dropped', () => {
    const open = /\n {2}const open = async \(id\) => \{\n([\s\S]*?)\n {2}\};\n/.exec(screen);
    assert.ok(open, 'the screen has open()');
    assert.match(open[1], /^ {4}ask\(chatView\.current, id\);/, 'the press is noted before anything is read');
    // The send's own reload goes through open() too, so this is also what stops a reload from pulling the person back.
    // A dropped read of the chat that is still shown (the send's own reload, overtaken by a press) still refreshes its
    // messages in place: if the pressed chat then fails to load, the person is not left looking at a reply that says
    // it is still arriving.
    assert.match(open[1], /const r = await chatApi\.get\(id\);\n(?: {6}\/\/[^\n]*\n)? {6}if \(chatView\.current\.asked !== id\) \{ if \(chatView\.current\.shown === id\) setMessages\(r\.messages\); return false; \}/);
    assert.match(open[1], /setError\(land\(chatView\.current, id\)\);/, 'the chat arrives with the notice that was held for it, or none');
    // The chat could not be read: the person is back on the chat that was shown, and a notice held for it meanwhile is
    // shown after the failure's own words, never dropped.
    assert.match(open[1], /\} catch \(e\) \{ fail\(e\); const waiting = giveUp\(chatView\.current, id\); if \(waiting\) setError\(\(was\) => \(was \? `\$\{was\} \$\{waiting\}` : waiting\)\); return false; \}$/);
});

test('the screen says when the chat page is left, so an ending that lands afterwards changes nothing', () => {
    assert.match(screen, /useEffect\(\(\) => \{ const v = chatView\.current; enter\(v\); return \(\) => leave\(v\); \}, \[\]\);/);
});

test('the draft effect stores the box under the chat on screen, and Stop is wired to the send', () => {
    assert.match(screen, /useEffect\(\(\) => \{ saveDraft\(active\?\.id \?\? NEW_CHAT, text\); \}, \[text, active\?\.id\]\);/);
    assert.match(screen, /<button type="button" onClick=\{stop\} disabled=\{stopping \|\| checking\}/);
    assert.match(sender, /\n {2}return \{ send, stop: \(\) => abortRef\.current\?\.abort\(\), busy, stopping, checking, progress \};\n/);
});

test('New chat notes the press and shows what was held for a chat that has not started', () => {
    assert.match(screen, /\n {2}const blank = \(\) => \{ ask\(chatView\.current, NEW_CHAT\); clear\(\); \};\n/);
    const clear = /\n {2}const clear = \(\) => \{([^\n]*)\};\n/.exec(screen);
    assert.ok(clear, 'the screen has clear()');
    assert.match(clear[1], /setError\(land\(chatView\.current, NEW_CHAT\)\);/);
    // The text given back for a chat that is gone is read from New chat's stored draft.
    assert.match(clear[1], /setText\(readDraft\(store\(\), getStoredUserId\(\), NEW_CHAT\)\);/);
});

test('deleting a chat forgets it, and clears the screen only when it was the one shown', () => {
    const remove = /\n {2}const remove = async \(id\) => \{\n([\s\S]*?)\n {2}\};\n/.exec(screen);
    assert.ok(remove, 'the screen has remove()');
    assert.match(remove[1], /await chatApi\.remove\(id\); setThreads\([^\n]*\); if \(forget\(chatView\.current, id\)\) clear\(\);/);
    assert.doesNotMatch(remove[1], /blank\(\)/, 'a delete is not a press on New chat: a chat pressed meanwhile still opens');
});

test('the view is made once, and the send hook is given it and a way to store a draft', () => {
    assert.match(screen, /const chatView = useRef\(null\);\s+if \(chatView\.current === null\) chatView\.current = newChatView\(\);/);
    assert.match(screen, /\nconst saveDraft = \(chatId, text\) => writeDraft\(store\(\), getStoredUserId\(\), chatId, text\);/);
    assert.match(screen, /\nconst addDraft = \(chatId, text\) => addToDraft\(store\(\), getStoredUserId\(\), chatId, text\);/);
    const call = /useChatSend\(\{\n([\s\S]*?)\n {2}\}\);/.exec(screen);
    assert.ok(call, 'the screen calls the send hook');
    assert.match(call[1], /\bchatView, saveDraft, addDraft\b/);
});

// ---- send(): every ending goes through the same four doors ----

test('send() works out where its endings land from the chat it was sent in', () => {
    assert.match(send, /\n {4}const v = chatView\.current;\n/);
    assert.match(send, /\n {4}const at = \(\) => sendHome\(v, thread \? thread\.id : null\);\n/);
});

test('the notice goes on screen only when the chat is, and is held for it otherwise', () => {
    assert.match(send, /\n {4}const tell = \(notice\) => \{ const \{ home, here \} = at\(\); if \(here\) setError\(notice\); else hold\(v, home, notice\); \};\n/);
    // setError appears twice in send(): clearing the notice as the message is sent, and inside tell().
    assert.equal(send.split('setError(').length - 1, 2, 'no ending sets a notice on whatever chat is on screen');
    assert.match(send, /sendingRef\.current = true; setBusy\(true\); setError\(null\); setText\(''\);/);
});

test('the chat is read again only while it is on screen', () => {
    // Or while the person is on their way back to it: see "on the way back to the chat" above.
    // And never for a chat that is gone: its ending belongs to New chat, and there is nothing to read.
    assert.match(send, /\n {4}const reload = async \(\) => \{ const \{ home, here, coming \} = at\(\); return home === thread\.id && \(here \|\| coming\) && open\(thread\.id\); \};/);
    assert.match(send, /\n {6}if \(r\.replay\) \{ await reload\(\); return; \}\n/, 'a replay shows the chat the same way');
    // Comments mention open(); the only call is the one inside reload().
    assert.equal(send.split('open(thread').length - 1, 1, 'no ending opens the chat itself: that would pull the person back to it');
    assert.doesNotMatch(send, /await open\(/);
});

test('the chat list is read again wherever the person is, and a failed read is quiet in another chat', () => {
    const relist = /\n {4}const relist = async \(\) => \{([^\n]*)\};\n/.exec(send);
    assert.ok(relist, 'send() has relist()');
    assert.match(relist[1], /if \(at\(\)\.here\) return refreshThreads\(\);/, 'in its own chat, exactly as before');
    assert.match(relist[1], /try \{ setThreads\(\(await chatApi\.threads\(\)\)\.threads\); \} catch \{/);
    assert.equal(send.split('refreshThreads(').length - 1, 1, 'every ending refreshes the list through relist()');
    assert.equal(send.split('await relist();').length - 1, 3, 'after a reply that ran to its end, after Stop, after a dropped connection');
});

test('given-back text always goes into its chat\'s stored draft, and into the box only when that chat is the one shown', () => {
    const give = /\n {4}const giveBack = \(over\) => \{\n([\s\S]*?)\n {4}\};\n/.exec(send);
    assert.ok(give, 'send() has one place that gives the text back');
    assert.match(give[1], /\n {6}const \{ home, here, showing, left \} = at\(\);\n/);
    // Always straight into its chat's stored draft: nothing that happens on screen afterwards can lose it. The screen's
    // own draft effect would store an empty box over it when a deleted chat's screen falls back to New chat, so the
    // box is filled whenever that chat is the one shown, even if the person has already pressed another.
    // A chat that is not shown may have a draft of its own by now: the text is added to it, not written over it.
    assert.match(give[1], /\n {6}if \(showing\) \{ saveDraft\(home, content\); setText\(content\); \} else addDraft\(home, content\);[^\n]*\n {6}if \(!here\) att\.clear\(\);[^\n]*$/);
    // The money rule. A turn that may still be saved gives its text back together with a notice that says so. Once
    // the chat page has been left that notice has nowhere to go, so the text is not kept either (as before this
    // guard, when it was put in a box that was no longer there).
    assert.match(give[1], /\n {6}const \{ home, here, showing, left \} = at\(\);\n {6}if \(left && !over\) return;[^\n]*\n(?: {6}\/\/[^\n]*\n)* {6}if \(showing\)/);
    // The home is worked out after a chat made for the message has been deleted, so its text goes to New chat.
    assert.ok(give[1].indexOf('forget(v, thread.id)') < give[1].indexOf('const { home, here, showing, left } = at();'));
    // setText appears twice in send(): emptying the box as the message is sent, and here.
    assert.equal(send.split('setText(').length - 1, 2, 'no ending puts the text in whatever box is on screen');
    assert.equal(send.split('giveBack(').length - 1, 5, 'nothing came back, Stop with nothing, Stop before any text, a dropped connection with nothing, never started');
});

test('a chat made for the message and deleted closes the screen only when it was the one shown', () => {
    const give = /\n {4}const giveBack = \(over\) => \{\n([\s\S]*?)\n {4}\};\n/.exec(send);
    assert.match(give[1], /if \(over && created\) \{ chatApi\.remove\(thread\.id\)\.catch\(\(\) => \{\}\); setThreads\(\(ts\) => ts\.filter\(\(t\) => t\.id !== thread\.id\)\); if \(forget\(v, thread\.id\)\) setActive\(null\); \}/);
    assert.equal(send.split('setActive(null)').length - 1, 1);
});

test('a chat made for the message is put on screen only if the person is still on the chat that had not started', () => {
    assert.match(send, /\n {8}if \(onScreen\(v, NEW_CHAT\)\) \{ ask\(v, thread\.id\); land\(v, thread\.id\); setActive\(thread\); \}\n {8}setThreads\(\(ts\) => \[thread, \.\.\.ts\]\);/);
    assert.equal(send.split('setActive(').length - 1, 2, 'the screen changes chat in two places only, both guarded');
});

test('the question and reply bubbles are added only to the chat the message was sent in', () => {
    // `showing`: the chat is what the screen shows. A message sent in the moment after another chat was pressed
    // still gets its bubbles, in case that chat does not load.
    assert.match(send, /\n {6}if \(at\(\)\.showing\) setMessages\(\(m\) => \[\.\.\.m, \{ id: `u-\$\{pending\}`, role: 'user'/);
});

test('a turn that never started gives the text back the same way, and its notice follows it', () => {
    const never = /\n {6}\} else \{\n([\s\S]*?)\n {6}\}\n {4}\} finally \{/.exec(send);
    assert.ok(never, 'the catch block ends with the turn that never started');
    assert.match(never[1], /\n {8}giveBack\(true\);\n/);
    assert.match(never[1], /tell\(chatErrorCopy\(e\.code, \{ credits: price \}\)\);/);
    assert.match(never[1], /tell\(chatErrorCopy\('image_unreadable'\)\);/);
    assert.match(never[1], /else failed\(e\);$/);
    // Closed chat and a signed-out reader are about the whole page, so they are raised wherever the person is.
    // Any other refusal is about this message, and is held for its chat when that chat is not on screen.
    assert.match(send, /\n {4}const failed = \(e\) => \{ if \(at\(\)\.here \|\| loadFailure\(e\) !== 'failed'\) fail\(e\); else tell\(chatErrorCopy\(e\?\.code\)\); \};\n/);
    assert.equal(send.split('fail(e)').length - 1, 1, 'fail() is reached through failed() only');
});

test('what waits for a chat that is not on screen is what the person would have been left with had they stayed', () => {
    // After a reply that was saved, the screen sets the stream's notice and then reads the chat again, which clears it
    // (only "charged but not stored" is set again afterwards). So there is nothing to hold from the first of those.
    assert.match(send, /\n {8}att\.clear\(\);[^\n]*\n {8}if \(streamError && at\(\)\.here\) tell\(chatErrorCopy\(streamError\)\);[^\n]*\n {8}await reload\(\);[^\n]*\n {8}if \(streamError === 'reply_not_saved'\) tell\(chatErrorCopy\(streamError\)\);/);
    // A reply that ended with nothing is not reloaded, so its notice stays on screen, and is held when its chat is not.
    assert.match(send, /\n {8}giveBack\(true\);\n {8}if \(streamError\) tell\(chatErrorCopy\(streamError\)\);/);
});

test('one send at a time, and the lock is let go when the send ends', () => {
    assert.match(send, /\n {4}if \(!content \|\| busy \|\| sendingRef\.current \|\| !model \|\| imagesBlocked\) return;\n {4}sendingRef\.current = true;/);
    assert.match(send, /\n {4}\} finally \{ setBusy\(false\); setProgress\(null\); setStopping\(false\); setChecking\(false\); sendingRef\.current = false; abortRef\.current = null; \}\n/);
    // The images were sent with a reply that is still being saved: they are not offered again.
    assert.match(send, /\n {10}att\.clear\(\); tell\(chatErrorCopy\('stop_saving'\)\);\n/);
});

test('a dropped connection: a notice held for a chat not on screen is worded for the reload it will be read after', () => {
    // lostNotice says "this chat shows what was saved" only when the screen shows it. A held notice is shown by open(),
    // after that chat has been read again, so for a turn the job says was saved it can say so.
    assert.match(send, /\n {8}tell\(chatErrorCopy\(lostNotice\(outcome, reloaded \|\| !at\(\)\.here\)\)\);/);
});
