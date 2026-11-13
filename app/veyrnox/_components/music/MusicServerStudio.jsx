'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getStoredUserId } from '../../../lib/authClient';
import { addToDraft, NEW_CHAT, readDraft } from '../../_lib/chatLocal';
import { Modal } from '../Modal';
import { useMusicServerState } from './useMusicServerState';
import { useMusicCustomDraft } from './useMusicCustomDraft';
import { MusicSourceUploadPanel } from './MusicSourceUploadPanel';
import { MusicSampleSeedCard } from './MusicSampleSeedCard';
import { MusicLyricistProfiles } from './MusicLyricistProfiles';
import { buildMusicSamplePrompt, MUSIC_SAMPLE_DIRECTION_MAX } from '../../../../lib/musicDiscover.js';
import { MUSIC_PUBLIC_DRAFT_KEY } from './MusicPublicPrompt';
import { clearMusicLyricHandoff, readMusicLyricHandoff, replaceMusicLyricSelection, writeMusicLyricHandoff } from './musicLyricHandoff';
import {
  augmentMusicStyle, buildMusicLyricAssistantPrompt, buildMusicLyricSelectionPrompt, insertMusicStructureLabel, musicWritingReferences,
  MUSIC_LYRIC_ASSISTANT_REQUEST_MAX, MUSIC_STRUCTURE_LABELS, nextMusicPrompt,
} from './musicWriting';

const LABELS = { queued: 'Queued', running: 'Generating', ready: 'Ready', failed: 'Failed', refunded: 'Refunded' };
const MUSIC_GUIDE_KEY = 'veyrnox.music.create-guide.v1';

function MusicFirstRunGuide() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(localStorage.getItem(MUSIC_GUIDE_KEY) !== 'done');
    } catch {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    try { localStorage.setItem(MUSIC_GUIDE_KEY, 'done'); } catch {}
    setVisible(false);
  }

  if (!visible) return null;
  return (
    <section aria-label="Create guide" className="mb-6 rounded-2xl border border-vx-border bg-vx-panel p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Your first private draft</p><h2 className="mt-1 font-vx text-2xl font-black">Three deliberate steps, no surprise spend.</h2></div>
        <button type="button" onClick={dismiss} className="min-h-10 rounded-full border border-vx-border px-4 text-sm font-bold">Got it</button>
      </div>
      <ol className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
        <li className="rounded-2xl bg-vx-base p-4"><strong>1. Shape</strong><span className="mt-1 block text-vx-fg-muted">Use Simple for sound direction or Custom for a private writing draft.</span></li>
        <li className="rounded-2xl bg-vx-base p-4"><strong>2. Review</strong><span className="mt-1 block text-vx-fg-muted">A server quote shows the exact two-version cost before credits move.</span></li>
        <li className="rounded-2xl bg-vx-base p-4"><strong>3. Compare</strong><span className="mt-1 block text-vx-fg-muted">Each private candidate progresses and settles independently.</span></li>
      </ol>
    </section>
  );
}

function LyricsFocusEditor({ value, onChange, maxLength, onSelectionAssistant, assistantBusy }) {
  const [open, setOpen] = useState(false);
  const [references, setReferences] = useState(null);
  const [selectionRequest, setSelectionRequest] = useState('');
  const [selectionError, setSelectionError] = useState('');
  const openButton = useRef(null);
  const editor = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    editor.current?.focus();
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        window.setTimeout(() => openButton.current?.focus(), 0);
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  function close() {
    setOpen(false);
    window.setTimeout(() => openButton.current?.focus(), 0);
  }

  function insert(label) {
    onChange(insertMusicStructureLabel(value, label, maxLength));
    window.setTimeout(() => editor.current?.focus(), 0);
  }

  function findReferences() {
    const node = editor.current;
    if (!node) return;
    setReferences(musicWritingReferences(value, node.selectionStart, node.selectionEnd));
  }

  function editSelection() {
    const node = editor.current;
    if (!node || node.selectionEnd <= node.selectionStart || !value.slice(node.selectionStart, node.selectionEnd).trim()) {
      setSelectionError('Select one or more lyric lines first.');
      return;
    }
    if (!selectionRequest.trim()) return;
    setSelectionError('');
    onSelectionAssistant({ start: node.selectionStart, end: node.selectionEnd, request: selectionRequest });
  }

  return (
    <>
      <button ref={openButton} type="button" onClick={() => setOpen(true)} className="min-h-10 rounded-full border border-vx-border px-4 text-sm font-bold">Focus lyrics</button>
      {open ? (
        <Modal onCancel={close} instant className="overflow-y-auto bg-vx-base p-4 text-vx-fg sm:p-8" aria-labelledby="lyrics-editor-title">
          <div className="mx-auto flex min-h-full max-w-5xl flex-col">
            <header className="flex flex-wrap items-start justify-between gap-4 border-b border-vx-border pb-5">
              <div><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Private writing workspace</p><h2 id="lyrics-editor-title" className="mt-1 font-vx text-3xl font-black">Focus lyrics</h2><p className="mt-2 text-sm text-vx-fg-muted">Edits use the same revision-safe private autosave as Custom.</p></div>
              <button type="button" onClick={close} className="min-h-11 rounded-full border border-vx-border px-5 font-bold">Done</button>
            </header>
            <div className="mt-5 flex flex-wrap gap-2" aria-label="Song structure labels">
              {MUSIC_STRUCTURE_LABELS.map((label) => <button key={label} type="button" onClick={() => insert(label)} className="min-h-10 rounded-full border border-vx-border px-4 text-sm font-bold hover:border-vx-border-boost">{label}</button>)}
            </div>
            <div className="mt-3">
              <button type="button" onClick={findReferences} className="min-h-10 rounded-full border border-vx-border px-4 text-sm font-bold hover:border-vx-border-boost">Find rhyme &amp; line references</button>
            </div>
            {references ? (
              <aside aria-label="Writing references" className="mt-4 rounded-2xl border border-vx-border bg-vx-panel p-4 text-sm">
                {references.anchor ? (
                  <>
                    <p><strong>Reference word:</strong> {references.anchor}</p>
                    <p className="mt-2 text-vx-fg-muted"><strong className="text-vx-fg">Rhymes:</strong> {references.rhymes.length ? references.rhymes.join(' · ') : 'No curated rhyme family yet—use the prompts below.'}</p>
                    <ul className="mt-3 space-y-2 text-vx-fg-muted">{references.lineStarters.map((line) => <li key={line}>{line}</li>)}</ul>
                  </>
                ) : <p role="status" className="text-vx-fg-muted">Select a word or place the cursor after one, then try again.</p>}
              </aside>
            ) : null}
            <section aria-label="Edit selected lyrics" className="mt-4 rounded-2xl border border-vx-border bg-vx-panel p-4">
              <h3 className="font-bold">Edit only the selected lines</h3>
              <p className="mt-1 text-sm text-vx-fg-muted">Select text below, describe the change, then review a replacement in Music. Surrounding lyrics cannot change.</p>
              <label className="mt-3 block text-sm font-bold">Change request<textarea value={selectionRequest} onChange={(event) => setSelectionRequest(event.target.value)} maxLength={MUSIC_LYRIC_ASSISTANT_REQUEST_MAX} rows={2} className="mt-1 w-full rounded-xl border border-vx-border bg-vx-base px-3 py-2 font-normal" /></label>
              {selectionError ? <p role="alert" className="mt-2 text-sm text-vx-danger">{selectionError}</p> : null}
              <button type="button" onClick={editSelection} disabled={!selectionRequest.trim() || assistantBusy} className="mt-3 min-h-10 rounded-full border border-vx-accent px-4 text-sm font-bold disabled:opacity-40">{assistantBusy ? 'Preparing Chat draft…' : 'Edit selected lines in Chat'}</button>
            </section>
            <label className="mt-5 flex min-h-[55dvh] flex-1 flex-col">
              <span className="flex items-center justify-between gap-4 text-sm font-bold"><span>Original lyrics or structure</span><span className="font-vx-mono text-xs text-vx-fg-faint">{value.length}/{maxLength}</span></span>
              <textarea ref={editor} value={value} onChange={(event) => onChange(event.target.value)} maxLength={maxLength} placeholder={'[Verse]\nShape your own words here'} className="mt-2 min-h-[55dvh] w-full flex-1 resize-none rounded-2xl border border-vx-border-boost bg-vx-panel px-5 py-4 font-vx-mono text-base leading-8 text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-none" />
            </label>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function ServerCandidate({ candidate, title }) {
  const label = candidate.label || (candidate.ordinal === 2 ? 'B' : 'A');
  const state = candidate.state || 'queued';
  return (
    <article data-testid={`music-candidate-${label.toLowerCase()}`} data-status={state} className="rounded-2xl border border-vx-border bg-vx-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Version {label}</p>
          <h3 className="mt-1 font-vx text-xl font-black">{title || `Private draft ${label}`}</h3>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${state === 'ready' ? 'border-vx-success/50 text-vx-success' : state === 'refunded' || state === 'failed' ? 'border-vx-danger/50 text-vx-danger' : 'border-vx-border text-vx-fg-muted'}`}>
          {LABELS[state] || state}
        </span>
      </div>
      {state === 'running' || state === 'queued' ? (
        <div className="mt-5" aria-label={`Version ${label} is ${LABELS[state].toLowerCase()}`} aria-busy="true">
          <div className="vx-shimmer h-2 rounded-full bg-vx-base" />
          <p className="mt-3 text-sm text-vx-fg-muted">This candidate completes independently from the other version.</p>
        </div>
      ) : null}
      {state === 'ready' && candidate.audio_url ? (
        <audio className="mt-5 w-full" controls preload="none" src={candidate.audio_url} aria-label={`Play version ${label}`} />
      ) : null}
      {state === 'refunded' ? <p className="mt-4 text-sm text-vx-fg-body">This version did not complete and its candidate charge was returned.</p> : null}
      {state === 'failed' ? <p className="mt-4 text-sm text-vx-fg-body">This version did not complete. Check your balance before retrying.</p> : null}
    </article>
  );
}

function CustomDraftFields({ custom, entitlements, quote, busy, clearQuote, reviewQuote, confirmQuote, hasSharedSlot }) {
  const [assistantRequest, setAssistantRequest] = useState('');
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantError, setAssistantError] = useState('');
  const [lyricHandoff, setLyricHandoff] = useState(null);
  const [lyricistProfileId, setLyricistProfileId] = useState('');
  const [instrumental, setInstrumental] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(60);
  const [generationError, setGenerationError] = useState('');
  const limits = entitlements?.custom_drafts || { lyrics_max: 3000, styles_max: 500, title_max: 80 };
  const selectedModel = entitlements?.models?.find((item) => item.id === custom.draft.model_id) || entitlements?.models?.[0];
  const controls = selectedModel?.controls || {};
  const customSupported = selectedModel?.generation_modes?.includes('custom') && selectedModel?.available !== false;
  const canQuoteCustom = Boolean(customSupported && custom.draft.styles.trim()
    && (instrumental || (custom.draft.lyrics.trim() && rightsConfirmed))
    && hasSharedSlot && !busy && !custom.conflict && custom.status !== 'saving');

  useEffect(() => {
    clearQuote();
  }, [clearQuote, custom.draft.lyrics, custom.draft.styles, custom.draft.title, custom.draft.model_id]);

  useEffect(() => {
    if (!custom.loaded) return;
    const userId = getStoredUserId();
    let storage = null;
    try { storage = window.sessionStorage; } catch {}
    const context = readMusicLyricHandoff(storage, userId);
    setLyricHandoff(context?.proposal ? context : null);
  }, [custom.loaded]);
  if (!custom.loaded && (custom.status === 'loading' || custom.status === 'idle')) {
    return <div aria-busy="true" className="space-y-3"><div className="vx-shimmer h-48 rounded-2xl bg-vx-base"/><div className="vx-shimmer h-12 rounded-xl bg-vx-base"/><div className="vx-shimmer h-12 rounded-xl bg-vx-base"/></div>;
  }
  if (custom.loadFailed) {
    return (
      <section role="alert" className="rounded-2xl border border-vx-danger/50 bg-vx-danger/10 p-5 text-sm text-vx-fg-body">
        <p className="font-bold text-vx-danger">Draft unavailable</p>
        <p className="mt-2">{custom.error}</p>
        <button type="button" onClick={custom.retry} className="mt-4 min-h-10 rounded-full border border-vx-danger px-4 font-bold text-vx-danger">Retry draft load</button>
      </section>
    );
  }

  async function launchLyricAssistant({ request, prompt, selection = null }) {
    if (!prompt) return;
    setAssistantBusy(true);
    setAssistantError('');
    let sourceDraft = custom.draft;
    if (custom.dirty) {
      sourceDraft = await custom.saveNow();
      if (!sourceDraft) {
        setAssistantBusy(false);
        setAssistantError('Save the private draft before opening Chat. Your text remains here.');
        return;
      }
    }
    const userId = getStoredUserId();
    let storage = null; let handoffStorage = null;
    try { storage = window.localStorage; handoffStorage = window.sessionStorage; } catch {}
    if (!userId || !storage || !handoffStorage) {
      setAssistantBusy(false);
      setAssistantError('Sign in again before opening the lyric assistant. Nothing was sent.');
      return;
    }
    if (!writeMusicLyricHandoff(handoffStorage, {
      userId,
      sourceRevision: sourceDraft.revision,
      sourceLyrics: sourceDraft.lyrics,
      request,
      profileId: lyricistProfileId,
      selection,
    })) {
      setAssistantBusy(false);
      setAssistantError('This browser could not prepare a private return path. Nothing was sent.');
      return;
    }
    addToDraft(storage, userId, NEW_CHAT, prompt);
    if (!readDraft(storage, userId, NEW_CHAT).includes(prompt)) {
      clearMusicLyricHandoff(handoffStorage);
      setAssistantBusy(false);
      setAssistantError('This browser could not prepare the Chat draft. Nothing was sent.');
      return;
    }
    window.location.assign('/app/chat?from=music');
  }

  function openLyricAssistant() {
    return launchLyricAssistant({
      request: assistantRequest,
      prompt: buildMusicLyricAssistantPrompt({ lyrics: custom.draft.lyrics, request: assistantRequest }),
    });
  }

  function openSelectionAssistant(selection) {
    return launchLyricAssistant({
      request: selection.request,
      prompt: buildMusicLyricSelectionPrompt({ lyrics: custom.draft.lyrics, selectionStart: selection.start, selectionEnd: selection.end, request: selection.request }),
      selection,
    });
  }

  function discardLyricProposal() {
    let storage = null;
    try { storage = window.sessionStorage; } catch {}
    clearMusicLyricHandoff(storage);
    setLyricHandoff(null);
  }

  function applyLyricProposal() {
    if (!lyricHandoff?.proposal) return;
    const next = lyricHandoff.mode === 'selection'
      ? replaceMusicLyricSelection(custom.draft.lyrics, lyricHandoff.selection_start, lyricHandoff.selection_end, lyricHandoff.proposal, limits.lyrics_max)
      : lyricHandoff.proposal;
    if (!next || (lyricHandoff.mode === 'selection' && custom.draft.lyrics !== lyricHandoff.source_lyrics)) return;
    custom.update('lyrics', next);
    discardLyricProposal();
  }

  async function reviewCustomQuote() {
    if (!canQuoteCustom) return;
    setGenerationError('');
    const saved = await custom.saveNow();
    if (!saved) {
      setGenerationError('Save the current private draft before reviewing its generation quote.');
      return;
    }
    await reviewQuote({
      mode: 'custom', draft_revision: saved.revision,
      instrumental, rights_confirmed: instrumental ? false : true,
      duration_seconds: durationSeconds,
    });
  }

  return (
    <>
      <LyricsFocusEditor value={custom.draft.lyrics} onChange={(value) => custom.update('lyrics', value)} maxLength={limits.lyrics_max} onSelectionAssistant={openSelectionAssistant} assistantBusy={assistantBusy} />
      <label className="block">
        <span className="flex items-center justify-between text-sm font-bold text-vx-fg-body"><span>Original lyrics or structure</span><span className="font-vx-mono text-xs text-vx-fg-faint">{custom.draft.lyrics.length}/{limits.lyrics_max}</span></span>
        <textarea value={custom.draft.lyrics} onChange={(event) => custom.update('lyrics', event.target.value)} maxLength={limits.lyrics_max} rows={10} placeholder={'[Verse]\nShape your own words here'} className="mt-2 w-full resize-y rounded-2xl border border-vx-border-boost bg-vx-base px-4 py-3 font-vx-mono text-sm leading-6 text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-none" />
      </label>
      <MusicLyricistProfiles selectedId={lyricistProfileId} onSelect={setLyricistProfileId} />
      <section aria-label="Lyric assistant" className="rounded-2xl border border-vx-border bg-vx-base p-4">
        <div className="flex items-start justify-between gap-3">
          <div><h3 className="font-bold text-vx-fg">Co-write in Chat</h3><p className="mt-1 text-xs leading-5 text-vx-fg-muted">Your current revision is saved first. Chat opens with an unsent request; choose a model, review its exact per-reply price, then decide whether to send.</p></div>
          <span className="shrink-0 rounded-full border border-vx-border px-2 py-1 font-vx-mono text-[10px] uppercase text-vx-fg-muted">No auto-send</span>
        </div>
        <label className="mt-4 block text-sm font-bold text-vx-fg-body">
          What should Chat help with?
          <textarea value={assistantRequest} onChange={(event) => setAssistantRequest(event.target.value)} maxLength={MUSIC_LYRIC_ASSISTANT_REQUEST_MAX} rows={3} placeholder="Tighten the chorus, keep the harbour image, and make the final line more hopeful" className="mt-2 w-full resize-y rounded-xl border border-vx-border-boost bg-vx-panel px-3 py-2 font-normal text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-none" />
          <span className="mt-1 block text-right font-vx-mono text-xs font-normal text-vx-fg-faint">{assistantRequest.length}/{MUSIC_LYRIC_ASSISTANT_REQUEST_MAX}</span>
        </label>
        {assistantError ? <p role="alert" className="mt-3 text-sm text-vx-danger">{assistantError}</p> : null}
        <button type="button" onClick={openLyricAssistant} disabled={!assistantRequest.trim() || assistantBusy || custom.status === 'saving' || custom.status === 'error' || Boolean(custom.conflict)} className="mt-3 min-h-11 w-full rounded-full border border-vx-accent px-4 text-sm font-bold text-vx-fg disabled:cursor-not-allowed disabled:opacity-40">{assistantBusy ? 'Preparing private Chat draft…' : 'Open lyric assistant in Chat'}</button>
      </section>
      {lyricHandoff?.proposal ? (
        <section aria-label="Review assistant lyrics" className="rounded-2xl border border-vx-accent bg-vx-accent/[0.06] p-4">
          <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Returned from Chat</p>
          <h3 className="mt-1 font-vx text-xl font-black">{lyricHandoff.mode === 'selection' ? 'Review the selected-line replacement.' : 'Review before replacing your draft.'}</h3>
          {custom.draft.lyrics !== lyricHandoff.source_lyrics ? <p role="status" className="mt-2 text-sm text-vx-danger">Your Music draft changed after this Chat request. {lyricHandoff.mode === 'selection' ? 'The captured range may have moved, so this replacement cannot apply.' : 'Compare carefully; Apply uses the current revision-safe save path.'}</p> : <p className="mt-2 text-sm text-vx-fg-muted">Nothing has changed yet. Applying creates a normal unsaved Music revision for review and autosave.</p>}
          <label className="mt-4 block text-sm font-bold text-vx-fg-body">{lyricHandoff.mode === 'selection' ? 'Replacement lines' : 'Assistant proposal'}
            <textarea readOnly value={lyricHandoff.proposal} rows={10} className="mt-2 w-full resize-y rounded-xl border border-vx-border bg-vx-panel px-3 py-2 font-vx-mono text-sm leading-6 text-vx-fg" />
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={applyLyricProposal} disabled={lyricHandoff.mode === 'selection' && custom.draft.lyrics !== lyricHandoff.source_lyrics} className="min-h-10 rounded-full bg-vx-accent px-4 text-sm font-bold text-vx-accent-ink disabled:opacity-40">{lyricHandoff.mode === 'selection' ? 'Apply selected-line replacement' : 'Apply assistant draft'}</button>
            <button type="button" onClick={discardLyricProposal} className="min-h-10 rounded-full border border-vx-border px-4 text-sm font-bold">Discard</button>
          </div>
        </section>
      ) : null}
      <label className="block text-sm font-bold text-vx-fg-body">
        Style direction
        <textarea value={custom.draft.styles} onChange={(event) => custom.update('styles', event.target.value)} maxLength={limits.styles_max} rows={3} placeholder="Warm piano, restrained percussion, 84 bpm" className="mt-2 w-full resize-y rounded-xl border border-vx-border-boost bg-vx-base px-4 py-3 text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-none" />
        <span className="mt-1 block text-right font-vx-mono text-xs font-normal text-vx-fg-faint">{custom.draft.styles.length}/{limits.styles_max}</span>
      </label>
      <button type="button" onClick={() => custom.update('styles', augmentMusicStyle(custom.draft.styles, limits.styles_max))} className="min-h-10 rounded-full border border-vx-border px-4 text-sm font-bold hover:border-vx-border-boost">Expand style direction</button>
      <label className="block text-sm font-bold text-vx-fg-body">
        Working title <span className="font-normal text-vx-fg-muted">(optional)</span>
        <input value={custom.draft.title} onChange={(event) => custom.update('title', event.target.value)} maxLength={limits.title_max} placeholder="Harbour Frame" className="mt-2 min-h-12 w-full rounded-xl border border-vx-border-boost bg-vx-base px-4 text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-none" />
      </label>
      <label className="block text-sm font-bold text-vx-fg-body">
        Draft target
        <select value={selectedModel?.id || custom.draft.model_id} onChange={(event) => custom.update('model_id', event.target.value)} disabled={!entitlements?.models?.length} className="mt-2 min-h-12 w-full rounded-xl border border-vx-border-boost bg-vx-base px-4 text-vx-fg focus:border-vx-accent focus:outline-none">
          {(entitlements?.models || []).map((item) => <option key={item.id} value={item.id} disabled={!item.generation_modes?.includes('custom') || item.available === false}>{item.name}{item.generation_modes?.includes('custom') ? item.available === false ? ' · paid plan required' : ' · Custom ready' : ' · draft only'}</option>)}
          {!entitlements?.models?.length ? <option>No verified model available</option> : null}
        </select>
      </label>

      <section aria-label="Selected model capabilities" className="rounded-2xl border border-vx-border bg-vx-base p-4 text-sm">
        <div className="flex items-center justify-between gap-3"><strong>{selectedModel?.name || 'No model selected'}</strong><span className="font-vx-mono text-xs text-vx-fg-muted">Catalog verified</span></div>
        <ul className="mt-3 space-y-2 text-vx-fg-muted">
          <li>Prompt direction: {controls.description ? 'supported' : 'unavailable'}</li>
          <li>Instrumental generation: {controls.instrumental === 'required' ? 'required' : 'capability dependent'}</li>
          <li>Lyrics and style generation: {controls.lyrics && controls.styles ? 'supported' : 'draft only'}</li>
        </ul>
      </section>

      {custom.conflict ? (
        <section role="alert" className="rounded-2xl border border-vx-danger/50 bg-vx-danger/10 p-4 text-sm text-vx-fg-body">
          <p className="font-bold text-vx-danger">A newer server draft exists.</p>
          <p className="mt-2">The same field changed in both tabs. Both versions remain available below until you choose.</p>
          <div className="mt-4 space-y-4">
            {custom.conflict.overlap.map((field) => {
              const label = field === 'model_id' ? 'draft target' : field;
              return (
                <div key={field} className="rounded-xl border border-vx-border bg-vx-base p-3">
                  <p className="font-bold capitalize">Conflict in {label}</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-bold text-vx-fg-muted">Your {label}
                      <textarea aria-label={`Your ${label}`} readOnly value={custom.conflict.local[field]} rows={field === 'lyrics' ? 4 : 2} className="mt-1 w-full resize-y rounded-lg border border-vx-border bg-vx-panel p-2 font-vx-mono text-xs text-vx-fg" />
                    </label>
                    <label className="text-xs font-bold text-vx-fg-muted">Server {label}
                      <textarea aria-label={`Server ${label}`} readOnly value={custom.conflict.server[field]} rows={field === 'lyrics' ? 4 : 2} className="mt-1 w-full resize-y rounded-lg border border-vx-border bg-vx-panel p-2 font-vx-mono text-xs text-vx-fg" />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={custom.loadNewer} className="min-h-10 rounded-full border border-vx-border px-4 font-bold">Use server version</button>
            <button type="button" onClick={custom.keepMine} className="min-h-10 rounded-full bg-vx-accent px-4 font-bold text-vx-accent-ink">Keep my version</button>
          </div>
        </section>
      ) : null}

      <div className="rounded-2xl border border-dashed border-vx-border-boost bg-vx-base p-4">
        <div aria-live="polite" className="text-sm text-vx-fg-body">
          {custom.status === 'saving' ? 'Saving private draft…' : null}
          {custom.status === 'unsaved' ? 'Unsaved changes — autosave is waiting.' : null}
          {custom.status === 'saved' ? `Saved privately · revision ${custom.draft.revision}` : null}
          {custom.status === 'error' ? custom.error : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={custom.saveNow} disabled={!custom.dirty || custom.status === 'saving' || Boolean(custom.conflict)} className="min-h-10 rounded-full border border-vx-border px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40">Save now</button>
          {custom.status === 'error' ? <button type="button" onClick={custom.retry} className="min-h-10 rounded-full border border-vx-danger px-4 text-sm font-bold text-vx-danger">Retry save</button> : null}
        </div>
      </div>

      {customSupported ? (
        <section aria-label="Custom generation" className="space-y-4 rounded-2xl border border-vx-border bg-vx-base p-4">
          <label className="flex min-h-12 items-start justify-between gap-4 rounded-xl border border-vx-border px-3 py-3 text-sm text-vx-fg-body">
            <span><strong className="block">Instrumental</strong><span className="mt-1 block text-vx-fg-muted">Use the saved style direction without sending draft lyrics.</span></span>
            <input aria-label="Create an instrumental" type="checkbox" checked={instrumental} onChange={(event) => { setInstrumental(event.target.checked); setRightsConfirmed(false); clearQuote(); }} className="mt-1 h-5 w-5 shrink-0 accent-vx-accent" />
          </label>
          <label className="block text-sm font-bold text-vx-fg-body">
            <span className="flex items-center justify-between gap-3"><span>Song duration</span><output htmlFor="custom-music-duration" className="font-vx-mono text-xs text-vx-accent">{durationSeconds} seconds</output></span>
            <input id="custom-music-duration" aria-label="Custom song duration" type="range" min="10" max="60" step="5" value={durationSeconds} onChange={(event) => { setDurationSeconds(Number(event.target.value)); clearQuote(); }} className="mt-3 w-full accent-vx-accent" />
          </label>
          {!instrumental ? (
            <label className="flex items-start gap-3 text-sm text-vx-fg-body">
              <input type="checkbox" checked={rightsConfirmed} onChange={(event) => { setRightsConfirmed(event.target.checked); clearQuote(); }} className="mt-1 h-5 w-5 shrink-0 accent-vx-accent" />
              <span><strong>I wrote these lyrics or have permission to use them.</strong><span className="mt-1 block text-vx-fg-muted">This attestation is frozen with the exact saved draft revision used for generation.</span></span>
            </label>
          ) : <p className="text-sm text-vx-fg-muted">ACE-Step receives <span className="font-vx-mono">[Instrumental]</span>; the saved lyrics stay in your private draft and are not sent with this pair.</p>}
          {generationError ? <p role="alert" className="text-sm text-vx-danger">{generationError}</p> : null}
          {quote?.mode === 'custom' ? (
            <div className="rounded-xl border border-vx-border-boost p-3 text-sm"><span>2 versions × {quote.credits_per_candidate} credits</span><strong className="float-right font-vx-mono text-vx-money">{quote.total_credits} credits</strong></div>
          ) : null}
          {quote?.mode === 'custom' ? (
            <button type="button" onClick={() => confirmQuote({ title: custom.draft.title.trim() })} disabled={!quote.affordable || Boolean(busy) || !hasSharedSlot} className="min-h-12 w-full rounded-full bg-vx-accent px-5 font-extrabold text-vx-accent-ink disabled:opacity-40">{busy === 'confirming' ? 'Confirming one pair…' : `Create two ${instrumental ? 'instrumental' : 'lyric'} versions · ${quote.total_credits} cr`}</button>
          ) : (
            <button type="button" onClick={reviewCustomQuote} disabled={!canQuoteCustom} className="min-h-12 w-full rounded-full bg-vx-accent px-5 font-extrabold text-vx-accent-ink disabled:opacity-40">{busy === 'quoting' ? 'Reviewing live price…' : 'Review Custom quote'}</button>
          )}
          <p className="text-center text-xs text-vx-fg-faint">The saved revision and selected vocal mode are frozen into the quote. Credits move only after confirmation.</p>
        </section>
      ) : (
        <>
          <button type="button" disabled className="min-h-12 w-full rounded-full bg-vx-accent px-5 font-extrabold text-vx-accent-ink opacity-40">Custom generation unavailable for this model</button>
          <p className="text-center text-xs text-vx-fg-faint">Drafting is active. Choose a current Custom-ready paid model before any quote, credit spend, or provider request can start.</p>
        </>
      )}
    </>
  );
}

export function MusicServerStudio({ sourcesEnabled = false, sampleSeed = null, sampleMix = null }) {
  const { entitlements, quote, generations, busy, error, clearQuote, reviewQuote, confirmQuote, reload } = useMusicServerState();
  const [mode, setMode] = useState('simple');
  const [description, setDescription] = useState('');
  const [activeSeed, setActiveSeed] = useState(sampleSeed);
  const [activeMix, setActiveMix] = useState(sampleMix);
  const [title, setTitle] = useState('');
  const [modelId, setModelId] = useState('ace-step');
  const [variety, setVariety] = useState(50);
  const [styleInfluence, setStyleInfluence] = useState(0);
  const [excludeStyles, setExcludeStyles] = useState('');
  const [durationSeconds, setDurationSeconds] = useState(60);
  const [instrumental, setInstrumental] = useState(true);
  const [sourceId, setSourceId] = useState(null);
  const model = useMemo(() => entitlements?.models?.find((item) => item.id === modelId) || entitlements?.models?.[0], [entitlements, modelId]);
  const custom = useMusicCustomDraft({ active: mode === 'custom', defaultModelId: model?.id || modelId });
  const customSelectedModel = entitlements?.models?.find((item) => item.id === custom.draft.model_id);
  const customReady = Boolean(customSelectedModel?.generation_modes?.includes('custom') && customSelectedModel?.available !== false);
  const prompt = activeSeed ? buildMusicSamplePrompt(activeSeed, description, activeMix) : description.trim();
  const concurrencyLimit = Number(entitlements?.concurrency_limit) || 4;
  const activeGenerationCount = generations.filter((item) => !['succeeded', 'partial', 'failed', 'refunded'].includes(item.state)).length;
  const hasSharedSlot = activeGenerationCount < concurrencyLimit;
  const canQuote = Boolean(prompt && instrumental && model?.available !== false && entitlements?.available && !busy && !sourceId && hasSharedSlot);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('mode') === 'custom') setMode('custom');
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(sessionStorage.getItem(MUSIC_PUBLIC_DRAFT_KEY) || 'null');
        if (typeof saved?.prompt === 'string' && saved.prompt.trim() && saved.prompt.length <= 500) {
          setDescription(saved.prompt.trim());
        }
        sessionStorage.removeItem(MUSIC_PUBLIC_DRAFT_KEY);
      } catch {
        sessionStorage.removeItem(MUSIC_PUBLIC_DRAFT_KEY);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function change(setter) {
    return (event) => {
      setter(event.target.type === 'checkbox' ? event.target.checked : event.target.value);
      clearQuote();
    };
  }

  async function review(event) {
    event.preventDefault();
    if (mode !== 'simple') return;
    await reviewQuote({
      mode: 'simple', prompt, title: title.trim(), instrumental: true, model_id: model.id,
      duration_seconds: durationSeconds,
      ...(model.controls?.variety ? { variety } : {}),
      ...(model.controls?.style_influence ? { style_influence: styleInfluence } : {}),
      ...(model.controls?.exclude_styles ? { exclude_styles: excludeStyles } : {}),
    });
  }

  function selectMode(nextMode) {
    setMode(nextMode);
    clearQuote();
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">{mode === 'simple' ? 'Prompt to pair' : 'Private writing draft'}</p>
          <h1 className="mt-2 font-vx text-4xl font-black tracking-tight sm:text-5xl">{mode === 'simple' ? 'Create a private sound draft.' : 'Shape lyrics without losing the thread.'}</h1>
          <p className="mt-3 max-w-2xl text-vx-fg-body">{mode === 'simple' ? 'Review an exact live-catalog quote, then confirm two independently tracked instrumental versions.' : customReady ? 'Lyrics, style and title autosave privately. Save one exact revision, attest your rights, review its quote, then confirm two versions.' : 'Lyrics, style and title autosave privately with revision conflicts. Generation stays off until a compatible model is selected.'}</p>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-vx-border bg-vx-panel px-4 py-3">
          <div><span className="block text-sm text-vx-fg-muted">Spendable balance</span><span className="block text-xs text-vx-fg-faint">Shared pairs {activeGenerationCount}/{concurrencyLimit}</span></div>
          <strong data-testid="music-credits" className="font-vx-mono text-lg text-vx-money">{entitlements ? entitlements.balance : '—'} cr</strong>
        </div>
      </div>

      {error ? <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-vx-danger/50 bg-vx-danger/10 px-4 py-3 text-sm text-vx-danger"><span>{error}</span><button type="button" onClick={reload} className="min-h-9 rounded-full border border-current px-3 font-bold">Retry</button></div> : null}

      <MusicFirstRunGuide />

      <div className="grid gap-8 lg:grid-cols-5">
        <form onSubmit={review} className="self-start rounded-2xl border border-vx-border bg-vx-panel p-5 shadow-2xl lg:sticky lg:top-24 lg:col-span-2 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-vx text-2xl font-black">{mode === 'simple' ? 'Direction' : 'Custom draft'}</h2>
            <div role="tablist" aria-label="Music creation mode" className="flex rounded-full border border-vx-border bg-vx-base p-1 text-sm font-bold">
              <button type="button" role="tab" aria-selected={mode === 'simple'} onClick={() => selectMode('simple')} className={`rounded-full px-4 py-2 capitalize ${mode === 'simple' ? 'bg-vx-fg text-vx-base' : 'text-vx-fg-muted hover:text-vx-fg'}`}>Simple</button>
              <button type="button" role="tab" aria-selected={mode === 'custom'} onClick={() => selectMode('custom')} className={`rounded-full px-4 py-2 capitalize ${mode === 'custom' ? 'bg-vx-fg text-vx-base' : 'text-vx-fg-muted hover:text-vx-fg'}`}>Custom</button>
            </div>
          </div>

          <div className="mt-6 space-y-5">
            <MusicSourceUploadPanel enabled={sourcesEnabled} selectedId={sourceId} onSelectionChange={(next) => { setSourceId(next); clearQuote(); }} />
            {mode === 'simple' ? (
              <>
            <MusicSampleSeedCard seed={activeSeed} mix={activeMix} onRemove={() => { setActiveSeed(null); setActiveMix(null); clearQuote(); }} />
            <label className="block">
              <span className="flex items-center justify-between text-sm font-bold text-vx-fg-body"><span>{activeSeed ? 'Add a new direction' : 'Describe the sound'}</span><span className="font-vx-mono text-xs text-vx-fg-faint">{description.length}/{activeSeed ? MUSIC_SAMPLE_DIRECTION_MAX : 500}</span></span>
              <textarea value={description} onChange={change(setDescription)} maxLength={activeSeed ? MUSIC_SAMPLE_DIRECTION_MAX : 500} rows={7} placeholder={activeSeed ? 'Optional: make it slower, add dusty piano, and open into a wide final chorus' : 'A slow instrumental night drive with brushed drums and glassy synths'} className="mt-2 w-full resize-y rounded-2xl border border-vx-border-boost bg-vx-base px-4 py-3 leading-6 text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-none" />
            </label>
            <button type="button" onClick={() => { setDescription((current) => nextMusicPrompt(current)); clearQuote(); }} className="min-h-10 rounded-full border border-vx-border px-4 text-sm font-bold text-vx-fg-body hover:border-vx-border-boost">Try a direction</button>
            <label className="block text-sm font-bold text-vx-fg-body">
              Working title <span className="font-normal text-vx-fg-muted">(optional)</span>
              <input value={title} onChange={change(setTitle)} maxLength={80} placeholder="Harbour Frame" className="mt-2 min-h-12 w-full rounded-xl border border-vx-border-boost bg-vx-base px-4 text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-none" />
            </label>
            <label className="block text-sm font-bold text-vx-fg-body">
              Verified model
              <select value={model?.id || modelId} onChange={change(setModelId)} disabled={!entitlements?.models?.length} className="mt-2 min-h-12 w-full rounded-xl border border-vx-border-boost bg-vx-base px-4 text-vx-fg focus:border-vx-accent focus:outline-none">
                {(entitlements?.models || []).map((item) => <option key={item.id} value={item.id} disabled={item.available === false}>{item.name}{item.requires_paid_plan ? item.available ? ' · paid plan' : ' · paid plan required' : ''}</option>)}
                {!entitlements?.models?.length ? <option>Loading verified models…</option> : null}
              </select>
            </label>
            {model?.available === false ? <p role="status" className="rounded-2xl border border-vx-border bg-vx-base px-4 py-3 text-sm text-vx-fg-muted">This higher-quality model requires an active paid plan. Choose ACE-Step or open Credits &amp; billing to upgrade.</p> : null}
            {model?.controls?.duration_seconds ? (
              <label className="block rounded-2xl border border-vx-border bg-vx-base px-4 py-3 text-sm font-bold text-vx-fg-body">
                <span className="flex items-center justify-between gap-3"><span>Song duration</span><output htmlFor="music-duration" className="font-vx-mono text-xs text-vx-accent">{durationSeconds} seconds</output></span>
                <input id="music-duration" aria-label="Song duration" type="range" min={model.controls.duration_seconds.min} max={model.controls.duration_seconds.max} step="5" value={durationSeconds} onChange={change((value) => setDurationSeconds(Number(value)))} className="mt-3 w-full accent-vx-accent" />
                <span className="mt-2 block font-normal leading-5 text-vx-fg-muted">The quoted candidate price covers any selected length from 10 to 60 seconds.</span>
              </label>
            ) : null}
            {model?.controls?.variety ? (
              <details className="rounded-2xl border border-vx-border bg-vx-base px-4 py-3 text-sm text-vx-fg-body">
                <summary className="cursor-pointer font-bold">Advanced controls</summary>
                <div className="mt-4 space-y-5 border-t border-vx-border pt-4">
                  <label className="block font-bold">
                    <span className="flex items-center justify-between gap-3"><span>Variety</span><output htmlFor="music-variety" className="font-vx-mono text-xs text-vx-accent">{variety}%</output></span>
                    <input id="music-variety" aria-label="Variety" type="range" min="0" max="100" step="1" value={variety} onChange={change((value) => setVariety(Number(value)))} className="mt-3 w-full accent-vx-accent" />
                    <span className="mt-2 block font-normal leading-5 text-vx-fg-muted">Higher values ask ACE-Step 1.5 for more creative, diverse musical decisions. 50 keeps its verified provider default.</span>
                  </label>
                  <label className="block font-bold">
                    <span className="flex items-center justify-between gap-3"><span>Style influence</span><output htmlFor="music-style-influence" className="font-vx-mono text-xs text-vx-accent">{styleInfluence}%</output></span>
                    <input id="music-style-influence" aria-label="Style influence" type="range" min="0" max="100" step="1" value={styleInfluence} onChange={change((value) => setStyleInfluence(Number(value)))} className="mt-3 w-full accent-vx-accent" />
                    <span className="mt-2 block font-normal leading-5 text-vx-fg-muted">Higher values strengthen language-model guidance. Any value above 0 can make provider generation substantially slower; 0 keeps its verified default.</span>
                  </label>
                  <label className="block font-bold">
                    <span className="flex items-center justify-between gap-3"><span>Exclude styles or instruments</span><span className="font-vx-mono text-xs text-vx-fg-faint">{excludeStyles.length}/500</span></span>
                    <input value={excludeStyles} onChange={change(setExcludeStyles)} maxLength={500} placeholder="e.g. distorted guitar, orchestral strings" className="mt-2 min-h-12 w-full rounded-xl border border-vx-border-boost bg-vx-panel px-4 font-normal text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-none" />
                    <span className="mt-2 block font-normal leading-5 text-vx-fg-muted">Sent as ACE-Step 1.5&apos;s negative music guidance; it is not a guaranteed content filter.</span>
                  </label>
                </div>
              </details>
            ) : null}
            <label className="flex min-h-12 items-center justify-between gap-4 rounded-2xl border border-vx-border bg-vx-base px-4 py-3 text-sm font-bold text-vx-fg-body">
              <span><span className="block">Instrumental</span><span className="font-normal text-vx-fg-muted">Required for this verified model</span></span>
              <input type="checkbox" checked={instrumental} onChange={change(setInstrumental)} className="h-5 w-5 accent-vx-accent" />
            </label>

            {!entitlements?.available && entitlements ? <p role="status" className="rounded-2xl border border-vx-border bg-vx-base px-4 py-3 text-sm text-vx-fg-muted">Server generation is paused. You can review this screen, but no quote or spend can start.</p> : null}
            {!hasSharedSlot ? <p role="status" className="rounded-2xl border border-vx-border bg-vx-base px-4 py-3 text-sm text-vx-fg-muted">All four shared request slots are active. New quotes stay paused until one pair finishes.</p> : null}
            {!instrumental ? <p role="status" className="text-sm text-vx-fg-muted">Vocal and lyrics generation is not connected in this increment.</p> : null}
            {sourceId ? <p role="status" className="rounded-2xl border border-vx-border bg-vx-base px-4 py-3 text-sm text-vx-fg-muted">The source is attached privately. Quote and generation remain disabled until the active model explicitly supports owned-audio conditioning.</p> : null}

            <section aria-label="Credit quote" data-testid="music-quote" className="rounded-2xl border border-dashed border-vx-border-boost bg-vx-base p-4">
              {quote ? (
                <>
                  <div className="flex items-center justify-between gap-3 text-sm text-vx-fg-body"><span>2 versions × {quote.credits_per_candidate} credits</span><strong className="font-vx-mono text-vx-money">{quote.total_credits} credits</strong></div>
                  <p className="mt-2 text-xs leading-5 text-vx-fg-muted">Exact live-catalog quote. Balance after confirmation: {quote.balance_after}. Expires {new Date(quote.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</p>
                </>
              ) : <p className="text-sm text-vx-fg-muted">Review the direction to receive an exact, short-lived quote before spending.</p>}
            </section>

            {!quote ? (
              <button type="submit" disabled={!canQuote} className="vx-press min-h-12 w-full rounded-full bg-vx-accent px-5 font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover disabled:cursor-not-allowed disabled:opacity-40">
                {busy === 'quoting' ? 'Reviewing live price…' : 'Review exact quote'}
              </button>
            ) : (
              <button type="button" onClick={() => confirmQuote({ title: title.trim() })} disabled={!quote.affordable || Boolean(busy) || !hasSharedSlot} className="vx-press min-h-12 w-full rounded-full bg-vx-accent px-5 font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover disabled:cursor-not-allowed disabled:opacity-40">
                {busy === 'confirming' ? 'Confirming one pair…' : quote.affordable ? `Create two versions · ${quote.total_credits} cr` : 'Not enough spendable credits'}
              </button>
            )}
            <p className="text-center text-xs text-vx-fg-faint">Credits move only after the second confirmation. Each candidate is tracked independently.</p>
              </>
            ) : <CustomDraftFields custom={custom} entitlements={entitlements} quote={quote} busy={busy} clearQuote={clearQuote} reviewQuote={reviewQuote} confirmQuote={confirmQuote} hasSharedSlot={hasSharedSlot} />}
          </div>
        </form>

        <section aria-labelledby="results-title" className="min-w-0 lg:col-span-3">
          <div className="mb-4"><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">{mode === 'simple' ? 'Independent candidates' : 'Revision-safe writing'}</p><h2 id="results-title" className="mt-1 font-vx text-2xl font-black">{mode === 'simple' ? 'Current server request' : 'Custom workspace'}</h2></div>
          {mode === 'custom' && !generations.length ? (
            <div className="rounded-2xl border border-dashed border-vx-border p-8 sm:p-12">
              <p className="font-vx text-2xl font-black">{customReady ? 'Your saved lyrics can become a private pair.' : 'Draft first. Generate only when verified.'}</p>
              <p className="mt-3 max-w-xl text-vx-fg-muted">{customReady ? 'The selected paid model accepts exact saved lyrics and style direction. Nothing is quoted or spent until the ownership attestation and separate confirmation.' : 'This workspace keeps original lyrics, style direction and title with optimistic revisions. Choose a Custom-ready catalog model before any quote or spend.'}</p>
              <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-2xl bg-vx-panel p-4"><dt className="text-vx-fg-muted">Current revision</dt><dd className="mt-1 font-vx-mono font-bold">{custom.draft.revision}</dd></div>
                <div className="rounded-2xl bg-vx-panel p-4"><dt className="text-vx-fg-muted">Generation</dt><dd className="mt-1 font-bold">{customReady ? 'Quote available after attestation' : 'Catalog incompatible'}</dd></div>
              </dl>
            </div>
          ) : !generations.length ? (
            <div className="rounded-2xl border border-dashed border-vx-border p-8 sm:p-12"><p className="font-vx text-2xl font-black">Your confirmed pair will land here.</p><p className="mt-3 max-w-xl text-vx-fg-muted">Reviewing a quote does not create or charge anything. After confirmation, both versions progress independently.</p></div>
          ) : (
            <div className="space-y-5">{generations.map((generation, index) => (
              <section key={generation.id} data-testid={`music-generation-${generation.id}`} aria-label={`Music request ${generations.length - index}`} className="rounded-2xl border border-vx-border bg-vx-panel p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Pair request</p><h3 className="mt-1 font-vx text-xl font-black">{generation.title || 'Untitled sound draft'}</h3></div><span className="rounded-full border border-vx-border px-3 py-1 font-vx-mono text-xs uppercase text-vx-fg-muted">{generation.state}</span></div>
                <div className="space-y-3">{(generation.candidates || []).map((candidate) => <ServerCandidate key={candidate.job_id || candidate.ordinal} candidate={candidate} title={generation.title} />)}</div>
              </section>
            ))}</div>
          )}
        </section>
      </div>
    </div>
  );
}
