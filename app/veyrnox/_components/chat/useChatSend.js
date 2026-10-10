'use client';
import { useRef, useState } from 'react';
import { GatewayError } from '../../_lib/gateway';
import { askStoppedSend, chatApi, chatErrorCopy, chatUnchargedCopy, lostNotice, makeIdempotencyKey, sendTurn, uploadChatImage } from '../../_lib/chatApi';
import { prepareImage } from '../../_lib/chatImages';
import { NEW_CHAT } from '../../_lib/chatLocal';
import { loadFailure } from '../../_lib/chatScreen';
import { ask, forget, land, onScreen, sendHome } from '../../_lib/chatSendHome';

/**
 * Sending one message from the chat screen (ADR-0067), and every way that send can end: a replay, a reply that ran to
 * its end, Stop, a dropped connection, a request that got no answer, and a turn that never started. The screen
 * (ChatWorkspace.js) owns the chat on show and passes in what a send reads and changes; the send's own state lives here.
 * `chatView` is the screen's record of which chat is on it (chatSendHome.js). `saveDraft(chatId, text)` stores a chat's
 * draft; `addDraft` puts text above what is already stored there. `keepNotice(chatId, code, extra)` stores what a chat's
 * last message ended with, beside its draft, and `dropNotice(chatId)` forgets it. `heldWarning(chatId)` is that notice when
 * it warns that Credits were used or still may be (chatLocal.js), else null. `extra` carries the reply's job, the send's
 * key and the text sent, for a warning the screen asks the server about when its chat is next opened (chatWarning.js),
 * and the warning this one takes the place of.
 * @returns {{send: () => Promise<void>, stop: () => void, busy: boolean, stopping: boolean, checking: boolean, progress: object|null}}
 */
export function useChatSend({ text, setText, model, imagesBlocked, chosen, price, active, setActive, messages, setMessages, setThreads, setError, att, limits, draftModel, folders, folder, instr, open, refreshThreads, fail, chatView, saveDraft, addDraft, keepNotice, dropNotice, heldWarning }) {
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false); // Stop was pressed and the stopped turn is being looked for
  const [checking, setChecking] = useState(false); // the connection dropped mid-reply and the turn is being looked for
  const [progress, setProgress] = useState(null); // the step a Deep research reply is on: plan, search n of m, write
  const abortRef = useRef(null);
  const sendingRef = useRef(false); // synchronous: a second Enter must not start a second turn

  async function send() {
    const content = text.trim();
    if (!content || busy || sendingRef.current || !model || imagesBlocked) return;
    sendingRef.current = true; setBusy(true); setError(null); setText('');
    let thread = active; let created = false; const pending = `pending-${Date.now()}`;
    const knownIds = new Set(messages.map((x) => x.id)); let jobId = null; // to tell this turn from the ones already on screen
    let key = null; // this send's idempotency key, made below before any request: with no job id (Stop before `start`), the server is asked about the send by it
    // The notice kept for the chat this message is sent from is about the message before it, and goes at the press. Unless it warns
    // that the one before used Credits or still may: that is forgotten only by an ending of this message that accounts for Credits
    // itself. Either this message was saved (reload(): the chat shows it and its price, and is read again when it is on screen), or
    // it keeps a warning of its own. The reply starting is neither: a message that starts can still end with nothing charged and
    // its text given back.
    const from = active ? active.id : NEW_CHAT; let forgotten = false;
    const forgetEarlier = () => { if (!forgotten) { forgotten = true; dropNotice(from); } };
    if (!heldWarning(from)) forgetEarlier();
    // The person can open another chat, or press New chat, before this send ends. Its text, its notice and its bubbles
    // belong to the chat it was sent in (chatSendHome.js): they reach the screen only while that chat is the one on it.
    const v = chatView.current;
    const at = () => sendHome(v, thread ? thread.id : null);
    // What an ending says is kept with its chat, as a code (chatLocal.js): the screen shows it whenever that chat is opened, a
    // page reload included, until a later message is sent from it or, for a warning, the server says its turn has settled.
    // It goes on screen now only while that chat is the one on it.
    // The reply's job (none before `start`), this send's key and the text sent go to the store with it. The store keeps them only
    // beside a warning about a turn that is not settled, the key only with no job and the text as a mark: opening the chat later
    // asks about that turn, and a settled turn takes the warning away.
    // A warning still kept for the chat this message was sent from is read first (`before`) and handed on: this notice takes its
    // place, so it then stands for that warning's turns as well, and the store keeps them with it. It goes only when all are settled.
    const tell = (code, extra) => { const before = heldWarning(from); forgetEarlier(); const { home, here } = at(); keepNotice(home, code, { ...extra, job: jobId, key, sent: content, after: before }); if (here) setError(chatErrorCopy(code, extra)); };
    // A message that used no Credits (it never started, or it started and they came back) has its text given back, and what it says
    // is about itself. It does not take the place of a warning that the message before it used Credits or still may: that warning
    // stays kept, and while its chat is on screen both are said, this one first. True when such a warning is kept, said or not.
    const besideWarning = (code, extra) => { const { home, here } = at(); const warning = heldWarning(home); if (warning && here) setError(chatUnchargedCopy(code, extra, warning)); return !!warning; };
    // With no warning kept it is told like any notice. An ending that says nothing on its own (Stop with nothing kept) skips this
    // and is said only together with a warning.
    const tellUncharged = (code, extra) => { if (!besideWarning(code, extra)) tell(code, extra); };
    // False when the chat was not read: it is gone, it is not on screen, or the read failed. It is also read when the person is
    // on their way back to it: the read that is already out may have been answered before this turn was saved.
    // The chat is read for this message, so this message went out: open() must not show the notice kept for the one before it.
    const reload = async () => { forgetEarlier(); const { home, here, coming } = at(); return home === thread.id && (here || coming) && open(thread.id); };
    // The chat list is read again wherever the person is. A read that fails says so only in the send's own chat.
    const relist = async () => { if (at().here) return refreshThreads(); try { setThreads((await chatApi.threads()).threads); } catch { /* the list stays as it was */ } };
    // A closed chat or a signed-out reader is about the whole page. Any other refusal is about this message, and is told as one.
    const failed = (e) => { if (loadFailure(e) !== 'failed') fail(e); else tellUncharged(e?.code); };
    // Nothing usable came back: take the bubbles away and give the text back. A chat made for this message goes too, but
    // only when the turn is known to be over. A turn that may still be saved needs its chat.
    const giveBack = (over) => {
      setMessages((m) => m.filter((x) => x.id !== pending && x.id !== `u-${pending}`));
      if (over && created) { chatApi.remove(thread.id).catch(() => {}); setThreads((ts) => ts.filter((t) => t.id !== thread.id)); if (forget(v, thread.id)) setActive(null); }
      const { home, here, showing, left } = at();
      if (left && !over) return;        // the chat page was left and this turn may still be saved: the text is not offered again. Its notice is kept, for when the chat is next opened
      // Straight into its chat's stored draft (New chat's, when its chat is gone), where it waits. In the box too when that
      // chat is the one shown. A chat that is not shown may have a draft of its own by now: the text goes above it.
      if (showing) { saveDraft(home, content); setText(content); } else addDraft(home, content);
      if (!here) att.clear();           // elsewhere, or leaving: the images cannot wait with it, and must not go out with another chat's message
    };
    let hadText = false; // some of the reply reached the screen
    let unsure = false;  // no `start`, no answer to the message's own request, and the server has not said the send is over
    let looked = null;   // what the look for the turn found, when it was made for a job the server named and not one `start` brought
    let started = false; // the `start` event arrived, or the server named this send's job and the turn has settled: the Credits have been debited
    try {
      key = makeIdempotencyKey(); // in here: a browser that cannot make one ends like any message that never started
      // Images go to storage first, before anything is charged: a failed upload costs nothing.
      // A Library image is already in storage; the server checks it is the caller's own, so it is sent by id.
      const refs = [];
      for (const it of att.items) refs.push(it.asset ? { source_asset: it.asset } : await uploadChatImage(await prepareImage(it.file, limits.maxEdge)));
      if (!thread) {
        thread = (await chatApi.create(draftModel || model.id)).thread; created = true;
        // A chat started while a folder is open goes into it. If filing fails, the chat still starts, unfiled.
        if (folders && folders.some((f) => f.id === folder)) {
          try { await chatApi.move(thread.id, folder); thread = { ...thread, folder_id: folder }; } catch { /* stays unfiled */ }
        }
        // Instructions typed before the first message belong to the new chat. If saving fails, the chat still starts without them.
        if (instr.trim()) {
          try { const r = await chatApi.patch(thread.id, { system_prompt: instr }); thread = { ...thread, ...r.thread }; } catch { /* starts without */ }
        }
        // Still on the chat that had not started: it becomes this one. If another chat was opened meanwhile, this one only joins the list.
        if (onScreen(v, NEW_CHAT)) { ask(v, thread.id); land(v, thread.id); setActive(thread); }
        setThreads((ts) => [thread, ...ts]);
      }
      if (at().showing) setMessages((m) => [...m, { id: `u-${pending}`, role: 'user', content, status: 'complete', credits: 0, attachments: att.items.map(() => ({ type: 'image' })) }, { id: pending, role: 'assistant', content: '', status: 'streaming', credits: 0 }]);
      const ac = new AbortController(); abortRef.current = ac;
      let outcome = null; let streamError = null;
      // The server named the job this send made, and no `start` came with it: the turn is looked for by that job, now. Settled,
      // the send ends as a stream that broke after `start` does, on what this look found. Not settled, the job id is not kept:
      // the send stays `unsure`, and its warning is kept with the send's key, which finds the same job when the chat is opened.
      const lookFor = async (job) => { looked = await chatApi.settleStop({ threadId: thread.id, jobId: job, text: content, knownIds }); if (looked === 'pending') looked = null; else { started = true; jobId = job; } };
      const r = await sendTurn({
        threadId: thread.id, text: content, key, options: chosen, attachments: refs, signal: ac.signal,
        onEvent: (ev, d) => {
          if (ev === 'start') { started = true; jobId = d.job_id; setProgress(null); }
          if (ev === 'progress') setProgress(d);
          if (ev === 'delta') { hadText = true; setMessages((m) => m.map((x) => (x.id === pending ? { ...x, content: x.content + d.text } : x))); }
          if (ev === 'error') streamError = d.error;
          if (ev === 'done') outcome = d;
        },
      }).catch(async (e) => {
        // The message's own request went out and no answer of ours came back, before `start` (chatApi.js: `send_unanswered`).
        // The server may hold the send all the same: it takes a reader that has gone as Stop, debits, and can still save a reply
        // and charge it. So it is asked about the send by its key, at once, with the question Stop before `start` asks
        // (chatStop.js). No job and the key closed: the turn never started and never can. A job: the Credits moved, and the turn
        // is looked for by it now. Settled, it ends as a stream that broke after `start` does. Not settled, or no answer at all:
        // `unsure`. The job id is then not kept: the warning is kept with the send's key, which finds the same job when the chat
        // is opened, and marks the message as one that was given back.
        // Anything raised before the request (an image, the chat, the key, the session) or a refusal is not asked about.
        if (started || !(e instanceof GatewayError) || e.code !== 'send_unanswered') throw e;
        unsure = true; // from here until the server says "closed": whatever goes wrong while it is asked must end with the warning
        setChecking(true); setMessages((m) => m.map((x) => (x.id === pending ? { ...x, status: 'lost' } : x)));
        const found = await askStoppedSend({ key, closeSend: chatApi.closeSend });
        if (found.closed) unsure = false;
        else if (found.job) await lookFor(found.job); // settled: `started`, which is asked first below
        throw e;
      });
      if (r.replay) {
        // The server already holds a job for this send. This screen sends a key once, so that job was not made by a request it saw
        // answered. A browser sends a POST again by itself when its connection dies with no answer: the first copy can have
        // reached the server, which debited and took the reader that had gone as Stop (usually refunded, sometimes saved and
        // charged), and this is the answer to the second. Or the job was made and never run (lib/freeJob.js: a free job whose own
        // answer was lost). So a replay does not say the reply ran, or how it ended. It ends as a request that got no answer and
        // whose job the server named: that job is looked for, now. No job named (the server always names one): `unsure`.
        unsure = true; // as above: whatever goes wrong while the turn is looked for must end with the warning
        setChecking(true); setMessages((m) => m.map((x) => (x.id === pending ? { ...x, status: 'lost' } : x)));
        if (r.job) await lookFor(r.job);
        throw new GatewayError('send_replayed', { status: 200, code: 'send_replayed' }); // to the endings below, and never told: `started` or `unsure` is set
      }
      if (outcome && (outcome.status === 'failed' || (outcome.status === 'canceled' && !outcome.credits_charged && !outcome.message_id))) {
        // Nothing usable came back and the Credits were returned. With no error named (it was stopped before any text) nothing is
        // said, unless a warning is kept: that alone would read as being about this message.
        await relist();                              // first: the notice set below must not be replaced
        giveBack(true);
        if (streamError) tellUncharged(streamError); else besideWarning('stop_refunded');
      } else {
        att.clear();                                 // sent: the images are spent, so the next reply starts clean
        if (streamError && at().here) setError(chatErrorCopy(streamError)); // on screen only, and not kept: the reload clears it
        await reload();                              // the saved messages, with their real status and price
        await relist();                              // first: the notice set below must not be replaced
        if (streamError === 'reply_not_saved') tell(streamError); // after the reload, which clears the notice or replaces it when the chat is gone
      }
    } catch (e) {
      if (e?.name === 'AbortError') {
        // Stop. The server saves the stopped turn a moment after the browser lets go, so a reload at once can come back
        // without it. The question and the text so far stay on screen while the turn is looked for.
        setStopping(true); setMessages((m) => m.map((x) => (x.id === pending ? { ...x, status: 'saving' } : x)));
        // Stop before `start`: no job id came, so the look could only read the chat. The server is first asked about the send by
        // its key (chatStop.js). It closed the send: no reply was charged and none can be, which is the ending of a job that kept
        // nothing. It named the job the send made: that job is looked for, as after `start`. No answer: the look, as it always was.
        const asked = jobId ? null : await askStoppedSend({ key, closeSend: chatApi.closeSend });
        if (asked?.job) jobId = asked.job;
        const outcome = asked?.closed ? 'nothing' : await chatApi.settleStop({ threadId: thread.id, jobId, text: content, knownIds });
        await relist();                                                  // first: a notice set below must not be replaced
        if (outcome === 'saved' || outcome === 'unsaved') {
          att.clear(); await reload();                                   // the saved messages, with their real status and price
          if (outcome === 'unsaved') tell('reply_not_saved'); // charged, but it could not be stored: say so, after open()
        } else if (outcome === 'nothing') { giveBack(true); besideWarning('stop_refunded'); } // nothing was produced and the Credits came back, or the send was closed before any were taken
        else if (!hadText) {
          // Not settled, and no text had arrived: Stop came before `start` (and the server did not say what became of the send, or
          // named a job that had not ended) or before the first words (the job had not ended). There is nothing on screen to
          // keep, so the message goes back. But a reply may still be saved: the chat stays for it, and the notice says so.
          giveBack(false); tell('stop_unsure');
        } else {
          // Still being saved when the tries ran out: the text stays on screen and the notice says so.
          att.clear(); tell('stop_saving');
        }
      } else if (started) {
        // The stream broke after the Credits moved. The server treats a dropped connection like Stop and saves the turn some time
        // after the break, so it is looked for as after Stop. Only a job that kept nothing gives the message back or deletes the chat.
        // (A request that got no answer before `start`, or a replay, whose job the server named was looked for already: `looked`.)
        setChecking(true); setMessages((m) => m.map((x) => (x.id === pending ? { ...x, status: 'lost' } : x)));
        const outcome = looked || await chatApi.settleStop({ threadId: thread.id, jobId, text: content, knownIds });
        await relist();                                                  // first: the notice set below must not be replaced
        const reloaded = (outcome === 'saved' || outcome === 'unsaved') && await reload(); // the saved messages, with their real status and price
        if (outcome === 'nothing') giveBack(true); else att.clear();     // kept nothing: the message goes back, images too. Otherwise neither is offered again
        if (!reloaded) setMessages((m) => m.filter((x) => x.id !== pending || x.content)); // not settled, or still offline: the text that arrived stays
        // Last: open() shows what is kept for the chat. A notice for a chat that is not on screen is read after that chat is opened, which reloads it.
        const notice = lostNotice(outcome, reloaded || !at().here);
        if (outcome === 'nothing') tellUncharged(notice); else tell(notice);
      } else if (unsure) {
        // The request got no answer and the server could say nothing final: it could not be asked (its route refuses, still
        // offline, too slow), or the job it named was not settled when the look ended. The same for a replay whose job was not
        // settled, or that named none. A reply may still be saved and charged,
        // so this ends as Stop before `start` does: the message goes back, a chat made for it stays for that reply, and the
        // warning is kept beside the text with the send's key, to be asked about when the chat is next opened (chatWarning.js).
        // Its words are the ones for a dropped connection that is not settled.
        giveBack(false);
        if (at().left) addDraft(at().home, content); // the chat page was left, so no text was kept just above: this warning is stored, and the message waits in its chat beside it
        tell('connection_lost');
      } else {
        // The turn never started and nothing was charged: the message goes back, and a chat made for it goes too.
        giveBack(true);
        if (e instanceof GatewayError && e.code === 'insufficient_balance') tellUncharged(e.code, { credits: price });
        else if (e instanceof Error && e.message === 'image_unreadable') tellUncharged('image_unreadable');
        else failed(e);
      }
    } finally { setBusy(false); setProgress(null); setStopping(false); setChecking(false); sendingRef.current = false; abortRef.current = null; }
  }

  return { send, stop: () => abortRef.current?.abort(), busy, stopping, checking, progress };
}
