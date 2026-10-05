'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GatewayError } from '../../_lib/gateway';
import { chatApi, chatErrorCopy, makeIdempotencyKey, sendTurn, uploadChatImage } from '../../_lib/chatApi';
import { attachmentLabel, prepareImage } from '../../_lib/chatImages';
import { NEW_CHAT, readDraft, writeDraft, readStars, toggleStar } from '../../_lib/chatLocal';
import { useFreeAllowance } from '../../_lib/useFreeAllowance';
import { freeLeftFor } from '../../_lib/freeAllowance';
import { researchProgressLabel } from '../../_lib/chatResearchUi';
import { AttachButton, AttachChips, useAttachments } from './AttachBar';
import { ChatText } from './ChatText';
import { SettingsPanel } from './SettingsPanel';
import { ThreadList } from './ThreadList';
import { ALL_CHATS } from '../../_lib/chatFolders';
import { defaultModel } from '../../_lib/chatModels';

const credits = (n) => `${n} Credit${n === 1 ? '' : 's'}`;
const MAX_TEXT = 8000;
const MAX_PROMPT = 4000;
const store = () => { try { return window.localStorage; } catch { return null; } };
// About three words for every four tokens, rounded to ten, from the chosen model's own reply cap.
const wordsFor = (tokens) => Math.round(((tokens || 1024) * 0.75) / 10) * 10;

function Footer({ m, starred, onStar }) {
  const [copied, setCopied] = useState(false);
  const price = m.credits === 0 ? 'Free' : credits(m.credits); // a reply that used a free allowance (ADR-0069)
  const label = m.status === 'error' ? 'Cut off. No Credits used' : m.status === 'canceled' ? `Stopped. ${price}` : price;
  const copy = async () => { try { await navigator.clipboard.writeText(m.content); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* blocked */ } };
  return (
    <p className="mt-2 flex items-center gap-3 font-vx-mono text-xs text-vx-fg-muted vx-num">
      <span>{label}</span>
      <button type="button" onClick={copy} className="rounded px-1.5 py-0.5 font-sans hover:text-vx-fg" aria-label="Copy reply">{copied ? 'Copied' : 'Copy'}</button>
      <button type="button" onClick={onStar} aria-pressed={starred} className="rounded px-1.5 py-0.5 font-sans hover:text-vx-fg" aria-label={starred ? 'Remove star' : 'Star reply'}>{starred ? '★ Starred' : '☆ Star'}</button>
    </p>
  );
}

export function ChatWorkspace() {
  const [models, setModels] = useState([]);
  const [threads, setThreads] = useState([]);
  const [folders, setFolders] = useState(null); // null: folders are not available here, so their controls stay hidden
  const [folder, setFolder] = useState(ALL_CHATS);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draftModel, setDraftModel] = useState('');
  const [text, setText] = useState(() => readDraft(store(), NEW_CHAT));
  const [stars, setStars] = useState([]);
  const [starredOnly, setStarredOnly] = useState(false);
  const [opts, setOpts] = useState({ thinking: false, web: false, research: false });
  const [progress, setProgress] = useState(null); // the step a Deep research reply is on: plan, search n of m, write
  const [limits, setLimits] = useState({ maxAttachments: 4, maxEdge: 2048 });
  const att = useAttachments(limits.maxAttachments);
  const freeMap = useFreeAllowance(); // free replies left today per model; empty while the feature is off
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [closed, setClosed] = useState(false);
  const [ready, setReady] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tiers, setTiers] = useState(() => new Set());
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
        // Folders are optional: if they fail to load, chat works without them.
        const [m, t, f] = await Promise.all([chatApi.models(), chatApi.threads(), chatApi.folders().catch(() => null)]);
        if (f) setFolders(f.folders);
        setModels(m.models); setLimits({ maxAttachments: m.max_attachments || 4, maxEdge: m.max_image_edge || 2048 }); setThreads(t.threads); setDraftModel(defaultModel(m.models)?.id || '');
      } catch (e) { fail(e); } finally { setReady(true); }
    })();
  }, [fail]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages]);
  // The unsent text follows the chat it was typed in; sending or clearing it forgets it.
  useEffect(() => { writeDraft(store(), active?.id ?? NEW_CHAT, text); }, [text, active?.id]);

  const model = models.find((x) => x.id === (active?.model_id ?? draftModel)) || defaultModel(models) || models[0];
  // An option counts only if the chosen model offers it; the price is the model's base plus each extra chosen.
  const offer = model?.options || { thinking: null, web: null, images: null };
  // Deep research is priced alone (ADR-0070): choosing it stands in for Thinking and Web search, and it cannot read images.
  const researchOn = opts.research && !!offer.research;
  const chosen = researchOn ? { research: true } : { thinking: opts.thinking && !!offer.thinking, web: opts.web && !!offer.web };
  const hasImages = att.items.length > 0;
  const imagesBlocked = hasImages && (!offer.images || researchOn); // images are chosen but this model or option cannot read them
  const price = researchOn
    ? (model?.credits_per_reply ?? 0) + offer.research.extra_credits
    : (model?.credits_per_reply ?? 0) + (chosen.thinking ? offer.thinking.extra_credits : 0) + (chosen.web ? offer.web.extra_credits : 0)
      + (hasImages && offer.images ? offer.images.extra_credits : 0);
  // A plain reply (no paid option) can use a free allowance; the server decides, this only labels the button.
  const freeLeft = freeLeftFor(freeMap, model?.id);
  const isFree = freeLeft > 0 && !researchOn && !chosen.thinking && !chosen.web && !hasImages;
  const open = async (id) => {
    try {
      const r = await chatApi.get(id);
      setActive(r.thread); setMessages(r.messages); setInstr(r.thread.system_prompt || ''); setError(null); setDrawer(false);
      setText(readDraft(store(), r.thread.id)); setStars(readStars(store(), r.thread.id)); setStarredOnly(false);
    } catch (e) { fail(e); }
  };
  const blank = () => { setActive(null); setMessages([]); setInstr(''); setError(null); setDrawer(false); setText(readDraft(store(), NEW_CHAT)); setStars([]); setStarredOnly(false); };
  const star = (id) => { if (active) setStars(toggleStar(store(), active.id, id)); };
  const shown = starredOnly ? messages.filter((x) => x.role === 'assistant' && stars.includes(x.id)) : messages;
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
  const selectModel = (id) => (active ? patch(active.id, { model_id: id }) : setDraftModel(id));
  const saveInstr = async () => { if (active && await patch(active.id, { system_prompt: instr })) { setSaved(true); setTimeout(() => setSaved(false), 1500); } };
  const byName = (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  const newFolder = async (name) => {
    try { const { folder: f } = await chatApi.createFolder(name); setFolders((fs) => [...fs, f].sort(byName)); setFolder(f.id); return true; } catch (e) { fail(e); return false; }
  };
  const renameFolder = async (id, name) => {
    try { const { folder: f } = await chatApi.renameFolder(id, name); setFolders((fs) => fs.map((x) => (x.id === id ? { ...x, name: f.name } : x)).sort(byName)); return true; } catch (e) { fail(e); return false; }
  };
  const deleteFolder = async (id) => {
    try {
      await chatApi.removeFolder(id);
      setFolders((fs) => fs.filter((x) => x.id !== id));
      setThreads((ts) => ts.map((t) => (t.folder_id === id ? { ...t, folder_id: null } : t)));
      setFolder((cur) => (cur === id ? ALL_CHATS : cur));
    } catch (e) { fail(e); }
  };
  const move = async (id, folderId) => {
    try { await chatApi.move(id, folderId); setThreads((ts) => ts.map((t) => (t.id === id ? { ...t, folder_id: folderId } : t))); } catch (e) { fail(e); }
  };

  async function send() {
    const content = text.trim();
    if (!content || busy || sendingRef.current || !model || imagesBlocked) return;
    sendingRef.current = true; setBusy(true); setError(null); setText('');
    let thread = active; let created = false; const pending = `pending-${Date.now()}`;
    try {
      // Images go to storage first, before anything is charged: a failed upload costs nothing.
      const keys = [];
      for (const it of att.items) keys.push(await uploadChatImage(await prepareImage(it.file, limits.maxEdge)));
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
        threadId: thread.id, text: content, key: makeIdempotencyKey(), options: chosen, attachments: keys, signal: ac.signal,
        onEvent: (ev, d) => {
          if (ev === 'start') setProgress(null);
          if (ev === 'progress') setProgress(d);
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
        att.clear();                                 // sent: the images are spent, so the next reply starts clean
        if (streamError) setError(chatErrorCopy(streamError));
        await open(thread.id);                       // the saved messages, with their real status and price
      }
      await refreshThreads();
    } catch (e) {
      if (e?.name === 'AbortError') { if (thread) await open(thread.id); await refreshThreads(); }
      else {
        setMessages((m) => m.filter((x) => x.id !== pending && x.id !== `u-${pending}`)); setText(content);
        if (e instanceof GatewayError && e.code === 'insufficient_balance') setError(chatErrorCopy(e.code, { credits: price }));
        else if (e instanceof Error && e.message === 'image_unreadable') setError(chatErrorCopy('image_unreadable'));
        else fail(e);
        if (created && thread) { chatApi.remove(thread.id).catch(() => {}); setThreads((ts) => ts.filter((t) => t.id !== thread.id)); setActive(null); }
      }
    } finally { setBusy(false); setProgress(null); sendingRef.current = false; abortRef.current = null; }
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

  const counted = folders && folders.map((f) => ({ ...f, count: threads.filter((t) => t.folder_id === f.id).length }));
  const list = (
    <ThreadList threads={threads} folders={counted} folder={folder} onFolder={setFolder} onNewFolder={newFolder} onRenameFolder={renameFolder}
      onDeleteFolder={deleteFolder} onMove={move} activeId={active?.id} onOpen={open} onNew={blank} onPatch={patch} onDelete={remove} />
  );
  const settings = (
    <SettingsPanel models={models} model={model} busy={busy} onSelectModel={selectModel} tiers={tiers} onTiers={setTiers} offer={offer} opts={opts} onOpts={setOpts} researchOn={researchOn}
      instr={instr} onInstr={setInstr} hasThread={!!active} canSaveInstr={!!active && instr !== (active.system_prompt || '')} onSaveInstr={saveInstr} saved={saved} maxPrompt={MAX_PROMPT} />
  );
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
          <p className="min-w-0 flex-1 truncate text-sm" aria-live="polite">
            <span className="font-semibold">{model.name}</span> <span className="font-vx-mono text-xs text-vx-money vx-num">{credits(model.credits_per_reply)} per reply</span>
          </p>
          <button type="button" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(true)} className="rounded-full border border-vx-border px-3 py-1.5 text-sm xl:hidden">Settings</button>
          <button type="button" disabled={!active || stars.length === 0} aria-pressed={starredOnly} onClick={() => setStarredOnly((v) => !v)}
            className="rounded-full border border-vx-border px-3 py-1.5 text-sm aria-pressed:border-vx-accent disabled:opacity-50">★ Starred</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[760px] space-y-6 px-4 py-6">
            {messages.length === 0 && (
              <div className="py-16 text-center">
                <h1 className="vx-display text-[32px]">What do you want to work on?</h1>
                <p className="mt-2 text-vx-fg-muted">Every reply shows its price before you send. If a reply fails, the Credits come back.</p>
              </div>
            )}
            {starredOnly && shown.length === 0 && <p className="py-8 text-center text-vx-fg-muted">No starred replies in this chat.</p>}
            {shown.map((m) => (
              <article key={m.id} aria-label={m.role === 'user' ? 'You' : 'Assistant'} className={m.role === 'user' ? 'flex justify-end' : ''}>
                <div className={m.role === 'user' ? 'max-w-[85%] rounded-2xl bg-vx-panel px-4 py-3' : 'w-full'}>
                  {m.role === 'user' ? (
                    <>
                      <p className="whitespace-pre-wrap break-words text-[15px]">{m.content}</p>
                      {m.attachments?.length > 0 && (
                        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Attached images">
                          {m.attachments.map((a, i) => <li key={i} className="rounded-full border border-vx-border px-2 py-0.5 text-xs text-vx-fg-muted">{attachmentLabel(a)}</li>)}
                        </ul>
                      )}
                    </>
                  )
                    : <div aria-live={m.status === 'streaming' ? 'polite' : undefined}>{m.content ? <ChatText text={m.content} /> : <p className="text-vx-fg-muted">{researchProgressLabel(progress) || 'Thinking'}</p>}</div>}
                  {m.role === 'assistant' && m.status !== 'streaming' && <Footer m={m} starred={stars.includes(m.id)} onStar={() => star(m.id)} />}
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
            {researchOn && (
              <p className="mb-2 text-xs text-vx-fg-muted">Plans a few searches, reads what the web returns, then writes a cited answer. It can take up to about a minute and works on text only. If it fails before the answer starts, the Credits come back.</p>
            )}
            <AttachChips items={att.items} onRemove={att.remove} disabled={busy} />
            {hasImages && !imagesBlocked && (
              <p className="mb-2 text-xs text-vx-fg-muted">Images are sent to the model provider to answer, and are deleted from our storage within a day.</p>
            )}
            {(att.notice || imagesBlocked) && (
              <p role="status" className="mb-2 text-sm text-vx-fg-muted">
                {imagesBlocked ? (researchOn ? 'Deep research reads text only. Remove the images or turn it off.' : 'This model cannot read images. Remove them or pick another model.') : att.notice}
              </p>
            )}
            <div className="flex items-end gap-2 rounded-2xl border border-vx-border bg-vx-panel p-2 focus-within:border-vx-accent">
              {offer.images && <AttachButton onPick={att.add} disabled={busy} full={att.items.length >= limits.maxAttachments} />}
              <label className="sr-only" htmlFor="chat-msg">Message</label>
              <textarea id="chat-msg" rows={1} value={text} maxLength={MAX_TEXT} placeholder="Message" onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                className="max-h-48 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] text-vx-fg outline-none placeholder:text-vx-fg-faint" />
              {busy
                ? <button type="button" onClick={() => abortRef.current?.abort()} className="rounded-full border border-vx-border px-4 py-2 text-sm font-semibold">Stop</button>
                : <button type="button" onClick={send} disabled={!text.trim() || imagesBlocked} className="rounded-full bg-vx-accent px-4 py-2 text-sm font-semibold text-vx-accent-ink disabled:opacity-50">{isFree ? `Send free (${freeLeft} left today)` : `Send for ${credits(price)}`}</button>}
            </div>
            <p className="mt-1.5 px-1 text-xs text-vx-fg-muted">
              <span className="font-vx-mono text-vx-money vx-num">{isFree ? 'Free' : credits(price)}</span> per reply{chosen.thinking || chosen.web ? ` (with ${[chosen.thinking && 'Thinking', chosen.web && 'Web search'].filter(Boolean).join(' and ')})` : ''}, up to about {wordsFor(model.max_reply_tokens)} words. Stop after text appears and you keep it and the price. If nothing arrives, the Credits come back.
            </p>
          </div>
        </div>
      </section>
      <aside className="hidden w-[320px] shrink-0 border-l border-vx-border bg-vx-base xl:block">{settings}</aside>
      {settingsOpen && (
        <div className="fixed inset-0 z-40 flex justify-end xl:hidden" role="dialog" aria-modal="true" aria-label="Chat settings">
          <button type="button" aria-label="Close settings" className="flex-1 bg-black/50" onClick={() => setSettingsOpen(false)} />
          <div className="relative w-[340px] max-w-[90vw] bg-vx-base">
            <button type="button" aria-label="Close settings" className="absolute right-3 top-3 z-10 rounded-full border border-vx-border px-3 py-1 text-sm" onClick={() => setSettingsOpen(false)}>Close</button>
            <div className="h-full pt-10">{settings}</div>
          </div>
        </div>
      )}
    </div>
  );
}
