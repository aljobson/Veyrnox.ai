'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';
import { getStoredUserId } from '../../../lib/authClient';
import { chatApi, chatErrorCopy } from '../../_lib/chatApi';
import { attachmentLabel } from '../../_lib/chatImages';
import { NEW_CHAT, addToDraft, clearNotice, readCreditsWarning, readDraft, readNotice, writeDraft, writeNotice, readStars, toggleStar } from '../../_lib/chatLocal';
import { useFreeAllowance } from '../../_lib/useFreeAllowance';
import { freeLeftFor } from '../../_lib/freeAllowance';
import { researchProgressLabel } from '../../_lib/chatResearchUi';
import { PersonaManager } from './PersonaManager';
import { AttachButton, AttachChips, useAttachments } from './AttachBar';
import { LibraryPicker } from '../LibraryPicker';
import { SkillsPanel } from './SkillsPanel';
import { StudioDraftCards } from './StudioDraftCards';
import { useCatalog } from '../../_lib/useCatalog';
import { skillById, skillInstructions } from '../../_lib/studioSkills';
import { ChatText } from './ChatText';
import { SettingsPanel } from './SettingsPanel';
import { ThreadList } from './ThreadList';
import { useChatSend } from './useChatSend';
import { ALL_CHATS } from '../../_lib/chatFolders';
import { defaultModel } from '../../_lib/chatModels';
import { CHAT_SCREEN_COPY, chatScreen, loadFailure } from '../../_lib/chatScreen';
import { ask, enter, forget, giveUp, land, leave, newChatView } from '../../_lib/chatSendHome';

const credits = (n) => `${n} Credit${n === 1 ? '' : 's'}`;
const MAX_TEXT = 8000;
const MAX_PROMPT = 4000;
const store = () => { try { return window.localStorage; } catch { return null; } };
const saveDraft = (chatId, text) => writeDraft(store(), getStoredUserId(), chatId, text);
const addDraft = (chatId, text) => addToDraft(store(), getStoredUserId(), chatId, text);
// What the last message sent from a chat ended with waits with that chat, as a code (chatLocal.js). It is put into words here each
// time the chat is opened, a page reload included, until a later message goes out from that chat or the chat is deleted.
const keepNotice = (chatId, code, extra) => writeNotice(store(), getStoredUserId(), chatId, code, extra);
const dropNotice = (chatId) => clearNotice(store(), getStoredUserId(), chatId);
const heldWarning = (chatId) => readCreditsWarning(store(), getStoredUserId(), chatId);
const waiting = (chatId) => { const n = readNotice(store(), getStoredUserId(), chatId); return n ? chatErrorCopy(n.code, n) : null; };
// About three words for every four tokens, rounded to ten, from the chosen model's own reply cap.
const wordsFor = (tokens) => Math.round(((tokens || 1024) * 0.75) / 10) * 10;
// A reply still arriving, or stopped or cut off and not yet read back from the server: it has no price and nothing to star.
const isLive = (m) => m.status === 'streaming' || m.status === 'saving' || m.status === 'lost';

function Footer({ m, starred, onStar }) {
  const [copied, setCopied] = useState(false);
  const price = m.credits === 0 ? 'Free' : credits(m.credits); // a reply that used a free allowance (ADR-0069)
  const label = m.status === 'error' ? 'Cut off. No Credits used' : m.status === 'canceled' ? `Stopped. ${price}` : price;
  const copy = async () => { try { await navigator.clipboard.writeText(m.content); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* blocked */ } };
  return (
    <p className="mt-2 flex items-center gap-3 font-vx-mono text-xs text-vx-fg-muted vx-num">
      <span>{label}</span>
      <button type="button" onClick={copy} className="rounded-sm px-1.5 py-0.5 font-sans hover:text-vx-fg" aria-label="Copy reply">{copied ? 'Copied' : 'Copy'}</button>
      <button type="button" onClick={onStar} aria-pressed={starred} className="rounded-sm px-1.5 py-0.5 font-sans hover:text-vx-fg" aria-label={starred ? 'Remove star' : 'Star reply'}>{starred ? '★ Starred' : '☆ Star'}</button>
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
  const [text, setText] = useState(() => readDraft(store(), getStoredUserId(), NEW_CHAT));
  const [stars, setStars] = useState([]);
  const [starredOnly, setStarredOnly] = useState(false);
  const [opts, setOpts] = useState({ thinking: false, web: false, research: false });
  const [limits, setLimits] = useState({ maxAttachments: 4, maxEdge: 2048 });
  const att = useAttachments(limits.maxAttachments);
  const [pickingLibrary, setPickingLibrary] = useState(false);
  const [skillId, setSkillId] = useState(''); // a Studio skill chosen for a chat that has not started (ADR-0073)
  const { models: studioModels, loading: studioLoading } = useCatalog();
  const freeMap = useFreeAllowance(); // free replies left today per model; empty while the feature is off
  const [error, setError] = useState(() => waiting(NEW_CHAT)); // a page that has just loaded shows a chat that has not started, and what waits for it
  const [closed, setClosed] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false); // the first load failed for a reason other than the two above
  const [attempt, setAttempt] = useState(0); // Try again runs the first load once more
  const [ready, setReady] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [personasOn, setPersonasOn] = useState(false); // Personas (ADR-0072): off, or failed to load, shows nothing
  const [personas, setPersonas] = useState([]);
  const [personaId, setPersonaId] = useState('');
  const [managingPersonas, setManagingPersonas] = useState(false);
  const [tiers, setTiers] = useState(() => new Set());
  const [instr, setInstr] = useState('');
  const [saved, setSaved] = useState(false);
  const endRef = useRef(null);
  // Which chat is on screen and which was last pressed (chatSendHome.js): a send that ends for another chat leaves this one alone.
  const chatView = useRef(null);
  if (chatView.current === null) chatView.current = newChatView();
  useEffect(() => { const v = chatView.current; enter(v); return () => leave(v); }, []);

  const fail = useCallback((e) => {
    const why = loadFailure(e);
    if (why === 'closed') setClosed(true);
    else if (why === 'signed_out') setSignedOut(true); // the sign-in dialog is already open; this is what sits behind it
    else setError(chatErrorCopy(e?.code));
    return why;
  }, []);
  const refreshThreads = useCallback(async () => { try { setThreads((await chatApi.threads()).threads); } catch (e) { fail(e); } }, [fail]);

  useEffect(() => {
    (async () => {
      try {
        // Folders are optional: if they fail to load, chat works without them.
        const [m, t, f] = await Promise.all([chatApi.models(), chatApi.threads(), chatApi.folders().catch(() => null)]);
        if (f) setFolders(f.folders);
        // Personas are optional too: any failure leaves the feature hidden and chat unchanged.
        chatApi.personas().then((r) => { if (r && r.enabled) { setPersonasOn(true); setPersonas(r.personas || []); } }).catch(() => {});
        setModels(m.models); setLimits({ maxAttachments: m.max_attachments || 4, maxEdge: m.max_image_edge || 2048 }); setThreads(t.threads); setDraftModel(defaultModel(m.models)?.id || '');
      } catch (e) { if (fail(e) === 'failed') setLoadFailed(true); } finally { setReady(true); }
    })();
  }, [fail, attempt]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages]);
  // The unsent text follows the chat it was typed in, for the user who typed it; sending or clearing it forgets it.
  useEffect(() => { saveDraft(active?.id ?? NEW_CHAT, text); }, [text, active?.id]);

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
    ask(chatView.current, id);
    try {
      const r = await chatApi.get(id);
      // Another chat was pressed while this one was read: that one is the one to show. A re-read of the chat still on screen refreshes it in place.
      if (chatView.current.asked !== id) { if (chatView.current.shown === id) setMessages(r.messages); return false; }
      setPersonaId(''); setActive(r.thread); setSkillId(''); setMessages(r.messages); setInstr(r.thread.system_prompt || ''); land(chatView.current, id); setError(waiting(id)); setDrawer(false);
      setText(readDraft(store(), getStoredUserId(), r.thread.id)); setStars(readStars(store(), getStoredUserId(), r.thread.id)); setStarredOnly(false); return true;
    } catch (e) { fail(e); if (giveUp(chatView.current, id)) { const kept = waiting(chatView.current.shown); if (kept) setError((was) => (was && was !== kept ? `${was} ${kept}` : kept)); } return false; }
  };
  // A chat that has not started. A notice waits for it too: one about a message that was sent before a chat was made, or whose chat no longer exists.
  const clear = () => { setPersonaId(''); setActive(null); setSkillId(''); setMessages([]); setInstr(''); land(chatView.current, NEW_CHAT); setError(waiting(NEW_CHAT)); setDrawer(false); setText(readDraft(store(), getStoredUserId(), NEW_CHAT)); setStars([]); setStarredOnly(false); };
  const blank = () => { ask(chatView.current, NEW_CHAT); clear(); };
  const star = (id) => { if (active) setStars(toggleStar(store(), getStoredUserId(), active.id, id)); };
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
    try { await chatApi.remove(id); dropNotice(id); setThreads((ts) => ts.filter((t) => t.id !== id)); if (forget(chatView.current, id)) clear(); } catch (e) { fail(e); }
  };
  const selectModel = (id) => (active ? patch(active.id, { model_id: id }) : setDraftModel(id));
  // Choosing a persona fills the draft of a chat that has not started: its instructions, its model if still offered, and its options.
  // It never touches an existing chat. Options the model does not offer are ignored at send time, as for any model.
  // Choosing a skill does the same for a chat that has not started, with built-in instructions that include the live Studio model list.
  const pickSkill = (id) => {
    const s = skillById(id);
    if (!s) return;
    setSkillId(id); setPersonaId('');
    setInstr(skillInstructions(s, studioModels));
    if (models.some((m) => m.id === s.model)) setDraftModel(s.model);
    setOpts({ thinking: false, web: false, research: false });
    setTimeout(() => document.getElementById('chat-msg')?.focus(), 0);
  };
  const clearSkill = () => { setSkillId(''); setInstr(''); };
  // ?asset=<job id>, from the Library's Ask about this: that image is attached to a chat that has not started, once. The same
  // checks as From library apply (the server confirms it is the person's own, and the size cap is said up front).
  const assetFromUrl = useRef(false);
  useEffect(() => {
    if (assetFromUrl.current || !models.length || active) return;
    assetFromUrl.current = true;
    const id = new URLSearchParams(window.location.search).get('asset');
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return;
    (async () => {
      try {
        const a = await gatewayFetch(`/jobs/${encodeURIComponent(id)}/asset`);
        if (!String(a.mime_type).startsWith('image/')) { att.setNotice('Chat reads images only. Pick an image from your Library.'); return; }
        await pickFromLibrary({ id, url: a.url, label: 'Library image' });
        document.getElementById('chat-msg')?.focus();
      } catch {
        att.setNotice('That image could not be opened. It may have expired.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models.length, active]);
  const skillFromUrl = useRef(false);
  useEffect(() => {
    if (skillFromUrl.current || studioLoading || !models.length || active) return;
    skillFromUrl.current = true;
    const wanted = new URLSearchParams(window.location.search).get('skill');
    if (wanted && skillById(wanted)) pickSkill(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioLoading, models.length, active]);
  const pickPersona = (id) => {
    setSkillId('');
    setPersonaId(id);
    const p = personas.find((x) => x.id === id);
    if (!p) return;
    setInstr(p.instructions);
    if (p.model_id && models.some((m) => m.id === p.model_id)) setDraftModel(p.model_id);
    setOpts({ thinking: p.thinking, web: p.web, research: false });
  };
  const changePersonas = (next) => { setPersonas(next); if (!next.some((x) => x.id === personaId)) setPersonaId(''); };
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

  // A Library image goes by id and is read from storage by the server, which cannot shrink it, so one over the size cap
  // is said so here, before it is chosen, instead of failing at Send.
  async function pickFromLibrary(it) {
    setPickingLibrary(false);
    const size = await new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve({ w: im.naturalWidth, h: im.naturalHeight });
      im.onerror = () => resolve(null);
      im.src = it.url;
    });
    if (size && Math.max(size.w, size.h) > limits.maxEdge) {
      att.setNotice(`That image is ${size.w} by ${size.h}. Chat reads images up to ${limits.maxEdge} pixels on the long side. Pick a smaller one, or download it, shrink it and attach the file.`);
      return;
    }
    att.addAsset(it);
  }

  // Sending, and every way a send can end, is its own hook (useChatSend.js): this file is kept under 500 lines.
  const { send, stop, busy, stopping, checking, progress } = useChatSend({
    text, setText, model, imagesBlocked, chosen, price, active, setActive, messages, setMessages, setThreads, setError,
    att, limits, draftModel, folders, folder, instr, open, refreshThreads, fail, chatView, saveDraft, addDraft, keepNotice, dropNotice, heldWarning,
  });

  if (!ready) return <div className="p-8 text-sm text-vx-fg-muted" role="status">Loading</div>;
  const view = chatScreen({ closed, signedOut, loadFailed, modelCount: models.length });
  if (view !== 'ready') {
    const action = 'mt-6 inline-block rounded-full border border-vx-border px-5 py-2 text-sm font-semibold hover:border-vx-accent';
    const retry = () => { setReady(false); setLoadFailed(false); setError(waiting(NEW_CHAT)); setAttempt((n) => n + 1); };
    return (
      <div className="mx-auto max-w-[640px] px-4 py-16">
        <h1 className="vx-display text-[32px]">{CHAT_SCREEN_COPY[view].title}</h1>
        <p className="mt-3 text-vx-fg-body">{(view === 'failed' && error) || CHAT_SCREEN_COPY[view].body}</p>
        {view === 'signed_out'
          ? <button type="button" className={action} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>Sign in</button>
          : view === 'failed'
            ? <button type="button" className={action} onClick={retry}>Try again</button>
            : <Link href="/app/create" className={action}>Back to Create</Link>}
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
      personasOn={personasOn} personas={personas} personaId={personaId} onPersona={pickPersona} onManagePersonas={() => setManagingPersonas(true)}
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
                {!active && <SkillsPanel selectedId={skillId} onPick={pickSkill} disabled={busy} />}
              </div>
            )}
            {starredOnly && shown.length === 0 && <p className="py-8 text-center text-vx-fg-muted">No starred replies in this chat.</p>}
            {shown.map((m) => (
              <article key={m.id} aria-label={m.role === 'user' ? 'You' : 'Assistant'} className={m.role === 'user' ? 'flex justify-end' : ''}>
                <div className={m.role === 'user' ? 'max-w-[85%] rounded-2xl bg-vx-panel px-4 py-3' : 'w-full'}>
                  {m.role === 'user' ? (
                    <>
                      <p className="whitespace-pre-wrap wrap-break-word text-[15px]">{m.content}</p>
                      {m.attachments?.length > 0 && (
                        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Attached images">
                          {m.attachments.map((a, i) => <li key={i} className="rounded-full border border-vx-border px-2 py-0.5 text-xs text-vx-fg-muted">{attachmentLabel(a)}</li>)}
                        </ul>
                      )}
                    </>
                  )
                    : <div aria-live={m.status === 'streaming' ? 'polite' : undefined}>{m.content ? <ChatText text={m.content} /> : <p className="text-vx-fg-muted">{m.status === 'saving' ? 'Stopping' : m.status === 'lost' ? 'Connection lost. Checking what was saved.' : researchProgressLabel(progress) || 'Thinking'}</p>}</div>}
                  {(m.status === 'saving' || m.status === 'lost') && m.content && <p role="status" className="mt-2 font-vx-mono text-xs text-vx-fg-muted">{m.status === 'saving' ? 'Stopped. Saving this reply.' : 'Connection lost before this reply finished.'}</p>}
                  {m.role === 'assistant' && !isLive(m) && <StudioDraftCards text={m.content} models={studioModels} />}
                  {m.role === 'assistant' && !isLive(m) && <Footer m={m} starred={stars.includes(m.id)} onStar={() => star(m.id)} />}
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
              <p className="mb-2 text-xs text-vx-fg-muted">
                {att.items.some((i) => i.asset)
                  ? (att.items.some((i) => !i.asset)
                    ? 'Images are sent to the model provider to answer. Uploaded files are deleted from our storage within a day; images from your Library stay there.'
                    : 'Images are sent to the model provider to answer. They stay in your Library.')
                  : 'Images are sent to the model provider to answer, and are deleted from our storage within a day.'}
                {att.items.some((i) => i.video) && ' Your video is not uploaded: only a few frames from it, taken on your device, are.'}
              </p>
            )}
            {(att.notice || imagesBlocked) && (
              <p role="status" className="mb-2 text-sm text-vx-fg-muted">
                {imagesBlocked ? (researchOn ? 'Deep research reads text only. Remove the images or turn it off.' : 'This model cannot read images. Remove them or pick another model.') : att.notice}
              </p>
            )}
            {((offer.web && !researchOn) || offer.images || skillId) && (
              <div className="mb-2 flex flex-wrap gap-2">
                {skillId && !active && (
                  <button type="button" onClick={clearSkill} disabled={busy} aria-label={`Skill: ${skillById(skillId)?.name}. Remove`}
                    className="rounded-full border border-vx-accent px-3 py-1.5 text-xs font-semibold text-vx-fg disabled:opacity-50">
                    Skill: {skillById(skillId)?.name} <span aria-hidden="true">×</span>
                  </button>
                )}
                {offer.web && !researchOn && (
                  <button type="button" aria-pressed={opts.web} disabled={busy}
                    aria-label={`Web search, plus ${credits(offer.web.extra_credits)}`}
                    onClick={() => setOpts({ ...opts, web: !opts.web, research: false })}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${opts.web ? 'border-vx-accent text-vx-fg' : 'border-vx-border text-vx-fg-muted hover:text-vx-fg'}`}>
                    Web search <span className="font-vx-mono vx-num">+{offer.web.extra_credits}</span>
                  </button>
                )}
                {offer.images && (
                  <button type="button" disabled={busy || att.items.length >= limits.maxAttachments} onClick={() => setPickingLibrary(true)}
                    title={att.items.length >= limits.maxAttachments ? 'The most images for one reply' : 'Use an image you already made'}
                    className="rounded-full border border-vx-border px-3 py-1.5 text-xs font-semibold text-vx-fg-muted hover:text-vx-fg disabled:opacity-50">
                    From library
                  </button>
                )}
              </div>
            )}
            <div className="flex items-end gap-2 rounded-2xl border border-vx-border bg-vx-panel p-2 focus-within:border-vx-accent">
              {offer.images && <AttachButton onPick={att.add} disabled={busy} full={att.items.length >= limits.maxAttachments} />}
              <label className="sr-only" htmlFor="chat-msg">Message</label>
              <textarea id="chat-msg" rows={1} value={text} maxLength={MAX_TEXT} placeholder={skillById(skillId)?.starter || 'Message'} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                className="max-h-48 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] text-vx-fg outline-hidden placeholder:text-vx-fg-faint" />
              {busy
                ? <button type="button" onClick={stop} disabled={stopping || checking} className="rounded-full border border-vx-border px-4 py-2 text-sm font-semibold disabled:opacity-50">{stopping ? 'Stopping' : checking ? 'Checking' : 'Stop'}</button>
                : <button type="button" onClick={send} disabled={!text.trim() || imagesBlocked} className="rounded-full bg-vx-accent px-4 py-2 text-sm font-semibold text-vx-accent-ink disabled:opacity-50">{isFree ? `Send free (${freeLeft} left today)` : `Send for ${credits(price)}`}</button>}
            </div>
            <p className="mt-1.5 px-1 text-xs text-vx-fg-muted">
              <span className="font-vx-mono text-vx-money vx-num">{isFree ? 'Free' : credits(price)}</span> per reply{chosen.thinking || chosen.web ? ` (with ${[chosen.thinking && 'Thinking', chosen.web && 'Web search'].filter(Boolean).join(' and ')})` : ''}, up to about {wordsFor(model.max_reply_tokens)} words. Stop after text appears and you keep it and the price. If nothing arrives, the Credits come back.
            </p>
          </div>
        </div>
      </section>
      <aside className="hidden w-[320px] shrink-0 border-l border-vx-border bg-vx-base xl:block">{settings}</aside>
      {pickingLibrary && <LibraryPicker onPick={pickFromLibrary} onClose={() => setPickingLibrary(false)} />}
      {settingsOpen && (
        <div className="fixed inset-0 z-40 flex justify-end xl:hidden" role="dialog" aria-modal="true" aria-label="Chat settings">
          <button type="button" aria-label="Close settings" className="flex-1 bg-black/50" onClick={() => setSettingsOpen(false)} />
          <div className="relative w-[340px] max-w-[90vw] bg-vx-base">
            <button type="button" aria-label="Close settings" className="absolute right-3 top-3 z-10 rounded-full border border-vx-border px-3 py-1 text-sm" onClick={() => setSettingsOpen(false)}>Close</button>
            <div className="h-full pt-10">{settings}</div>
          </div>
        </div>
      )}
      {managingPersonas && <PersonaManager personas={personas} models={models} onChange={changePersonas} onClose={() => setManagingPersonas(false)} />}
    </div>
  );
}
