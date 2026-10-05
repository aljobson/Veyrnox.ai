'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GatewayError } from '../../_lib/gateway';
import { chatApi, chatErrorCopy, makeIdempotencyKey, sendTurn } from '../../_lib/chatApi';
import { ChatText } from './ChatText';
import { ThreadList } from './ThreadList';

const credits = (n) => `${n} Credit${n === 1 ? '' : 's'}`;
const MAX_TEXT = 8000;
const MAX_PROMPT = 4000;
const WORDS = Math.round((1024 * 0.75) / 10) * 10;

function Footer({ m }) {
  const [copied, setCopied] = useState(false);
  const label = m.status === 'error' ? 'Cut off. No Credits used' : m.status === 'canceled' ? `Stopped. ${credits(m.credits)}` : credits(m.credits);
  const copy = async () => { try { await navigator.clipboard.writeText(m.content); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* blocked */ } };
  return (
    <p className="mt-2 flex items-center gap-3 font-vx-mono text-xs text-vx-fg-muted vx-num">
      <span>{label}</span>
      <button type="button" onClick={copy} className="rounded px-1.5 py-0.5 font-sans hover:text-vx-fg" aria-label="Copy reply">{copied ? 'Copied' : 'Copy'}</button>
    </p>
  );
}

export function ChatWorkspace() {
  const [models, setModels] = useState([]);
  const [threads, setThreads] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draftModel, setDraftModel] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [closed, setClosed] = useState(false);
  const [ready, setReady] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [instrOpen, setInstrOpen] = useState(false);
  const [instr, setInstr] = useState('');
  const [saved, setSaved] = useState(false);
  const abortRef = useRef(null);
  const sendingRef = useRef(false); // synchronous: a second Enter must not start a second turn
  const endRef = useRef(null);

  const fail = useCallback((e) => {
    if (e instanceof GatewayError && e.code === 'chat_not_open') setClosed(true);
    else if (!(e instanceof GatewayError && e.status === 401)) setError(chatErrorCopy(e?.code));
  }, []);
  const refreshThreads = useCallback(async () => { try { setThreads((await chatApi.threads()).threads); } catch (e) { fail(e); } }, [fail]);

  useEffect(() => {
    (async () => {
      try {
        const [m, t] = await Promise.all([chatApi.models(), chatApi.threads()]);
        setModels(m.models); setThreads(t.threads); setDraftModel(m.models[0]?.id || '');
      } catch (e) { fail(e); } finally { setReady(true); }
    })();
  }, [fail]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages]);

  const model = models.find((x) => x.id === (active?.model_id ?? draftModel)) || models[0];
  const open = async (id) => {
    try {
      const r = await chatApi.get(id);
      setActive(r.thread); setMessages(r.messages); setInstr(r.thread.system_prompt || ''); setError(null); setDrawer(false);
    } catch (e) { fail(e); }
  };
  const blank = () => { setActive(null); setMessages([]); setInstr(''); setInstrOpen(false); setError(null); setDrawer(false); };
  const patch = async (id, body) => {
    try {
      const { thread } = await chatApi.patch(id, body);
      setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, ...thread } : t)));
      setActive((a) => (a?.id === id ? { ...a, ...thread } : a));
      return true;
    } catch (e) { fail(e); return false; }
  };
  const remove = async (id) => {
    try { await chatApi.remove(id); setThreads((ts) => ts.filter((t) => t.id !== id)); if (active?.id === id) blank(); } catch (e) { fail(e); }
  };

  async function send() {
    const content = text.trim();
    if (!content || busy || sendingRef.current || !model) return;
    sendingRef.current = true; setBusy(true); setError(null); setText('');
    let thread = active; let created = false; const pending = `pending-${Date.now()}`;
    try {
      if (!thread) {
        thread = (await chatApi.create(draftModel || model.id)).thread; created = true;
        setActive(thread); setThreads((ts) => [thread, ...ts]);
      }
      setMessages((m) => [...m, { id: `u-${pending}`, role: 'user', content, status: 'complete', credits: 0 }, { id: pending, role: 'assistant', content: '', status: 'streaming', credits: 0 }]);
      const ac = new AbortController(); abortRef.current = ac;
      let outcome = null; let streamError = null;
      const r = await sendTurn({
        threadId: thread.id, text: content, key: makeIdempotencyKey(), signal: ac.signal,
        onEvent: (ev, d) => {
          if (ev === 'delta') setMessages((m) => m.map((x) => (x.id === pending ? { ...x, content: x.content + d.text } : x)));
          if (ev === 'error') streamError = d.error;
          if (ev === 'done') outcome = d;
        },
      });
      if (r.replay) { await open(thread.id); return; }
      if (outcome && (outcome.status === 'failed' || (outcome.status === 'canceled' && !outcome.credits_charged && !outcome.message_id))) {
        // Nothing usable came back and the Credits were returned: take the bubble away and give the text back.
        setMessages((m) => m.filter((x) => x.id !== pending && x.id !== `u-${pending}`)); setText(content);
        if (streamError) setError(chatErrorCopy(streamError));
        if (created) { chatApi.remove(thread.id).catch(() => {}); setThreads((ts) => ts.filter((t) => t.id !== thread.id)); setActive(null); }
      } else {
        if (streamError) setError(chatErrorCopy(streamError));
        await open(thread.id);                       // the saved messages, with their real status and price
      }
      await refreshThreads();
    } catch (e) {
      if (e?.name === 'AbortError') { if (thread) await open(thread.id); await refreshThreads(); }
      else {
        setMessages((m) => m.filter((x) => x.id !== pending && x.id !== `u-${pending}`)); setText(content);
        if (e instanceof GatewayError && e.code === 'insufficient_balance') setError(chatErrorCopy(e.code, { credits: model?.credits_per_reply }));
        else fail(e);
        if (created && thread) { chatApi.remove(thread.id).catch(() => {}); setThreads((ts) => ts.filter((t) => t.id !== thread.id)); setActive(null); }
      }
    } finally { setBusy(false); sendingRef.current = false; abortRef.current = null; }
  }

  if (!ready) return <div className="p-8 text-sm text-vx-fg-muted" role="status">Loading</div>;
  if (closed || models.length === 0) {
    return (
      <div className="mx-auto max-w-[640px] px-4 py-16">
        <h1 className="vx-display text-[32px]">Chat is not open yet</h1>
        <p className="mt-3 text-vx-fg-body">{closed ? 'We will open it here when it is ready.' : 'There are no chat models available right now.'}</p>
        <Link href="/app/create" className="mt-6 inline-block rounded-full border border-vx-border px-5 py-2 text-sm font-semibold hover:border-vx-accent">Back to Create</Link>
      </div>
    );
  }

  const list = <ThreadList threads={threads} activeId={active?.id} onOpen={open} onNew={blank} onPatch={patch} onDelete={remove} />;
  return (
    <div className="mx-auto flex h-[calc(100dvh-64px)] max-w-[1500px]">
      <aside className="hidden w-[280px] shrink-0 border-r border-vx-border bg-vx-panel md:block">{list}</aside>
      {drawer && (
        <div className="fixed inset-0 z-40 flex md:hidden" role="dialog" aria-modal="true" aria-label="Chats">
          <div className="w-[300px] bg-vx-panel">{list}</div>
          <button type="button" aria-label="Close chats" className="flex-1 bg-black/50" onClick={() => setDrawer(false)} />
        </div>
      )}
      <section className="flex min-w-0 flex-1 flex-col" aria-label="Conversation">
        <div className="flex items-center gap-2 border-b border-vx-border px-4 py-2">
          <button type="button" className="rounded-full border border-vx-border px-3 py-1.5 text-sm md:hidden" onClick={() => setDrawer(true)}>Chats</button>
          <label className="sr-only" htmlFor="chat-model">Model</label>
          <select id="chat-model" disabled={busy} value={model.id}
            onChange={(e) => (active ? patch(active.id, { model_id: e.target.value }) : setDraftModel(e.target.value))}
            className="min-w-0 flex-1 truncate rounded-lg border border-vx-border bg-vx-base px-3 py-1.5 text-sm text-vx-fg md:max-w-[420px] md:flex-none">
            {models.map((x) => <option key={x.id} value={x.id}>{x.name}, {credits(x.credits_per_reply)} per reply</option>)}
          </select>
          <button type="button" disabled={!active} aria-expanded={instrOpen} onClick={() => setInstrOpen((v) => !v)}
            className="rounded-full border border-vx-border px-3 py-1.5 text-sm disabled:opacity-50">Instructions</button>
        </div>

        {instrOpen && active && (
          <div className="space-y-2 border-b border-vx-border bg-vx-panel px-4 py-3">
            <label htmlFor="chat-instr" className="text-sm font-semibold">Instructions for this chat</label>
            <textarea id="chat-instr" value={instr} maxLength={MAX_PROMPT} onChange={(e) => setInstr(e.target.value)}
              placeholder="For example: answer in plain English and keep it short."
              className="min-h-24 w-full rounded-lg border border-vx-border bg-vx-base px-3 py-2 text-sm text-vx-fg placeholder:text-vx-fg-faint" />
            <div className="flex items-center gap-3 text-sm">
              <button type="button" disabled={instr === (active.system_prompt || '')}
                onClick={async () => { if (await patch(active.id, { system_prompt: instr })) { setSaved(true); setTimeout(() => setSaved(false), 1500); } }}
                className="rounded-full bg-vx-accent px-4 py-1.5 font-semibold text-vx-accent-ink disabled:opacity-50">Save</button>
              {saved && <span role="status" className="text-vx-accent">Saved</span>}
              <span className="ml-auto font-vx-mono text-vx-fg-muted vx-num">{instr.length}/{MAX_PROMPT}</span>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[760px] space-y-6 px-4 py-6">
            {messages.length === 0 && (
              <div className="py-16 text-center">
                <h1 className="vx-display text-[32px]">What do you want to work on?</h1>
                <p className="mt-2 text-vx-fg-muted">Every reply shows its price before you send. If a reply fails, the Credits come back.</p>
              </div>
            )}
            {messages.map((m) => (
              <article key={m.id} aria-label={m.role === 'user' ? 'You' : 'Assistant'} className={m.role === 'user' ? 'flex justify-end' : ''}>
                <div className={m.role === 'user' ? 'max-w-[85%] rounded-2xl bg-vx-panel px-4 py-3' : 'w-full'}>
                  {m.role === 'user' ? <p className="whitespace-pre-wrap break-words text-[15px]">{m.content}</p>
                    : <div aria-live={m.status === 'streaming' ? 'polite' : undefined}>{m.content ? <ChatText text={m.content} /> : <p className="text-vx-fg-muted">Thinking</p>}</div>}
                  {m.role === 'assistant' && m.status !== 'streaming' && <Footer m={m} />}
                </div>
              </article>
            ))}
            <div ref={endRef} />
          </div>
        </div>

        <div className="border-t border-vx-border px-4 py-3">
          <div className="mx-auto max-w-[820px]">
            {error && (
              <div role="alert" className="mb-2 rounded-lg border border-vx-danger/40 bg-vx-danger/[0.07] px-4 py-3 text-sm text-vx-danger">
                {error} {error.includes('Top up') && <Link className="underline" href="/app/credits">Top up</Link>}
              </div>
            )}
            <div className="flex items-end gap-2 rounded-2xl border border-vx-border bg-vx-panel p-2 focus-within:border-vx-accent">
              <label className="sr-only" htmlFor="chat-msg">Message</label>
              <textarea id="chat-msg" rows={1} value={text} maxLength={MAX_TEXT} placeholder="Message" onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                className="max-h-48 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] text-vx-fg outline-none placeholder:text-vx-fg-faint" />
              {busy
                ? <button type="button" onClick={() => abortRef.current?.abort()} className="rounded-full border border-vx-border px-4 py-2 text-sm font-semibold">Stop</button>
                : <button type="button" onClick={send} disabled={!text.trim()} className="rounded-full bg-vx-accent px-4 py-2 text-sm font-semibold text-vx-accent-ink disabled:opacity-50">Send for {credits(model.credits_per_reply)}</button>}
            </div>
            <p className="mt-1.5 px-1 text-xs text-vx-fg-muted">
              <span className="font-vx-mono text-vx-money vx-num">{credits(model.credits_per_reply)}</span> per reply, up to about {WORDS} words. Stop after text appears and you keep it and the price. If nothing arrives, the Credits come back.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
