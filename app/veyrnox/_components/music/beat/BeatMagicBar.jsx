'use client';
import { assertBeatWritable, beatReadOnly, BEAT_READ_ONLY_MESSAGE, capabilityGeneration, assertBeatGeneration } from '../../../_lib/music/beat/beatCompatibility.mjs';
import { tOr } from '../../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

import { useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../../../_lib/gateway';
import { useMusicCelebrations } from '../../../_lib/useMusicCelebrations';
import { MusicPrivateAudio } from '../../../_lib/useMusicAudioSrc';
import { EXAMPLE_PROMPT_KEYS, MAGIC_LAYER_LIMIT, MAGIC_PROMPT_MAX, barChoices, magicQuoteBody, startExampleRotation } from '../../../_lib/music/beat/magicBar.mjs';
import { action, button, input } from './beatStyles';

const TERMINAL = new Set(['succeeded', 'partial', 'failed', 'refunded']);

function friendly(reason, t) {
  const code = reason?.code;
  if (['v5_write_disabled', 'capability_changed'].includes(code)) return t(BEAT_READ_ONLY_MESSAGE);
  if (code === 'plan_unavailable') return t('app.music.beat.recovery.r5');
  if (code === 'insufficient_balance') return t('app.music.beat.recovery.r6');
  if (code === 'prompt_blocked' || code === 'prompt_invalid') return t('app.music.beat.recovery.r7');
  if (code === 'rate_limited') return t('app.music.beat.recovery.r8');
  return t('app.music.beat.recovery.r9');
}

/**
 * Magic Bar: describe a part, see the exact price, confirm, then add one of
 * the two results to the beat as a loop layer. Results are also saved as
 * private songs in the Music Library, like every Create pair.
 */
export default function BeatMagicBar({ doc, loops, announce, hidePrompt = false }) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState('');
  const bars = barChoices(doc.tempo.bpm);
  const [length, setLength] = useState(bars.includes(8) ? 8 : bars[0]);
  const [quote, setQuote] = useState(null);
  const [generation, setGeneration] = useState(null);
  const registerCelebration = useMusicCelebrations(generation ? [generation] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const attempt = useRef(null);
  // The placeholder rotates through example parts while the field is empty; people who ask for
  // reduced motion get the first example and nothing changes under them.
  const [example, setExample] = useState(0);
  useEffect(() => (prompt ? undefined : startExampleRotation({ win: typeof window === 'undefined' ? null : window, onIndex: setExample })), [prompt]);

  async function refresh(id) {
    const next = await gatewayFetch(`/music/generations/${id}`);
    setGeneration(next);
    if (next.state === 'failed' || next.state === 'refunded') announce(t('app.music.beat.status.s32'));
    return next;
  }

  const pollingId = generation && !TERMINAL.has(generation.state) ? generation.id : null;
  useEffect(() => {
    if (!pollingId) return undefined;
    const timer = window.setInterval(() => {
      gatewayFetch(`/music/generations/${pollingId}`).then((next) => {
        setGeneration(next);
        if (next.state === 'failed' || next.state === 'refunded') announce(t('app.music.beat.status.s32'));
      }).catch(() => {});
    }, 1500);
    return () => window.clearInterval(timer);
  }, [pollingId, announce, t]);

  const reset = () => { setQuote(null); setError(''); };

  async function price(event) {
    event.preventDefault();
    if (busy || !prompt.trim()) return;
    setBusy(true); setError(''); setQuote(null);
    try {
      assertBeatWritable(doc);
      setQuote(await gatewayFetch('/music/generation-quotes', { method: 'POST', body: JSON.stringify(magicQuoteBody({ prompt, bpm: doc.tempo.bpm, bars: length, title: `${doc.title} loop` })) }));
    } catch (reason) { setError(friendly(reason, t)); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (busy || !quote?.quote_id) return;
    setBusy(true); setError('');
    const key = attempt.current || `magic.${crypto.randomUUID()}`;
    attempt.current = key;
    try {
      assertBeatWritable(doc);
      const generation = capabilityGeneration();
      const beforeSend = () => { assertBeatGeneration(generation); assertBeatWritable(doc); };
      const accepted = await gatewayFetch('/music/generations', { beforeSend, method: 'POST', body: JSON.stringify({ quote_id: quote.quote_id, idempotency_key: key }) });
      registerCelebration(accepted, quote.total_credits);
      attempt.current = null;
      setGeneration({ id: accepted.generation_id, state: accepted.state, candidates: accepted.candidates });
      announce(t('app.music.beat.status.s33', { p0: quote.total_credits }));
      await refresh(accepted.generation_id);
    } catch (reason) { setError(friendly(reason, t)); }
    finally { setBusy(false); }
  }

  function addLayer(candidate) {
    const added = loops.add({ songId: candidate.song_id, audioUrl: candidate.audio_url, title: `${prompt.trim().slice(0, 40) || 'Magic loop'} ${candidate.label || candidate.ordinal}`, bars: length, bpm: doc.tempo.bpm, muted: false });
    if (added) announce(t('app.music.beat.status.s34'));
  }

  const readOnly = beatReadOnly(doc);
  const full = loops.layers.length >= MAGIC_LAYER_LIMIT;
  const candidates = generation?.candidates || [];
  const terminal = generation && TERMINAL.has(generation.state);
  return (
    <section aria-labelledby="magic-bar-title" className="space-y-4 rounded-2xl border border-vx-border bg-vx-panel p-4">
      <div><h2 id="magic-bar-title" className="text-lg font-black">{t('app.music.beat.ui.magic.bar')}</h2><p className="text-sm text-vx-fg-muted">{t('app.music.beat.ui.describe.a.part.and.get.two.loops.in.time.with.this.beat.you.see.the.p')}</p></div>
      {!hidePrompt && !generation ? (<form onSubmit={price} className="flex flex-col gap-3 md:flex-row md:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-bold">{t('app.music.beat.ui.describe.the.part')}<input className={`${input} w-full font-normal`} value={prompt} maxLength={MAGIC_PROMPT_MAX} aria-invalid={!prompt.trim() || prompt.trim().length > MAGIC_PROMPT_MAX} aria-describedby="beat-magic-prompt-error" placeholder={t(EXAMPLE_PROMPT_KEYS[example])} onChange={(e) => { setPrompt(e.target.value); reset(); }} /><span id="beat-magic-prompt-error" className="text-sm font-normal text-vx-danger">{!prompt.trim() || prompt.trim().length > MAGIC_PROMPT_MAX ? t('app.music.beat.ai.a6') : ''}</span></label>
          <label className="flex flex-col gap-1 text-sm font-bold">{t('app.music.beat.ui.length')}<select className={`${input} font-normal`} value={length} onChange={(e) => { setLength(Number(e.target.value)); reset(); }}>{bars.map((n) => <option key={n} value={n}>{n}{t('app.music.beat.ui.bars.2')}</option>)}</select></label>
          {!quote ? <button type="submit" className={action} title={readOnly ? t(BEAT_READ_ONLY_MESSAGE) : undefined} disabled={readOnly || busy || !prompt.trim() || full}>{busy ? t('app.music.beat.ui.pricing') : t('app.music.beat.ui.price.two.loops')}</button> : null}
        </form>) : null}
      {full && !generation ? <p className="text-sm text-vx-fg-muted">{t('app.music.beat.ui.this.beat.has')}{MAGIC_LAYER_LIMIT}{t('app.music.beat.ui.loops.remove.one.to.add.another')}</p> : null}
      {!hidePrompt && quote && !generation ? (<div className="rounded-xl border border-vx-accent/40 bg-vx-accent/10 p-3">
          <p className="font-bold">{t('app.music.beat.ui.two.loops')}<span className="text-vx-money">{quote.total_credits}{t('app.music.beat.ui.credits.2')}</span></p>
          <p className="text-sm text-vx-fg-muted">{t('app.music.beat.ui.balance')}{quote.balance} → {quote.balance_after}{t('app.music.beat.ui.a.failed.loop.is.refunded')}</p>
          <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={action} title={readOnly ? t(BEAT_READ_ONLY_MESSAGE) : undefined} disabled={readOnly || busy || !quote.affordable} onClick={confirm}>{busy ? t('app.music.beat.ui.confirming.once') : t('app.music.beat.status.s35', { p0: quote.total_credits })}</button><button type="button" className={button} onClick={reset}>{t('app.music.beat.ui.change')}</button></div>
        </div>) : null}
      {generation ? (<div aria-live={terminal ? 'off' : 'polite'} className="space-y-3">
          <p className="font-bold">{terminal ? t('app.music.beat.ui.loops.finished') : t('app.music.beat.ui.making.two.loops')}</p>
          <ul className="grid gap-3 md:grid-cols-2">{candidates.map((candidate) => (
            <li key={candidate.job_id || candidate.ordinal} className="rounded-xl border border-vx-border bg-vx-base p-3">
              <div className="flex items-center justify-between gap-2"><strong>{t('app.music.beat.ui.loop')}{candidate.label || candidate.ordinal}</strong><span className="text-sm capitalize text-vx-fg-muted">{tOr(t, `app.music.beat.shared.state.${candidate.state}`, t('app.music.beat.shared.state.unknown'))}</span></div>
              {candidate.audio_url ? <><MusicPrivateAudio controls preload="none" src={candidate.audio_url} aria-label={t('app.music.beat.status.s36', { p0: candidate.label || candidate.ordinal })} className="mt-2 w-full" /><button type="button" className={`${action} mt-2`} disabled={readOnly || full || loops.layers.some((layer) => layer.songId === candidate.song_id)} onClick={() => addLayer(candidate)}>{t('app.music.beat.ui.add.to.beat')}</button></> : null}
            </li>
          ))}</ul>
          {terminal ? <button type="button" className={button} onClick={() => { setGeneration(null); setQuote(null); }}>{t('app.music.beat.ui.make.another')}</button> : null}
        </div>) : null}
      {loops.layers.length ? (<div><h3 className="text-sm font-bold">{t('app.music.beat.ui.loops.in.this.beat')}</h3><ul className="mt-2 space-y-2">{loops.layers.map((layer) => (
          <li key={layer.songId} className="flex flex-wrap items-center gap-2 rounded-xl bg-vx-base p-2"><span className="min-w-0 flex-1 truncate text-sm">{layer.title} · {layer.bars}{t('app.music.beat.ui.bars.2')}</span><button type="button" className={button} disabled={readOnly} title={readOnly ? t(BEAT_READ_ONLY_MESSAGE) : undefined} aria-pressed={layer.muted} onClick={() => loops.toggleMute(layer.songId)}>{layer.muted ? t('app.music.beat.ui.unmute') : t('app.music.beat.ui.mute')}</button><button type="button" className={button} disabled={readOnly} title={readOnly ? t(BEAT_READ_ONLY_MESSAGE) : undefined} onClick={() => { loops.remove(layer.songId); announce(t('app.music.beat.status.s38')); }}>{t('app.music.beat.ui.remove')}</button></li>
        ))}</ul></div>) : null}
      {loops.error ? <p role="alert" className="text-sm text-vx-danger">{loops.error}</p> : null}
      {error ? <p role="alert" className="rounded-xl border border-vx-danger/40 bg-vx-danger/10 p-3 text-sm text-vx-danger">{error}</p> : null}
    </section>
  );
}
