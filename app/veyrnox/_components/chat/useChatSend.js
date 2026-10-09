'use client';
import { useRef, useState } from 'react';
import { GatewayError } from '../../_lib/gateway';
import { chatApi, chatErrorCopy, lostNotice, makeIdempotencyKey, sendTurn, uploadChatImage } from '../../_lib/chatApi';
import { prepareImage } from '../../_lib/chatImages';

/**
 * Sending one message from the chat screen (ADR-0067), and every way that send can end: a replay, a reply that ran to
 * its end, Stop, a dropped connection, and a turn that never started. The screen (ChatWorkspace.js) owns the chat on
 * show and passes in what a send reads and changes; the send's own state lives here.
 * @returns {{send: () => Promise<void>, stop: () => void, busy: boolean, stopping: boolean, checking: boolean, progress: object|null}}
 */
export function useChatSend({ text, setText, model, imagesBlocked, chosen, price, active, setActive, messages, setMessages, setThreads, setError, att, limits, draftModel, folders, folder, instr, open, refreshThreads, fail }) {
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
    // Nothing usable came back: take the bubbles away and give the text back. A chat made for this message goes too, but
    // only when the turn is known to be over. A turn that may still be saved needs its chat.
    const giveBack = (over) => {
      setMessages((m) => m.filter((x) => x.id !== pending && x.id !== `u-${pending}`)); setText(content);
      if (over && created) { chatApi.remove(thread.id).catch(() => {}); setThreads((ts) => ts.filter((t) => t.id !== thread.id)); setActive(null); }
    };
    let hadText = false; // some of the reply reached the screen
    let started = false; // the `start` event arrived: the Credits have been debited
    try {
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
        setActive(thread); setThreads((ts) => [thread, ...ts]);
      }
      setMessages((m) => [...m, { id: `u-${pending}`, role: 'user', content, status: 'complete', credits: 0, attachments: att.items.map(() => ({ type: 'image' })) }, { id: pending, role: 'assistant', content: '', status: 'streaming', credits: 0 }]);
      const ac = new AbortController(); abortRef.current = ac;
      let outcome = null; let streamError = null;
      const r = await sendTurn({
        threadId: thread.id, text: content, key: makeIdempotencyKey(), options: chosen, attachments: refs, signal: ac.signal,
        onEvent: (ev, d) => {
          if (ev === 'start') { started = true; jobId = d.job_id; setProgress(null); }
          if (ev === 'progress') setProgress(d);
          if (ev === 'delta') { hadText = true; setMessages((m) => m.map((x) => (x.id === pending ? { ...x, content: x.content + d.text } : x))); }
          if (ev === 'error') streamError = d.error;
          if (ev === 'done') outcome = d;
        },
      });
      if (r.replay) { await open(thread.id); return; }
      if (outcome && (outcome.status === 'failed' || (outcome.status === 'canceled' && !outcome.credits_charged && !outcome.message_id))) {
        // Nothing usable came back and the Credits were returned.
        giveBack(true);
        if (streamError) setError(chatErrorCopy(streamError));
      } else {
        att.clear();                                 // sent: the images are spent, so the next reply starts clean
        if (streamError) setError(chatErrorCopy(streamError));
        await open(thread.id);                       // the saved messages, with their real status and price
        if (streamError === 'reply_not_saved') setError(chatErrorCopy(streamError)); // open() clears the notice, or replaces it when the chat is gone
      }
      await refreshThreads();
    } catch (e) {
      if (e?.name === 'AbortError') {
        // Stop. The server saves the stopped turn a moment after the browser lets go, so a reload at once can come back
        // without it. The question and the text so far stay on screen while the turn is looked for.
        setStopping(true); setMessages((m) => m.map((x) => (x.id === pending ? { ...x, status: 'saving' } : x)));
        const outcome = await chatApi.settleStop({ threadId: thread.id, jobId, text: content, knownIds });
        await refreshThreads();                                          // first: a notice set below must not be replaced
        if (outcome === 'saved' || outcome === 'unsaved') {
          att.clear(); await open(thread.id);                            // the saved messages, with their real status and price
          if (outcome === 'unsaved') setError(chatErrorCopy('reply_not_saved')); // charged, but it could not be stored: say so, after open()
        } else if (outcome === 'nothing') giveBack(true);                // nothing was produced and the Credits came back
        else if (!hadText) {
          // Not settled, and no text had arrived: Stop came before `start` (no job to ask) or before the first words (the job
          // had not ended). There is nothing on screen to keep, so the message goes back. But a reply may still be saved:
          // the chat stays for it, and the notice says so.
          giveBack(false); setError(chatErrorCopy('stop_unsure'));
        } else {
          // Still being saved when the tries ran out: the text stays on screen and the notice says so.
          att.clear(); setError(chatErrorCopy('stop_saving'));
        }
      } else if (started) {
        // The stream broke after the Credits moved. The server treats a dropped connection like Stop and saves the turn some time
        // after the break, so it is looked for as after Stop. Only a job that kept nothing gives the message back or deletes the chat.
        setChecking(true); setMessages((m) => m.map((x) => (x.id === pending ? { ...x, status: 'lost' } : x)));
        const outcome = await chatApi.settleStop({ threadId: thread.id, jobId, text: content, knownIds });
        await refreshThreads();                                          // first: the notice set below must not be replaced
        const reloaded = (outcome === 'saved' || outcome === 'unsaved') && await open(thread.id); // the saved messages, with their real status and price
        if (outcome === 'nothing') giveBack(true); else att.clear();     // kept nothing: the message goes back, images too. Otherwise neither is offered again
        if (!reloaded) setMessages((m) => m.filter((x) => x.id !== pending || x.content)); // not settled, or still offline: the text that arrived stays
        setError(chatErrorCopy(lostNotice(outcome, reloaded)));          // last: open() clears the notice
      } else {
        setMessages((m) => m.filter((x) => x.id !== pending && x.id !== `u-${pending}`)); setText(content);
        if (e instanceof GatewayError && e.code === 'insufficient_balance') setError(chatErrorCopy(e.code, { credits: price }));
        else if (e instanceof Error && e.message === 'image_unreadable') setError(chatErrorCopy('image_unreadable'));
        else fail(e);
        if (created && thread) { chatApi.remove(thread.id).catch(() => {}); setThreads((ts) => ts.filter((t) => t.id !== thread.id)); setActive(null); }
      }
    } finally { setBusy(false); setProgress(null); setStopping(false); setChecking(false); sendingRef.current = false; abortRef.current = null; }
  }

  return { send, stop: () => abortRef.current?.abort(), busy, stopping, checking, progress };
}
