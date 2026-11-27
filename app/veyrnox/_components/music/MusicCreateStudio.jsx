'use client';

import { PromptBox } from '../PromptBox';
import { useMemo, useRef, useState } from 'react';
import { quoteMusicRequest } from '../../_lib/music/previewStore';
import { MusicCandidateCard } from './MusicCandidateCard';
import { useMusicPreviewState } from './useMusicPreviewState';
import { MusicServerStudio } from './MusicServerStudio';
import { MusicSampleSeedCard } from './MusicSampleSeedCard';
import { LicensedTemplateCard } from './LicensedTemplateCard';
import { resolveInitialDescription } from '../../../../lib/licensedTrackTemplates.js';
import { buildMusicSamplePrompt, MUSIC_SAMPLE_DIRECTION_MAX } from '../../../../lib/musicDiscover.js';
import { useI18n } from '../../../../components/I18nProvider';
import { MusicCreationModeTabs } from './MusicCreationModeTabs';
import { buildMusicDirection, EMPTY_MUSIC_DIRECTION, MusicAdvancedDirectionFields } from './MusicAdvancedDirectionFields';

export function MusicCreateStudio({ serverMode = false, sourcesEnabled = false, sampleSeed = null, sampleMix = null, licensedTemplate = null, challengeSeed = null }) {
  if (serverMode) return <MusicServerStudio sourcesEnabled={sourcesEnabled} sampleSeed={sampleSeed} sampleMix={sampleMix} licensedTemplate={licensedTemplate} challengeSeed={challengeSeed} />;
  return <MusicPreviewCreateStudio sampleSeed={sampleSeed} sampleMix={sampleMix} licensedTemplate={licensedTemplate} challengeSeed={challengeSeed} />;
}

function MusicPreviewCreateStudio({ sampleSeed, sampleMix, licensedTemplate, challengeSeed }) {
  const { t } = useI18n();
  const challengePrompt = challengeSeed ? t(challengeSeed.prompt_key) : '';
  const challengeTitle = challengeSeed ? t(challengeSeed.title_key) : '';
  const { state, rows, storageError, create, cancel, reset } = useMusicPreviewState();
  const [mode, setMode] = useState('simple');
  const [description, setDescription] = useState(() => resolveInitialDescription({ sampleSeed, licensedTemplate, challengePrompt }));
  const [activeTemplate, setActiveTemplate] = useState(sampleSeed ? null : licensedTemplate);
  const [activeSeed, setActiveSeed] = useState(sampleSeed);
  const [activeMix, setActiveMix] = useState(sampleMix);
  const [lyrics, setLyrics] = useState('');
  const [styles, setStyles] = useState('');
  const [title, setTitle] = useState(() => challengeTitle.slice(0, 80));
  const [direction, setDirection] = useState(EMPTY_MUSIC_DIRECTION);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);

  const basePrompt = mode === 'simple'
    ? activeSeed ? buildMusicSamplePrompt(activeSeed, description, activeMix) : description.trim()
    : [lyrics.trim(), styles.trim()].filter(Boolean).join('\n\n');
  const prompt = buildMusicDirection(basePrompt, direction, 500);
  const quote = useMemo(() => state ? quoteMusicRequest({ prompt }, state) : null, [prompt, state]);

  function submit(event) {
    event.preventDefault();
    // React state is not a same-tick mutex: two DOM clicks can both observe
    // the old `sending` value. The ref closes that gap before a second request
    // can mint a different idempotency key and spend on another preview track.
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError('');
    try {
      create({ prompt, title, styles, mode, scenario: 'success' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The preview request could not start.');
    } finally {
      // Keep the synchronous guard closed through the current task. React may
      // flush state between two programmatic clicks, but the second submit
      // must never observe an unlocked request in the same turn.
      queueMicrotask(() => {
        sendingRef.current = false;
        setSending(false);
      });
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Create music</p>
          <h1 className="mt-2 font-vx text-4xl font-black tracking-tight sm:text-5xl">Turn one idea into one track.</h1>
          <p className="mt-3 max-w-2xl text-vx-fg-body">Describe the sound or bring your own lyrics, then shape voice, genre, mood and tempo with smart controls.</p>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-vx-border bg-vx-panel px-4 py-3">
          <span className="text-sm text-vx-fg-muted">Preview balance</span>
          <strong data-testid="music-credits" className="font-vx-mono text-lg text-vx-money">{state?.credits ?? '—'} cr</strong>
        </div>
      </div>

      {(storageError || error) && <div role="alert" className="mb-5 rounded-2xl border border-vx-danger/50 bg-vx-danger/10 px-4 py-3 text-sm text-vx-danger">{storageError || error}</div>}

      <div className="grid gap-8 lg:grid-cols-5">
        <form onSubmit={submit} className="self-start rounded-2xl border border-vx-border bg-vx-panel p-5 shadow-2xl lg:sticky lg:top-24 lg:col-span-2 sm:p-6">
          <MusicCreationModeTabs mode={mode} onChange={setMode} />

          <div className="mt-6 space-y-5">
            {mode === 'simple' ? (
              <>
                <MusicSampleSeedCard seed={activeSeed} mix={activeMix} onRemove={() => { setActiveSeed(null); setActiveMix(null); }} />
                <LicensedTemplateCard template={activeTemplate} onRemove={() => { setDescription(''); setActiveTemplate(null); }} />
                <label className="block">
                  <span className="flex items-center justify-between text-sm font-bold text-vx-fg-body"><span>{activeSeed ? 'Add a new direction' : 'Describe the sound'}</span><span className="font-vx-mono text-xs text-vx-fg-faint">{description.length}/{activeSeed ? MUSIC_SAMPLE_DIRECTION_MAX : 500}</span></span>
                  <PromptBox enhance value={description} onChange={(event) => setDescription(event.target.value)} maxLength={activeSeed ? MUSIC_SAMPLE_DIRECTION_MAX : 500} rows={7} placeholder={activeSeed ? 'Optional: make it slower, add dusty piano, and open into a wide final chorus' : 'A slow instrumental night drive with brushed drums and glassy synths'} />
                </label>
              </>
            ) : (
              <>
                <label className="block">
                  <span className="flex items-center justify-between text-sm font-bold text-vx-fg-body"><span>Original lyrics or structure</span><span className="font-vx-mono text-xs text-vx-fg-faint">{lyrics.length}/3000</span></span>
                  <PromptBox value={lyrics} onChange={(event) => setLyrics(event.target.value)} maxLength={3000} rows={7} placeholder={'[Verse]\nWrite your own words here'} />
                </label>
                <label className="block text-sm font-bold text-vx-fg-body">
                  Style direction
                  <input value={styles} onChange={(event) => setStyles(event.target.value)} maxLength={500} placeholder="Warm vocal, spare piano, 84 bpm" className="mt-2 min-h-12 w-full rounded-xl border border-vx-border-boost bg-vx-base px-4 text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-none" />
                </label>
                <label className="block text-sm font-bold text-vx-fg-body">
                  Working title <span className="font-normal text-vx-fg-muted">(optional)</span>
                  <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="Harbour Frame" className="mt-2 min-h-12 w-full rounded-xl border border-vx-border-boost bg-vx-base px-4 text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-none" />
                </label>
              </>
            )}

            <MusicAdvancedDirectionFields value={direction} onChange={setDirection} />

            <section aria-label="Credit quote" data-testid="music-quote" className="rounded-2xl border border-dashed border-vx-border-boost bg-vx-base p-4">
              {quote ? (
                <>
                  <div className="flex items-center justify-between gap-3 text-sm text-vx-fg-body"><span>1 track</span><strong className="font-vx-mono text-vx-money">5 credits</strong></div>
                  <p className="mt-2 text-xs leading-5 text-vx-fg-muted">A failed or cancelled track returns its 5-credit charge. Balance after this request: {quote.balanceAfter}.</p>
                </>
              ) : <p className="text-sm text-vx-fg-muted">Write a direction to receive an exact quote.</p>}
            </section>

            <button type="submit" disabled={!quote?.affordable || sending} className="vx-press min-h-12 w-full rounded-full bg-vx-accent px-5 font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover disabled:cursor-not-allowed disabled:opacity-40">
              {sending ? 'Creating your track…' : quote?.affordable ? 'Create music · 5 cr' : quote ? 'Not enough preview credits' : 'Add a direction first'}
            </button>
            <p className="text-center text-xs text-vx-fg-faint">Browser-only test data. No external generation request is sent.</p>
          </div>
        </form>

        <section aria-labelledby="results-title" className="min-w-0 lg:col-span-3">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Your track</p><h2 id="results-title" className="mt-1 font-vx text-2xl font-black">Current workspace</h2></div>
            {rows.length > 0 && process.env.NODE_ENV === 'development' ? <button type="button" onClick={reset} className="min-h-10 rounded-full border border-vx-border px-4 text-xs font-bold text-vx-fg-muted hover:border-vx-danger hover:text-vx-danger">Reset preview</button> : null}
          </div>
          {!state ? (
            <div aria-busy="true" className="space-y-3"><div className="vx-shimmer h-28 rounded-2xl bg-vx-panel"/><div className="vx-shimmer h-28 rounded-2xl bg-vx-panel"/></div>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-vx-border p-8 sm:p-12"><p className="font-vx text-2xl font-black">Your first track will land here.</p><p className="mt-3 max-w-xl text-vx-fg-muted">It stays private. Listen here, then reopen the finished track from Music Library.</p></div>
          ) : (
            <div className="space-y-3">{rows.map((song) => <MusicCandidateCard key={song.id} song={song} onCancel={cancel} />)}</div>
          )}
        </section>
      </div>
    </div>
  );
}
