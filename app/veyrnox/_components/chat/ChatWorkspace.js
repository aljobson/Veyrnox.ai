'use client';
import { helperCopy } from '../../../../lib/i18n/helperCopy.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { pluralKey, tOr } from '../../../../lib/i18n/translate.mjs';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';
import { getStoredUserId } from '../../../lib/authClient';
import { chatApi, chatErrorCopy } from '../../_lib/chatApi';
import { takeTemplateChatDraft } from '../../_lib/chatTemplateDraft';
import { attachmentLabel } from '../../_lib/chatImages';
import { NEW_CHAT, addToDraft, clearNotice, readCreditsWarning, readDraft, readNotice, writeDraft, writeNotice, readStars, toggleStar } from '../../_lib/chatLocal';
import { useFreeAllowance } from '../../_lib/useFreeAllowance';
import { freeLeftFor } from '../../_lib/freeAllowance';
import { researchProgressLabelDiagnostic as researchProgressLabel } from '../../_lib/chatResearchUi';
import { PersonaManager } from './PersonaManager';
import { AttachButton, AttachChips, useAttachments } from './AttachBar';
import { LibraryPicker } from '../LibraryPicker';
import { SkillsPanel } from './SkillsPanel';
import { StudioSkillIcon } from './StudioSkillIcon';
import { StudioDraftCards } from './StudioDraftCards';
import { useCatalog } from '../../_lib/useCatalog';
import { MAX_SELECTED_SKILLS, skillById, skillIdsFromSearch, skillsInstructions } from '../../_lib/studioSkills';
import { ChatText } from './ChatText';
import { SettingsPanel } from './SettingsPanel';
import { ComposerControls, ComposerTypeTabs } from './ComposerControls';
import { MediaComposer } from './MediaComposer';
import { MediaCanvas } from './MediaCanvas';
import { useChatMediaGeneration } from './useChatMediaGeneration';
import { ThreadList } from './ThreadList';
import { useChatSend } from './useChatSend';
import { ALL_CHATS } from '../../_lib/chatFolders';
import { defaultModel } from '../../_lib/chatModels';
import { COMPOSER_KINDS } from '../../_lib/chatMedia';
import { CHAT_SCREEN_COPY, chatScreen, loadFailure } from '../../_lib/chatScreen';
import { ask, enter, forget, giveUp, land, leave, newChatView, onScreen } from '../../_lib/chatSendHome';
import { askKeptWarning, settleKeptWarning } from '../../_lib/chatWarning';

function errorText(t, error) {
  const code = error.code || 'unknown';
  const fallback = chatErrorCopy(code, error.extra);
  const key = t.messages[`app.chat.error.${code}`] ? code : code.startsWith('provider_') ? 'provider_failed' : 'unknown';
  let text = tOr(t, `app.chat.error.${key}`, fallback, { n: error.extra?.credits ?? t('app.chat.error.more') });
  if (error.before) text = t('app.chat.error.before', { current: text, previous: errorText(t, error.before) });
  if (error.following) text += ` ${errorText(t, error.following)}`;
  return text;
}

function credits(t, locale, n) { return t(pluralKey(t, locale, 'app.chat.settings.credits', n), { count: locale === 'en' ? String(n) : n.toLocaleString(localeTag(locale)) }); }
const MAX_TEXT = 8000;
const MAX_PROMPT = 4000;
const store = () => { try { return window.localStorage; } catch { return null; } };
const saveDraft = (chatId, text) => writeDraft(store(), getStoredUserId(), chatId, text);
const addDraft = (chatId, text) => addToDraft(store(), getStoredUserId(), chatId, text);
// What the last message sent from a chat ended with waits with that chat, as a code (chatLocal.js). It is put into words here each
// time the chat is opened, a page reload included, until a later message is sent from that chat, the chat is deleted, or (a warning
// about a turn that was not settled) the server says that turn has settled.
const keepNotice = (chatId, code, extra) => writeNotice(store(), getStoredUserId(), chatId, code, extra);
const dropNotice = (chatId) => clearNotice(store(), getStoredUserId(), chatId);
const heldWarning = (chatId) => readCreditsWarning(store(), getStoredUserId(), chatId);
const waiting = (chatId) => { const n = readNotice(store(), getStoredUserId(), chatId); return n ? { code: n.code, extra: n } : null; };
// A warning about a turn that was not settled is kept with what the server can be asked about it by: the turn's job, or the key its
// send went out with (chatWarning.js). When its chat arrives on screen each turn it stands for is asked about, and once the server
// has settled them all the warning is taken out of the store, or what is kept is changed, before the screen reads it.
const askKept = (chatId) => askKeptWarning({ warning: heldWarning(chatId), getJob: chatApi.job, closeSend: chatApi.closeSend });
const settleKept = (chatId, asked) => settleKeptWarning(store(), getStoredUserId(), chatId, asked);
// About three words for every four tokens, rounded to ten, from the chosen model's own reply cap.
const wordsFor = (tokens) => Math.round(((tokens || 1024) * 0.75) / 10) * 10;
// A reply still arriving, or stopped or cut off and not yet read back from the server: it has no price and nothing to star.
const isLive = (m) => m.status === 'streaming' || m.status === 'saving' || m.status === 'lost';

function Footer({ m, starred, onStar }) {
  const { t, locale } = useI18n();
  const [copied, setCopied] = useState(false);
  const price = m.credits === 0 ? t('publish.plan.colFree') : credits(t, locale, m.credits); // a reply that used a free allowance (ADR-0069)
  const label = m.status === 'error' ? t("app.chat.workspace.cutOff") : m.status === 'canceled' ? t('app.chat.workspace.stoppedPrice', { price }) : price;
  const copy = async () => { try { await navigator.clipboard.writeText(m.content); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* blocked */ } };
  return (
    <p className="mt-2 flex items-center gap-3 font-vx-mono text-xs text-vx-fg-muted vx-num">
      <span>{label}</span>
      <button type="button" onClick={copy} className="rounded-sm px-1.5 py-0.5 font-sans hover:text-vx-fg" aria-label={t("app.chat.workspace.copy")}>{copied ? t("common.copied") : t("common.copy")}</button>
      <button type="button" onClick={onStar} aria-pressed={starred} className="rounded-sm px-1.5 py-0.5 font-sans hover:text-vx-fg" aria-label={starred ? t("app.chat.workspace.unstar") : t("app.chat.workspace.starReply")}>{starred ? t("app.chat.workspace.starred") : t("app.chat.workspace.star")}</button>
    </p>
  );
}

export function ChatWorkspace() {
  const { t, locale } = useI18n();
  const number = n => locale === 'en' ? String(n) : n.toLocaleString(localeTag(locale));
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
  const [skillIds, setSkillIds] = useState([]); // Studio skills composed for a chat that has not started (ADR-0073)
  const { models: studioModels, live: studioCatalogLive, loading: studioLoading } = useCatalog();
  const [composerKind, setComposerKind] = useState(COMPOSER_KINDS.CHAT);
  const [mediaPrompt, setMediaPrompt] = useState('');
  const mediaGeneration = useChatMediaGeneration({ kind: composerKind, models: studioModels, catalogLive: studioCatalogLive });
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
    else setError({ code: e?.code, extra: e?.body });
    return why;
  }, []);
  const refreshThreads = useCallback(async () => { try { setThreads((await chatApi.threads()).threads); } catch (e) { fail(e); } }, [fail]);

  useEffect(() => {
    (async () => {
      try {
        // Folders are optional: if they fail to load, chat works without them.
        const [m, threadResult, f] = await Promise.all([chatApi.models(), chatApi.threads(), chatApi.folders().catch(() => null)]);
        if (f) setFolders(f.folders);
        // Personas are optional too: any failure leaves the feature hidden and chat unchanged.
        chatApi.personas().then((r) => { if (r && r.enabled) { setPersonasOn(true); setPersonas(r.personas || []); } }).catch(() => {});
        setModels(m.models); setLimits({ maxAttachments: m.max_attachments || 4, maxEdge: m.max_image_edge || 2048 }); setThreads(threadResult.threads); setDraftModel(defaultModel(m.models)?.id || '');
      } catch (e) { if (fail(e) === 'failed') setLoadFailed(true); } finally { setReady(true); }
    })();
  }, [fail, attempt]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [messages]);
  // The unsent text follows the chat it was typed in, for the user who typed it; sending or clearing it forgets it.
  useEffect(() => { saveDraft(active?.id ?? NEW_CHAT, text); }, [text, active?.id]);
  const templateDraftHandoff = useRef(false);
  useEffect(() => {
    // Keep the handoff queued while authentication is required; signing in may reload this page.
    if (templateDraftHandoff.current || active || !ready || signedOut) return;
    templateDraftHandoff.current = true;
    let draft = null;
    try { draft = takeTemplateChatDraft(window.sessionStorage); } catch { /* Browser storage can be unavailable. */ }
    if (draft) setText(draft.prompt);
  }, [active, ready, signedOut]);

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
      const asked = await askKept(id); // the job of a kept warning first: the chat read after it shows what that turn left
      const r = await chatApi.get(id);
      // Another chat was pressed while this one was read: that one is the one to show. A re-read of the chat still on screen refreshes it in place.
      if (chatView.current.asked !== id) { if (chatView.current.shown === id) setMessages(r.messages); return false; }
      settleKept(id, asked); // in the store, so the notice and the box read from it below are what the server now says
      setPersonaId(''); setActive(r.thread); setSkillIds([]); setMessages(r.messages); setInstr(r.thread.system_prompt || ''); land(chatView.current, id); setError(waiting(id)); setDrawer(false);
      setText(readDraft(store(), getStoredUserId(), r.thread.id)); setStars(readStars(store(), getStoredUserId(), r.thread.id)); setStarredOnly(false); return true;
    } catch (e) { fail(e); if (giveUp(chatView.current, id)) { const kept = waiting(chatView.current.shown); if (kept) setError((was) => (was && was.code !== kept.code ? { ...was, following: kept } : kept)); } return false; }
  };
  // New chat has no chat to read, so what is kept for it is shown at once and its job is asked after. The screen changes only
  // while New chat is still on it and still says that warning: a notice set since, or another chat's, is left alone.
  const settleNew = async () => {
    const asked = await askKept(NEW_CHAT);
    if (!settleKept(NEW_CHAT, asked) || !onScreen(chatView.current, NEW_CHAT)) return;
    const was = asked.warning.code;
    setError((now) => (now?.code === was ? waiting(NEW_CHAT) : now));
  };
  useEffect(() => { settleNew(); }, []); // once: a page that has just loaded shows New chat
  // A chat that has not started. A notice waits for it too: one about a message that was sent before a chat was made, or whose chat no longer exists.
  const clear = () => { setPersonaId(''); setActive(null); setSkillIds([]); setMessages([]); setInstr(''); land(chatView.current, NEW_CHAT); setError(waiting(NEW_CHAT)); setDrawer(false); setText(readDraft(store(), getStoredUserId(), NEW_CHAT)); setStars([]); setStarredOnly(false); settleNew(); };
  const blank = () => { ask(chatView.current, NEW_CHAT); clear(); };
  const star = (id) => { if (active) setStars(toggleStar(store(), getStoredUserId(), active.id, id)); };
  const shown = starredOnly ? messages.filter((x) => x.role === 'assistant' && stars.includes(x.id)) : messages;
  const patch = async (id, body) => {
    try {
      const { thread } = await chatApi.patch(id, body);
      setThreads((ts) => ts.map((item) => (item.id === id ? { ...item, ...thread } : item)));
      setActive((a) => (a?.id === id ? { ...a, ...thread } : a));
      return true;
    } catch (e) { fail(e); return false; }
  };
  const remove = async (id) => {
    try { await chatApi.remove(id); dropNotice(id); setThreads((ts) => ts.filter((thread) => thread.id !== id)); if (forget(chatView.current, id)) clear(); } catch (e) { fail(e); }
  };
  const selectModel = (id) => (active ? patch(active.id, { model_id: id }) : setDraftModel(id));
  // Choosing a persona fills the draft of a chat that has not started: its instructions, its model if still offered, and its options.
  // It never touches an existing chat. Options the model does not offer are ignored at send time, as for any model.
  // Skills compose for a chat that has not started. Their instructions share one preamble and one bounded live model list.
  const pickSkill = (id) => {
    const s = skillById(id);
    if (!s) return;
    if (!skillIds.includes(id) && skillIds.length >= MAX_SELECTED_SKILLS) return;
    const next = skillIds.includes(id) ? skillIds.filter((skillId) => skillId !== id) : [...skillIds, id];
    setSkillIds(next); setPersonaId('');
    setInstr(skillsInstructions(next.map(skillById), studioModels));
    if (models.some((m) => m.id === s.model)) setDraftModel(s.model);
    setOpts({ thinking: false, web: false, research: false });
    setTimeout(() => document.getElementById('chat-msg')?.focus(), 0);
  };
  const clearSkill = (id) => {
    const next = skillIds.filter((skillId) => skillId !== id);
    setSkillIds(next);
    setInstr(skillsInstructions(next.map(skillById), studioModels));
  };
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
        if (!String(a.mime_type).startsWith('image/')) { att.setNotice(t("app.chat.workspace.imagesOnly")); return; }
        await pickFromLibrary({ id, url: a.url, label: t("app.chat.workspace.libraryImage") });
        document.getElementById('chat-msg')?.focus();
      } catch {
        att.setNotice(t("app.chat.workspace.imageExpired"));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models.length, active]);
  const skillFromUrl = useRef(false);
  useEffect(() => {
    if (skillFromUrl.current || studioLoading || !models.length || active) return;
    skillFromUrl.current = true;
    const wanted = skillIdsFromSearch(window.location.search);
    if (!wanted.length) return;
    const frame = window.requestAnimationFrame(() => {
      setSkillIds(wanted); setPersonaId('');
      setInstr(skillsInstructions(wanted.map(skillById), studioModels));
      const first = skillById(wanted[0]);
      if (first && models.some((m) => m.id === first.model)) setDraftModel(first.model);
      setOpts({ thinking: false, web: false, research: false });
    });
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studioLoading, models.length, active]);
  const pickPersona = (id) => {
    setSkillIds([]);
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
      setThreads((ts) => ts.map((thread) => (thread.folder_id === id ? { ...thread, folder_id: null } : thread)));
      setFolder((cur) => (cur === id ? ALL_CHATS : cur));
    } catch (e) { fail(e); }
  };
  const move = async (id, folderId) => {
    try { await chatApi.move(id, folderId); setThreads((ts) => ts.map((thread) => (thread.id === id ? { ...thread, folder_id: folderId } : thread))); } catch (e) { fail(e); }
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
      att.setNotice(t('app.chat.workspace.imageSize', { width: number(size.w), height: number(size.h), limit: number(limits.maxEdge) }));
      return;
    }
    att.addAsset(it);
  }

  // Sending, and every way a send can end, is its own hook (useChatSend.js): this file is kept under 500 lines.
  const { send, stop, busy, stopping, checking, progress } = useChatSend({
    text, setText, model, imagesBlocked, chosen, price, active, setActive, messages, setMessages, setThreads, setError,
    att, limits, draftModel, folders, folder, instr, open, refreshThreads, fail, chatView, saveDraft, addDraft, keepNotice, dropNotice, heldWarning,
    errorCopy: (code, extra) => ({ code, extra }),
    unchargedCopy: (code, extra, warning) => ({ code, extra, before: { code: warning.code, extra: warning } }),
  });

  if (!ready) return <div className="p-8 text-sm text-vx-fg-muted" role="status">{t("app.chat.loading")}</div>;
  const view = chatScreen({ closed, signedOut, loadFailed, modelCount: models.length });
  if (view !== 'ready') {
    const action = 'mt-6 inline-block rounded-full border border-vx-border px-5 py-2 text-sm font-semibold hover:border-vx-accent';
    const retry = () => { setReady(false); setLoadFailed(false); setError(waiting(NEW_CHAT)); setAttempt((n) => n + 1); };
    return (
      <div className="mx-auto max-w-[640px] px-4 py-16">
        <h1 className="vx-display text-[32px]">{tOr(t, `app.chat.screen.${view}.title`, CHAT_SCREEN_COPY[view].title)}</h1>
        <p className="mt-3 text-vx-fg-body">{(view === 'failed' && error && errorText(t, error)) || tOr(t, `app.chat.screen.${view}.body`, CHAT_SCREEN_COPY[view].body)}</p>
        {view === 'signed_out'
          ? <button type="button" className={action} onClick={() => window.dispatchEvent(new CustomEvent('veyrnox:auth-required'))}>{t("oauth.signIn")}</button>
          : view === 'failed'
            ? <button type="button" className={action} onClick={retry}>{t("recovery.retry")}</button>
            : <Link href="/app/create" className={action}>{t("app.chat.workspace.back")}</Link>}
      </div>
    );
  }

  const counted = folders && folders.map((f) => ({ ...f, count: threads.filter((thread) => thread.folder_id === f.id).length }));
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
      <aside className="hidden w-[280px] shrink-0 border-e border-vx-border bg-vx-panel md:block">{list}</aside>
      {drawer && (
        <div className="fixed inset-0 z-40 flex md:hidden" role="dialog" aria-modal="true" data-testid="chat-drawer" aria-label={t("app.chat.chats")}>
          <div className="w-[300px] bg-vx-panel">{list}</div>
          <button type="button" aria-label={t("app.chat.closeChats")} className="flex-1 bg-black/50" onClick={() => setDrawer(false)} />
        </div>
      )}
      <section className="flex min-w-0 flex-1 flex-col" data-testid="chat-conversation" aria-label={t("app.chat.conversation")}>
        <div className="flex items-center gap-2 border-b border-vx-border px-4 py-2">
          <button data-testid="chat-open-drawer" type="button" className="rounded-full border border-vx-border px-3 py-1.5 text-sm md:hidden" onClick={() => setDrawer(true)}>{t("app.chat.chats")}</button>
          <p className="min-w-0 flex-1 truncate text-sm" aria-live="polite">
            <span className="font-semibold">{composerKind === COMPOSER_KINDS.CHAT ? model.name : mediaGeneration.model?.name || t('app.chat.workspace.noModel', { kind: tOr(t, `app.editor.media.kind.${composerKind}`, composerKind) })}</span>{' '}
            <span className="font-vx-mono text-xs text-vx-money vx-num">
              {composerKind === COMPOSER_KINDS.CHAT ? t('app.chat.workspace.perReply', { price: credits(t, locale, model.credits_per_reply) }) : mediaGeneration.model ? t('app.chat.workspace.base', { count: number(mediaGeneration.model.credits) }) : ''}
            </span>
          </p>
          {composerKind === COMPOSER_KINDS.CHAT && <button type="button" data-assistant-target="chat.settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(true)} className="rounded-full border border-vx-border px-3 py-1.5 text-sm xl:hidden">{t("app.chat.settings")}</button>}
          {composerKind === COMPOSER_KINDS.CHAT && <button type="button" disabled={!active || stars.length === 0} aria-pressed={starredOnly} onClick={() => setStarredOnly((v) => !v)}
            className="rounded-full border border-vx-border px-3 py-1.5 text-sm aria-pressed:border-vx-accent disabled:opacity-50">{t("app.chat.workspace.starred")}</button>}
        </div>

        <div className="flex-1 overflow-y-auto">
          {composerKind !== COMPOSER_KINDS.CHAT ? <MediaCanvas kind={composerKind} media={mediaGeneration} /> : <div className="mx-auto max-w-[760px] space-y-6 px-4 py-6">
            {messages.length === 0 && (
              <div className="py-16 text-center">
                <h1 data-testid="chat-title" className="vx-display text-[32px]">{t("app.chat.workOn")}</h1>
                <p className="mt-2 text-vx-fg-muted">{t("app.chat.priceHelp")}</p>
                {!active && <SkillsPanel selectedIds={skillIds} onPick={pickSkill} disabled={busy} />}
              </div>
            )}
            {starredOnly && shown.length === 0 && <p className="py-8 text-center text-vx-fg-muted">{t("app.chat.workspace.noStars")}</p>}
            {shown.map((m) => (
              <article key={m.id} aria-label={m.role === 'user' ? t("app.editor.project.you") : t("app.chat.workspace.assistant")} className={m.role === 'user' ? 'flex justify-end' : ''}>
                <div className={m.role === 'user' ? 'max-w-[85%] rounded-2xl border border-vx-border bg-vx-panel px-5 py-3' : 'w-full'}>
                  {m.role === 'user' ? (
                    <>
                      <p className="whitespace-pre-wrap wrap-break-word text-[15px]">{m.content}</p>
                      {m.attachments?.length > 0 && (
                        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={t("app.chat.workspace.attachments")}>
                          {m.attachments.map((a, i) => <li key={i} className="rounded-full border border-vx-border px-2 py-0.5 text-xs text-vx-fg-muted">{attachmentLabel(a)}</li>)}
                        </ul>
                      )}
                    </>
                  )
                    : <div aria-live={m.status === 'streaming' ? 'polite' : undefined}>{m.content ? <ChatText text={m.content} /> : <p className="text-vx-fg-muted">{m.status === 'saving' ? t("app.chat.workspace.stopping") : m.status === 'lost' ? t("app.chat.workspace.connectionChecking") : helperCopy(t, locale, researchProgressLabel(progress)) || t("app.chat.settings.thinking")}</p>}</div>}
                  {(m.status === 'saving' || m.status === 'lost') && m.content && <p role="status" className="mt-2 font-vx-mono text-xs text-vx-fg-muted">{m.status === 'saving' ? t("app.chat.workspace.savingStopped") : t("app.chat.workspace.connectionLost")}</p>}
                  {m.role === 'assistant' && !isLive(m) && <StudioDraftCards text={m.content} models={studioModels} />}
                  {m.role === 'assistant' && !isLive(m) && <Footer m={m} starred={stars.includes(m.id)} onStar={() => star(m.id)} />}
                </div>
              </article>
            ))}
            <div ref={endRef} />
          </div>}
        </div>

        <div className="border-t border-vx-border px-4 py-3">
          <div className="mx-auto max-w-[820px]">
            {composerKind === COMPOSER_KINDS.CHAT && error && (
              <div role="alert" className="mb-2 rounded-lg border border-vx-danger/40 bg-vx-danger/[0.07] px-4 py-3 text-sm text-vx-danger">
                {errorText(t, error)} {error.code === 'insufficient_balance' && <Link className="underline" href="/app/credits">{t("mobile.topUp")}</Link>}
              </div>
            )}
            {composerKind === COMPOSER_KINDS.CHAT && researchOn && (
              <p className="mb-2 text-xs text-vx-fg-muted">{t("app.chat.workspace.researchHelp")}</p>
            )}
            {composerKind === COMPOSER_KINDS.CHAT && hasImages && !imagesBlocked && (
              <p className="mb-2 text-xs text-vx-fg-muted">
                {att.items.some((i) => i.asset)
                  ? (att.items.some((i) => !i.asset)
                    ? t("app.chat.workspace.mixedImages")
                    : t("app.chat.workspace.libraryImages"))
                  : t("app.chat.workspace.uploadImages")}
                {att.items.some((i) => i.video) && (' ' + t('app.chat.workspace.videoFrames'))}
              </p>
            )}
            {composerKind === COMPOSER_KINDS.CHAT && (att.notice || imagesBlocked) && (
              <p role="status" className="mb-2 text-sm text-vx-fg-muted">
                {imagesBlocked ? (researchOn ? t("app.chat.workspace.researchImages") : t("app.chat.workspace.modelImages")) : att.notice}
              </p>
            )}
            {composerKind === COMPOSER_KINDS.CHAT && skillIds.length > 0 && !active && (
              <div className="mb-2 flex flex-wrap gap-2">
                {skillIds.map((skillId) => (
                  <button key={skillId} type="button" onClick={() => clearSkill(skillId)} disabled={busy} aria-label={t('app.chat.workspace.removeSkill', { name: tOr(t, `app.chat.skill.${skillId}.name`, skillById(skillId)?.name || '') })}
                    className="inline-flex items-center gap-2 rounded-full border border-vx-accent py-1 pe-3 ps-1 text-xs font-semibold text-vx-fg disabled:opacity-50">
                    <StudioSkillIcon skillId={skillId} size="chip" />
                    {tOr(t, `app.chat.skill.${skillId}.name`, skillById(skillId)?.name || '')} <span aria-hidden="true">×</span>
                  </button>
                ))}
              </div>
            )}
            <div className="overflow-hidden rounded-[28px] border border-vx-border bg-vx-panel shadow-[0_18px_50px_rgba(0,0,0,0.18)] focus-within:border-vx-accent">
              <ComposerTypeTabs value={composerKind} disabled={busy || mediaGeneration.sending} onChange={(next) => {
                if (next !== COMPOSER_KINDS.CHAT && mediaGeneration.jobKind && next !== mediaGeneration.jobKind) mediaGeneration.clearJobs();
                setComposerKind(next);
                setSettingsOpen(false);
              }} />
              {composerKind === COMPOSER_KINDS.CHAT ? <><ComposerControls models={models} model={model} offer={offer} opts={opts} busy={busy} onSelectModel={selectModel} onOpts={setOpts}
                onLibrary={() => setPickingLibrary(true)} libraryDisabled={att.items.length >= limits.maxAttachments} />
              {hasImages && (
                <div className="border-t border-vx-border px-3 pt-3">
                  <AttachChips items={att.items} onRemove={att.remove} disabled={busy} />
                </div>
              )}
              <div className="flex items-end gap-2 px-2 pb-2">
                {offer.images && <AttachButton onPick={att.add} disabled={busy} full={att.items.length >= limits.maxAttachments} />}
                <label className="sr-only" htmlFor="chat-msg">{t("app.chat.message")}</label>
                <textarea id="chat-msg" rows={1} value={text} maxLength={MAX_TEXT} placeholder={skillIds.length ? tOr(t, `app.chat.skill.${skillIds[0]}.starter`, skillById(skillIds[0])?.starter || t('app.chat.ask')) : t('app.chat.ask')} onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                  className="max-h-48 min-h-14 min-w-0 flex-1 resize-none bg-transparent px-2 py-3 text-[15px] text-vx-fg outline-hidden placeholder:text-vx-fg-faint" />
                {busy
                  ? <button type="button" onClick={stop} disabled={stopping || checking} className="mb-1 rounded-full border border-vx-border px-5 py-2.5 text-sm font-semibold disabled:opacity-50">{stopping ? t("app.chat.workspace.stopping") : checking ? t("app.chat.workspace.checking") : t("app.chat.workspace.stop")}</button>
                  : <button type="button" onClick={send} disabled={!text.trim() || imagesBlocked} className="mb-1 min-w-28 rounded-full bg-vx-accent px-5 py-2.5 text-sm font-semibold text-vx-accent-ink transition-colors hover:bg-vx-accent-hover disabled:opacity-50">{isFree ? t("app.chat.workspace.sendFree") : t('app.chat.workspace.send', { price: credits(t, locale, price) })}</button>}
              </div>
              </> : <MediaComposer kind={composerKind} media={mediaGeneration} prompt={mediaPrompt} onPrompt={setMediaPrompt} />}
            </div>
            {composerKind === COMPOSER_KINDS.CHAT && <p className="mt-1.5 px-1 text-xs text-vx-fg-muted">
              <span className="font-vx-mono text-vx-money vx-num">{isFree ? t("publish.plan.colFree") : credits(t, locale, price)}</span>{' '}{t("app.chat.settings.perReply")}{chosen.thinking || chosen.web ? t('app.chat.workspace.with', { options: chosen.thinking && chosen.web ? t('app.chat.workspace.bothOptions') : t(chosen.thinking ? 'app.chat.settings.thinking' : 'app.chat.settings.web') }) : ''}{t('app.chat.workspace.replyPolicy', { count: number(wordsFor(model.max_reply_tokens)) })}
            </p>}
          </div>
        </div>
      </section>
      {composerKind === COMPOSER_KINDS.CHAT && <aside className="hidden w-[320px] shrink-0 border-s border-vx-border bg-vx-base xl:block">{settings}</aside>}
      {composerKind === COMPOSER_KINDS.CHAT && pickingLibrary && <LibraryPicker onPick={pickFromLibrary} onClose={() => setPickingLibrary(false)} />}
      {settingsOpen && (
        <div className="fixed inset-0 z-40 flex justify-end xl:hidden" role="dialog" aria-modal="true" aria-label={t("label.Chat settings")}>
          <button type="button" aria-label={t("app.chat.closeSettings")} className="flex-1 bg-black/50" onClick={() => setSettingsOpen(false)} />
          <div className="relative w-[340px] max-w-[90vw] bg-vx-base">
            <button type="button" aria-label={t("app.chat.closeSettings")} className="absolute end-3 top-3 z-10 rounded-full border border-vx-border px-3 py-1 text-sm" onClick={() => setSettingsOpen(false)}>{t("authGate.close")}</button>
            <div className="h-full pt-10">{settings}</div>
          </div>
        </div>
      )}
      {managingPersonas && <PersonaManager personas={personas} models={models} onChange={changePersonas} onClose={() => setManagingPersonas(false)} />}
    </div>
  );
}
