'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { localeTag } from '../../../lib/i18n/locales.mjs';
import { gatewayFetch, makeIdempotencyKey, notifyBalanceChanged } from '../_lib/gateway';
import { clipsOverLimit, fetchSpeechQuote, pollSpeech, speechErrorKey, speechTotal, startSpeech } from '../_lib/speechCutClient';

const languageName = (locale, code) => new Intl.DisplayNames([localeTag(locale)], { type: 'language' }).of(code) || code;

/**
 * The paid half of Smart Cut: transcribe each clip so pauses can be cut where there is no speech.
 * The price comes from the server and is shown with the processor before the one confirm click; nothing
 * is sent or charged until then. One idempotency key is kept per clip, so Try again never charges twice.
 * `analyses` maps job id -> analysis; the free planner below reads it.
 */
export function SmartCutAnalyse({ clips, analyses, onAnalysed, disabled = false, fetcher = gatewayFetch }) {
  const { t, locale } = useI18n();
  const number = (n) => Number(n).toLocaleString(localeTag(locale));
  const [quote, setQuote] = useState({ state: 'loading' });
  const [run, setRun] = useState({ state: 'idle', done: 0, total: 0, stage: 'queued' });
  const [language, setLanguage] = useState('auto');
  const [completed, setCompleted] = useState(() => new Set());
  const [message, setMessage] = useState('');
  const keys = useRef(new Map());
  const abort = useRef(null);

  const unique = [...new Map(clips.map((clip) => [clip.job_id, clip])).values()];
  const ready = unique.length > 0 && unique.every((clip) => Number(clip.duration) > 0);
  const missing = unique.filter((clip) => !analyses?.has?.(clip.job_id));
  // An explicit language is a deliberate re-analysis of every selected clip;
  // automatic mode keeps the existing free/cached behavior for completed clips.
  const analysisKey = (jobId, selectedLanguage) => JSON.stringify([jobId, selectedLanguage]);
  const pending = language === 'auto' ? missing : unique.filter((clip) => !completed.has(analysisKey(clip.job_id, language)));

  useEffect(() => {
    let live = true;
    fetchSpeechQuote(fetcher)
      .then((value) => { if (live) setQuote(value ? { state: 'ready', ...value } : { state: 'off' }); })
      .catch(() => { if (live) setQuote({ state: 'off' }); });
    return () => { live = false; abort.current?.abort(); };
  }, [fetcher]);

  if (quote.state === 'loading') return <p role="status" className="mb-3 text-xs text-vx-fg-muted">{t('app.smartCut.analyse.checking')}</p>;
  if (quote.state === 'off') return <p className="mb-3 text-xs text-vx-fg-muted">{t('app.smartCut.analyse.unavailable')}</p>;

  const over = ready ? clipsOverLimit(unique, quote.maxSeconds) : [];
  const total = speechTotal(quote.credits, pending.length);
  const running = run.state === 'running';

  async function analyseAll() {
    const controller = new AbortController();
    abort.current = controller;
    setMessage('');
    setRun({ state: 'running', done: 0, total: pending.length, stage: 'queued' });
    let done = 0;
    try {
      for (const clip of pending) {
        // The key lives until the clip has an outcome, so a retry joins the first request instead of paying again.
        const keyId = analysisKey(clip.job_id, language);
        if (!keys.current.has(keyId)) keys.current.set(keyId, makeIdempotencyKey());
        const key = keys.current.get(keyId);
        let result = await startSpeech(fetcher, { jobId: clip.job_id, duration: Number(clip.duration), key, credits: quote.credits, language });
        if (result.status === 'queued') result = await pollSpeech(fetcher, key, {
          signal: controller.signal,
          onProgress: (stage) => setRun({ state: 'running', done, total: pending.length, stage }),
        });
        setRun({ state: 'running', done, total: pending.length, stage: 'checking' });
        keys.current.delete(keyId);
        notifyBalanceChanged();
        if (result.status === 'failed') { setRun({ state: 'error', done, total: pending.length, stage: 'checking' }); setMessage(t('app.smartCut.analyse.refunded')); return; }
        if (result.speech === false) { setRun({ state: 'error', done, total: pending.length, stage: 'checking' }); setMessage(t('app.smartCut.analyse.noSpeech')); return; }
        onAnalysed(clip.job_id, result.analysis);
        setCompleted((value) => new Set(value).add(keyId));
        done += 1;
        setRun({ state: 'running', done, total: pending.length, stage: 'queued' });
      }
      setRun({ state: 'done', done, total: pending.length, stage: 'checking' });
    } catch (error) {
      if (error?.code === 'cancelled') return;
      // A definite refusal never charged, so the next attempt may use a fresh key; anything unclear keeps its key.
      if (error?.code !== 'poll_timeout' && error?.code !== 'outcome_pending') keys.current.clear();
      if (error?.code === 'price_changed') {
        fetchSpeechQuote(fetcher).then((value) => setQuote(value ? { state: 'ready', ...value } : { state: 'off' })).catch(() => setQuote({ state: 'off' }));
      }
      notifyBalanceChanged();
      setRun({ state: 'error', done, total: pending.length, stage: 'checking' });
      setMessage(t(speechErrorKey(error)));
    }
  }

  return (
    <section className="mb-4 rounded-2xl border border-vx-border bg-vx-base p-4" aria-labelledby="smart-cut-analyse-title">
      <h3 id="smart-cut-analyse-title" className="text-base font-black">{t('app.smartCut.analyse.title')}</h3>
      <p className="mt-1 max-w-2xl text-xs leading-5 text-vx-fg-muted">{t('app.smartCut.analyse.body')}</p>
      <label className="mt-3 block text-[11px] font-bold text-vx-fg-muted">{t('app.smartCut.analyse.language')}
        <select aria-label={t('app.smartCut.analyse.language')} disabled={disabled || running} value={language} onChange={(event) => { setLanguage(event.target.value); setRun({ state: 'idle', done: 0, total: 0, stage: 'queued' }); setMessage(''); }}
          className="mt-1 min-h-11 w-full rounded-xl border border-vx-border bg-vx-panel-raised px-3 py-2.5 text-sm text-vx-fg disabled:opacity-50">
          <option value="auto">{t('app.smartCut.analyse.languageAuto')}</option>
          {quote.languages.map((code) => <option key={code} value={code}>{languageName(locale, code)}</option>)}
        </select>
        <span className="mt-1 block font-normal leading-5">{t('app.smartCut.analyse.languageHelp')}</span>
      </label>
      {pending.length === 0 ? (
        <p role="status" className="mt-3 text-xs font-semibold text-vx-fg">{t('app.smartCut.analyse.done')}</p>
      ) : (
        <>
          <p className="mt-2 text-xs leading-5 text-vx-fg-muted">{t('app.smartCut.analyse.privacy')}</p>
          <p className="mt-2 font-vx-mono text-xs font-bold text-vx-fg vx-num">{t('app.smartCut.analyse.price', { total: number(total), credits: number(quote.credits), seconds: number(quote.maxSeconds) })}</p>
          {over.length > 0 && <p role="alert" className="mt-2 text-xs text-vx-danger">{t('app.smartCut.analyse.tooLong', { seconds: number(quote.maxSeconds) })}</p>}
          <button type="button" onClick={analyseAll} disabled={disabled || running || !ready || over.length > 0}
            className="vx-press mt-3 min-h-11 rounded-full bg-vx-accent px-5 text-sm font-extrabold text-vx-accent-ink disabled:cursor-not-allowed disabled:opacity-40">
            {running ? t('app.smartCut.analyse.running', { done: number(Math.min(run.done + 1, run.total)), total: number(run.total) })
              : run.state === 'error' ? t('app.smartCut.analyse.retry') : t('app.smartCut.analyse.confirm', { total: number(total) })}
          </button>
          {running && <p role="status" data-smart-cut-stage={run.stage} className="mt-2 text-xs font-semibold text-vx-fg-muted">
            {t(`app.smartCut.analyse.stage.${run.stage}`)}
          </p>}
        </>
      )}
      {message && <p role="alert" className="mt-2 text-xs font-semibold text-vx-fg-muted">{message}</p>}
    </section>
  );
}
