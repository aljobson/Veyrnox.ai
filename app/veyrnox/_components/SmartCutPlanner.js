'use client';

import { useRef, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { localeTag } from '../../../lib/i18n/locales.mjs';
import { useAssetUrl } from '../_lib/useAssetUrl';
import { buildSpeechAwareCutPlan } from '../_lib/smartCutAnalysis';
import { buildSmartCutPlan, SMART_CUT_PACING, smartCutPlanUsesAvailableTakes, smartCutPlanWithinLimits, swapSmartCutTake } from '../_lib/smartCut';

const inputClass = 'mt-1 w-full rounded-xl border border-vx-border bg-vx-base px-3 py-2.5 text-sm text-vx-fg focus:border-vx-accent focus:outline-hidden';

export function SmartCutPlanner({ clips, analyses = null, disabled = false, onApply, onUndo, startOpen = false }) {
  const { t, locale } = useI18n();
  const number = (value, options) => Number(value).toLocaleString(localeTag(locale), options);
  const [open, setOpen] = useState(startOpen);
  const [script, setScript] = useState('');
  const [notes, setNotes] = useState('');
  const [pacing, setPacing] = useState('balanced');
  const [plan, setPlan] = useState(null);
  const [view, setView] = useState('cut');
  const [notice, setNotice] = useState('');
  const ready = clips.length > 0 && clips.every((clip) => Number.isFinite(Number(clip.duration)) && Number(clip.duration) > 0);
  const analysisReady = ready && analyses && clips.every((clip) => {
    if (analyses instanceof Map) return analyses.has(clip.job_id);
    if (Array.isArray(analyses)) return analyses.some((analysis) => analysis?.assetId === clip.job_id);
    return Boolean(analyses[clip.job_id]);
  });
  const modeLabel = t(plan?.mode === 'transcript-silence' ? 'app.smartCut.mode.speechAware' : 'app.smartCut.mode.localPreview');

  function createPlan() {
    if (disabled) return;
    try {
      setPlan(analysisReady
        ? buildSpeechAwareCutPlan({ clips, analyses })
        : buildSmartCutPlan({ clips, script, notes, pacing }));
      setView('cut');
      setNotice(t(analysisReady ? 'app.smartCut.notice.speechCreated' : 'app.smartCut.notice.localCreated'));
    } catch (error) {
      setPlan(null);
      setNotice(error instanceof Error ? error.message : t('app.smartCut.notice.failed'));
    }
  }

  function restart() {
    if (disabled) return;
    setPlan(null);
    setNotice('');
  }

  function discard() {
    if (disabled) return;
    setPlan(null);
    setOpen(false);
    setNotice('');
  }

  function apply() {
    if (disabled) return;
    if (!smartCutPlanWithinLimits(plan)) {
      setNotice(t('app.smartCut.notice.outsideLimits'));
      return;
    }
    if (!smartCutPlanUsesAvailableTakes(plan, clips)) {
      setNotice(t('app.smartCut.notice.clipsChanged'));
      return;
    }
    const sourceById = new Map(clips.map((clip) => [String(clip.uid || clip.job_id), clip]));
    const nextClips = plan.segments.map((segment, index) => ({
      ...sourceById.get(segment.takeId),
      uid: `${segment.takeId}#smart-cut-${index}`,
      in_s: segment.start,
      out_s: segment.end,
      slow: 1,
    }));
    onApply(nextClips);
    setPlan(null);
    setOpen(false);
    setNotice(t('app.smartCut.notice.applied'));
  }

  if (!open) {
    return (
      <section className="mb-4 rounded-2xl border border-vx-accent/40 bg-vx-accent/[0.06] p-4" aria-labelledby="smart-cut-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">{t('app.smartCut.name')} · {t(analysisReady ? 'app.smartCut.mode.speechReady' : 'app.smartCut.mode.localPreview')}</p>
            <h3 id="smart-cut-heading" className="mt-1 text-base font-black">{t('app.smartCut.summary.title')}</h3>
            <p className="mt-1 max-w-xl text-xs leading-5 text-vx-fg-muted">{t(analysisReady ? 'app.smartCut.summary.speech' : 'app.smartCut.summary.local')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {onUndo && <button type="button" disabled={disabled} onClick={onUndo} className="min-h-10 rounded-full border border-vx-border px-4 text-xs font-extrabold hover:border-vx-accent disabled:opacity-40">{t('app.smartCut.action.undo')}</button>}
            <button type="button" disabled={disabled || !ready} onClick={() => setOpen(true)} className="min-h-10 rounded-full bg-vx-accent px-4 text-xs font-extrabold text-vx-accent-ink disabled:cursor-not-allowed disabled:opacity-40">{t('app.smartCut.action.plan')}</button>
          </div>
        </div>
        {!ready && <p className="mt-2 text-xs text-vx-fg-muted">{t('app.smartCut.wait')}</p>}
        {notice && <p role="status" className="mt-2 text-xs font-semibold text-vx-fg-muted">{notice}</p>}
      </section>
    );
  }

  return (
    <section className="mb-4 rounded-2xl border border-vx-accent/40 bg-vx-panel-raised p-4 sm:p-5" aria-labelledby="smart-cut-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">{t('app.smartCut.name')} · {modeLabel}</p>
          <h3 id="smart-cut-heading" className="mt-1 text-lg font-black">{t(plan ? 'app.smartCut.review.title' : 'app.smartCut.shape.title')}</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-vx-fg-muted">{t(analysisReady ? 'app.smartCut.explainer.speech' : 'app.smartCut.explainer.local')}</p>
        </div>
        <button type="button" disabled={disabled} onClick={discard} className="min-h-10 rounded-full border border-vx-border px-3 text-xs font-bold text-vx-fg-muted hover:border-vx-danger hover:text-vx-danger disabled:opacity-40">{t('app.smartCut.action.discard')}</button>
      </div>

      {!plan ? (
        <div className="mt-4 grid gap-4">
          {analysisReady && <p className="rounded-xl border border-vx-border bg-vx-base p-3 text-xs leading-5 text-vx-fg-muted">{t('app.smartCut.speechReady')}</p>}
          {!analysisReady && <>
          <label className="text-[11px] font-bold text-vx-fg-muted">{t('app.smartCut.script')}
            <textarea disabled={disabled} value={script} onChange={(event) => setScript(event.target.value)} rows="4" placeholder={t('app.smartCut.scriptPlaceholder')} className={`${inputClass} resize-y disabled:opacity-50`} />
          </label>
          <label className="text-[11px] font-bold text-vx-fg-muted">{t('app.smartCut.notes')}
            <textarea disabled={disabled} value={notes} onChange={(event) => setNotes(event.target.value)} rows="2" placeholder={t('app.smartCut.notesPlaceholder')} className={`${inputClass} resize-y disabled:opacity-50`} />
          </label>
          <fieldset>
            <legend className="text-[11px] font-bold text-vx-fg-muted">{t('app.smartCut.pacing')}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(SMART_CUT_PACING).map(([key, option]) => (
                <button key={key} type="button" disabled={disabled} aria-pressed={pacing === key} onClick={() => setPacing(key)} className="min-h-10 rounded-full border border-vx-border px-4 text-xs font-bold text-vx-fg-body hover:border-vx-accent aria-pressed:border-vx-accent aria-pressed:bg-vx-accent aria-pressed:text-vx-accent-ink disabled:opacity-40">{t(option.labelKey)}</button>
              ))}
            </div>
          </fieldset>
          </>}
          {!ready && <p role="status" className="text-xs text-vx-fg-muted">{t('app.smartCut.reading')}</p>}
          <button type="button" disabled={disabled || !ready} onClick={createPlan} className="min-h-11 justify-self-start rounded-full bg-vx-accent px-5 text-sm font-extrabold text-vx-accent-ink disabled:cursor-not-allowed disabled:opacity-40">{t(analysisReady ? 'app.smartCut.action.removePauses' : 'app.smartCut.action.createPreview')}</button>
        </div>
      ) : (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2" role="group" aria-label={t('app.smartCut.compare')}>
              {Object.keys({ raw: true, cut: true }).map((mode) => <button key={mode} type="button" disabled={disabled} aria-pressed={view === mode} onClick={() => setView(mode)} className="min-h-10 rounded-full border border-vx-border px-4 text-xs font-bold uppercase tracking-wide aria-pressed:border-vx-accent aria-pressed:bg-vx-accent aria-pressed:text-vx-accent-ink disabled:opacity-40">{t(`app.smartCut.view.${mode}`)}</button>)}
            </div>
            <span className="font-vx-mono text-[11px] font-bold text-vx-fg-muted vx-num">{t('app.smartCut.planSummary', {
              duration: number(plan.totalDuration, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
              count: number(plan.segments.length),
              pacing: t(`app.smartCut.pacing.${plan.pacing}`),
            })}{plan.mode === 'transcript-silence' ? t('app.smartCut.removed', { duration: number(plan.silenceRemoved, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) : ''}</span>
          </div>

          {view === 'raw' ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {plan.takes.map((take) => <div key={take.id} className="rounded-xl border border-vx-border bg-vx-base p-3"><p className="truncate text-sm font-bold">{take.name}</p><p className="mt-1 font-vx-mono text-[10px] text-vx-fg-muted vx-num">{t('app.smartCut.sourceDuration', { duration: number(take.duration, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</p><SmartCutSegmentPreview clip={clips.find((clip) => String(clip.uid || clip.job_id) === take.id)} start={take.rangeStart ?? 0} end={take.rangeEnd ?? take.duration} /></div>)}
            </div>
          ) : (
            <ol className="mt-3 grid gap-3">
              {plan.segments.map((segment, index) => {
                const take = plan.takes.find((item) => item.id === segment.takeId);
                const eligibleTakes = plan.mode === 'transcript-silence'
                  ? plan.takes.filter((item) => item.id === segment.takeId)
                  : plan.takes;
                return (
                  <li key={segment.id} className="rounded-xl border border-vx-border bg-vx-base p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1"><p className="font-vx-mono text-[9px] font-bold text-vx-accent">{t('app.smartCut.section', { count: number(index + 1) })}</p><p className="mt-1 line-clamp-2 text-sm font-bold">{segment.label}</p></div>
                      <span className="font-vx-mono text-[10px] text-vx-fg-muted vx-num">{t('app.smartCut.range', { start: number(segment.start, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), end: number(segment.end, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</span>
                    </div>
                    <label className="mt-3 block text-[10px] font-bold text-vx-fg-muted">{t('app.smartCut.take')}
                      <select aria-label={t('app.smartCut.takeForSection', { count: number(index + 1) })} value={segment.takeId} disabled={disabled || eligibleTakes.length < 2} onChange={(event) => setPlan((current) => swapSmartCutTake(current, segment.id, event.target.value))} className={`${inputClass} disabled:opacity-60`}>
                        {eligibleTakes.map((option) => <option key={option.id} value={option.id}>{option.name}{option.id === take?.id ? t('app.smartCut.selected') : ''}</option>)}
                      </select>
                    </label>
                    <SmartCutSegmentPreview clip={clips.find((clip) => String(clip.uid || clip.job_id) === segment.takeId)} start={segment.start} end={segment.end} />
                    <p className={`mt-2 text-[10px] font-bold uppercase tracking-wide ${plan.mode === 'transcript-silence' ? 'text-vx-accent' : 'text-vx-danger'}`}>{segment.matchStatus}</p>
                    <p className="mt-2 text-xs leading-5 text-vx-fg-muted"><span className="font-bold text-vx-fg-body">{t('app.smartCut.why')}</span> {segment.reason}</p>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="mt-3 rounded-xl border border-vx-border bg-vx-base p-3">
            <p className="text-[10px] font-bold text-vx-fg-muted">{t('app.smartCut.warnings')}</p>
            <ul className="mt-2 grid gap-1 text-xs leading-5 text-vx-fg-muted">{plan.warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={disabled} onClick={apply} className="min-h-11 rounded-full bg-vx-accent px-5 text-sm font-extrabold text-vx-accent-ink disabled:opacity-40">{t('app.smartCut.action.apply')}</button>
            <button type="button" disabled={disabled} onClick={restart} className="min-h-11 rounded-full border border-vx-border px-4 text-sm font-bold hover:border-vx-accent disabled:opacity-40">{t('app.smartCut.action.restart')}</button>
          </div>
        </div>
      )}
      {notice && <p role="status" className="mt-3 text-xs font-semibold text-vx-fg-muted">{notice}</p>}
    </section>
  );
}

function SmartCutSegmentPreview({ clip, start, end }) {
  const { t } = useI18n();
  const asset = useAssetUrl(clip?.job_id, clip?.asset_url);
  const ref = useRef(null);
  if (!clip) return null;
  return (
    <video
      ref={ref}
      src={asset.url}
      muted
      controls
      playsInline
      preload="metadata"
      aria-label={t('app.smartCut.preview', { name: clip.name || t('app.smartCut.alternateTake') })}
      className="mt-3 aspect-video w-full rounded-lg bg-black object-contain"
      onError={asset.onError}
      onLoadedMetadata={(event) => {
        asset.onLoad();
        event.currentTarget.currentTime = Math.min(start, event.currentTarget.duration || start);
      }}
      onPlay={(event) => {
        if (event.currentTarget.currentTime < start || event.currentTarget.currentTime >= end) event.currentTarget.currentTime = start;
      }}
      onTimeUpdate={(event) => {
        if (event.currentTarget.currentTime >= end) event.currentTarget.pause();
      }}
    />
  );
}
