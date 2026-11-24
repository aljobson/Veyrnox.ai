'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { localeTag } from '../../../lib/i18n/locales.mjs';
import { useAssetUrl } from '../_lib/useAssetUrl';
import { getStoredUserId, onSessionChange } from '../../lib/authClient';
import { buildSpeechAwareCutPlan, parseSmartCutAnalysis, SmartCutPlanError, SPEECH_CUT_LANGUAGES } from '../_lib/smartCutAnalysis';
import { smartCutFillerRanges } from '../_lib/smartCutFillers';
import { buildSmartCutPlan, SMART_CUT_PACING, smartCutPlanUsesAvailableTakes, smartCutPlanWithinLimits, swapSmartCutTake } from '../_lib/smartCut';
import { readSmartCutSetupDraft, removeSmartCutSetupDraft, smartCutSetupHasWork, writeSmartCutSetupDraft } from '../_lib/smartCutSetupDraft.mjs';
import { SmartCutFeedback } from './SmartCutFeedback';

const inputClass = 'mt-1 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-3 py-2.5 text-sm text-vx-fg focus:border-vx-accent focus:outline-hidden';
const smartCutStorage = () => { try { return window.localStorage; } catch { return null; } };
const SMART_CUT_WARNING_KEYS = Object.freeze({
  review_boundaries: 'app.smartCut.warning.reviewBoundaries',
  trim_intersects_unit: 'app.smartCut.warning.trimIntersectsUnit',
  phrase_timing: 'app.smartCut.warning.phraseTiming',
  removal_retained: 'app.smartCut.warning.removalRetained',
  segment_limit_reached: 'app.smartCut.warning.segmentLimitReached',
  output_limit_reached: 'app.smartCut.warning.outputLimitReached',
  script_not_aligned: 'app.smartCut.warning.scriptNotAligned',
  script_incomplete: 'app.smartCut.warning.scriptIncomplete',
  extra_speech_omitted: 'app.smartCut.warning.extraSpeechOmitted',
  false_start_omitted: 'app.smartCut.warning.falseStartOmitted',
  retake_omitted: 'app.smartCut.warning.retakeOmitted',
  join_review: 'app.smartCut.warning.joinReview',
  language_unknown: 'app.smartCut.warning.languageUnknown',
  language_mixed: 'app.smartCut.warning.languageMixed',
});
const SMART_CUT_ERROR_KEYS = Object.freeze({
  source_clip_limit_reached: 'app.smartCut.error.sourceClipLimit',
  unit_exceeds_budget: 'app.smartCut.error.unitExceedsBudget',
  trim_intersects_unit: 'app.smartCut.error.trimIntersectsAllUnits',
  script_match_missing: 'app.smartCut.error.scriptMatchMissing',
  alignment_budget_exceeded: 'app.smartCut.error.alignmentBudgetExceeded',
  language_override_invalid: 'app.smartCut.error.languageOverrideInvalid',
});

function segmentMatchText(t, number, segment) {
  if (segment.matchCode === 'script_line_matched') return t('app.smartCut.match.scriptLine', {
    line: number(segment.matchParameters?.line || 0),
    confidence: number(Math.round(Number(segment.matchParameters?.confidence || 0) * 100)),
  });
  if (segment.matchCode === 'transcript_section_kept') return t('app.smartCut.match.transcript');
  return segment.matchStatus;
}

function segmentReasonText(t, number, segment, take) {
  if (segment.reasonCode === 'best_take_score') return t('app.smartCut.reason.bestTake', { take: take?.name || '' });
  if (segment.reasonCode === 'manual_take') return t('app.smartCut.reason.manualTake', { take: take?.name || '' });
  if (segment.reasonCode === 'transcript_continuity') return t('app.smartCut.reason.transcript', {
    take: take?.name || '', minimumSilenceSeconds: number(segment.reasonParameters?.minimumSilenceSeconds || 0, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  });
  return segment.reason;
}

function analysisOf(analyses, assetId) {
  if (analyses instanceof Map) return analyses.get(assetId);
  if (Array.isArray(analyses)) return analyses.find((analysis) => analysis?.assetId === assetId);
  return analyses?.[assetId];
}

export function SmartCutPlanner({ clips, analyses = null, disabled = false, planningDisabled = false, applyRevision = 0, onApply, onUndo, startOpen = false }) {
  const { t, locale } = useI18n();
  const number = (value, options) => Number(value).toLocaleString(localeTag(locale), options);
  const [open, setOpen] = useState(startOpen);
  const [script, setScript] = useState('');
  const [notes, setNotes] = useState('');
  const [pacing, setPacing] = useState('balanced');
  const [languageOverride, setLanguageOverride] = useState('auto');
  const [plan, setPlan] = useState(null);
  const [feedbackTarget, setFeedbackTarget] = useState(null);
  const [view, setView] = useState('cut');
  const [notice, setNotice] = useState('');
  const [draftCandidate, setDraftCandidate] = useState(undefined);
  const draftActor = useRef('guest');
  const draftTimer = useRef();
  const suppressedDraft = useRef('');
  const lastApplyRevision = useRef(applyRevision);
  const planDisabled = disabled || planningDisabled;
  const ready = clips.length > 0 && clips.every((clip) => Number.isFinite(Number(clip.duration)) && Number(clip.duration) > 0);
  const analysisReady = ready && analyses && clips.every((clip) => {
    if (analyses instanceof Map) return analyses.has(clip.job_id);
    if (Array.isArray(analyses)) return analyses.some((analysis) => analysis?.assetId === clip.job_id);
    return Boolean(analyses[clip.job_id]);
  });
  const detectedLanguages = useMemo(() => analysisReady ? [...new Set(clips.map((clip) => {
    const parsed = parseSmartCutAnalysis(analysisOf(analyses, clip.job_id), { assetId: clip.job_id });
    return parsed.ok ? parsed.analysis.language || 'und' : 'und';
  }))] : [], [analysisReady, analyses, clips]);
  const languageName = (code) => new Intl.DisplayNames([localeTag(locale)], { type: 'language' }).of(code) || code;
  const detectedLanguageText = detectedLanguages.includes('und')
    ? t('app.smartCut.language.autoUnknown')
    : detectedLanguages.length > 1
      ? t('app.smartCut.language.autoMixed')
      : detectedLanguages.length === 1
        ? t('app.smartCut.language.autoDetected', { language: languageName(detectedLanguages[0]) })
        : t('app.smartCut.language.auto');
  const modeLabel = t(plan?.mode === 'transcript-silence' ? 'app.smartCut.mode.speechAware' : 'app.smartCut.mode.localPreview');
  const displayedWarnings = plan?.warningDetails?.length
    ? [...new Set(plan.warningDetails.map((warning) => t(
      SMART_CUT_WARNING_KEYS[warning.code] || 'app.smartCut.notice.failed',
      warning.parameters,
    )))]
    : (plan?.warnings || []);

  const [removeFillers, setRemoveFillers] = useState(false);
  const [skippedFillers, setSkippedFillers] = useState([]);
  const draftClipIdentity = useMemo(() => JSON.stringify(clips.map((clip) => [clip.job_id, clip.uid, clip.in_s ?? 0, clip.out_s ?? null])), [clips]);
  const draftSetup = useMemo(() => ({ script, notes, pacing, language: languageOverride, removeFillers, skippedFillers }),
    [languageOverride, notes, pacing, removeFillers, script, skippedFillers]);

  useEffect(() => {
    let active = true;
    const activate = (actor) => {
      clearTimeout(draftTimer.current);
      draftActor.current = actor || 'guest';
      const saved = readSmartCutSetupDraft(smartCutStorage(), draftActor.current, clips);
      if (active) setDraftCandidate(saved);
    };
    activate(getStoredUserId() || 'guest');
    const unsubscribe = onSessionChange((session) => {
      const actor = session?.user?.id || 'guest';
      if (actor === draftActor.current) return;
      suppressedDraft.current = '';
      setScript(''); setNotes(''); setPacing('balanced'); setLanguageOverride('auto');
      setRemoveFillers(false); setSkippedFillers([]); setPlan(null); setFeedbackTarget(null); setNotice('');
      activate(actor);
    });
    return () => { active = false; clearTimeout(draftTimer.current); unsubscribe(); };
  }, [draftClipIdentity]); // Re-scope recovery when the source selection or trims change.

  useEffect(() => {
    if (draftCandidate !== null) return;
    clearTimeout(draftTimer.current);
    if (suppressedDraft.current === JSON.stringify(draftSetup)) return;
    if (!smartCutSetupHasWork(draftSetup)) {
      removeSmartCutSetupDraft(smartCutStorage(), draftActor.current);
      return;
    }
    draftTimer.current = setTimeout(() => {
      try { writeSmartCutSetupDraft(smartCutStorage(), draftActor.current, clips, draftSetup); }
      catch { /* The editor remains usable when private browser storage is unavailable. */ }
    }, 500);
    return () => clearTimeout(draftTimer.current);
  }, [clips, draftCandidate, draftSetup]);

  function recoverSetupDraft() {
    if (!draftCandidate) return;
    const setup = draftCandidate.setup;
    setScript(setup.script); setNotes(setup.notes); setPacing(setup.pacing); setLanguageOverride(setup.language);
    setRemoveFillers(setup.removeFillers); setSkippedFillers(setup.skippedFillers); setPlan(null); setNotice('');
    suppressedDraft.current = '';
    setDraftCandidate(null);
  }

  function discardSetupDraft() {
    clearTimeout(draftTimer.current);
    suppressedDraft.current = JSON.stringify(draftSetup);
    removeSmartCutSetupDraft(smartCutStorage(), draftActor.current);
    setDraftCandidate(null);
  }

  function clearSetupDraft() {
    clearTimeout(draftTimer.current);
    suppressedDraft.current = JSON.stringify(draftSetup);
    removeSmartCutSetupDraft(smartCutStorage(), draftActor.current);
    setDraftCandidate(null);
  }
  // Review-only: nothing is removed unless the person ticks the box, and each suggestion can be unticked.
  const fillerRows = useMemo(() => {
    if (!analysisReady) return [];
    return clips.flatMap((clip) => {
      const parsed = parseSmartCutAnalysis(analysisOf(analyses, clip.job_id), { assetId: clip.job_id });
      if (!parsed.ok) return [];
      const takeId = String(clip.uid || clip.job_id);
      const low = Math.max(0, Number(clip.in_s) || 0);
      const high = Number.isFinite(Number(clip.out_s)) ? Number(clip.out_s) : Number(clip.duration);
      const effectiveAnalysis = languageOverride === 'auto' ? parsed.analysis : { ...parsed.analysis, language: languageOverride };
      return smartCutFillerRanges(effectiveAnalysis, { start: low, end: high })
        .map((range) => ({ ...range, takeId, key: `${takeId}:${range.start}` }));
    });
  }, [analysisReady, analyses, clips, languageOverride]);

  function changeLanguage(value) {
    setLanguageOverride(value);
    setPlan(null);
    setFeedbackTarget(null);
    setSkippedFillers([]);
    setNotice('');
  }

  function toggleFiller(key) {
    setSkippedFillers((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  }

  function createPlan() {
    if (planDisabled) return;
    try {
      const nextPlan = analysisReady
        ? buildSpeechAwareCutPlan({
          clips,
          analyses,
          script,
          notes,
          languageOverride: languageOverride === 'auto' ? '' : languageOverride,
          silencePreset: pacing,
          removals: removeFillers ? fillerRows.filter((row) => !skippedFillers.includes(row.key)).map(({ takeId, start, end }) => ({ takeId, start, end })) : [],
        })
        : buildSmartCutPlan({ clips, script, notes, pacing });
      setPlan(nextPlan);
      setFeedbackTarget({ responseId: crypto.randomUUID(), planMode: nextPlan.mode });
      setView('cut');
      setNotice(t(analysisReady ? 'app.smartCut.notice.speechCreated' : 'app.smartCut.notice.localCreated'));
    } catch (error) {
      setPlan(null);
      setFeedbackTarget(null);
      setNotice(error instanceof SmartCutPlanError
        ? t(SMART_CUT_ERROR_KEYS[error.code] || 'app.smartCut.notice.failed', error.parameters)
        : error instanceof Error ? error.message : t('app.smartCut.notice.failed'));
    }
  }

  function restart() {
    if (disabled) return;
    setPlan(null);
    setFeedbackTarget(null);
    setNotice('');
  }

  function discard() {
    if (disabled) return;
    clearSetupDraft();
    setPlan(null);
    setFeedbackTarget(null);
    setOpen(false);
    setNotice('');
  }

  function finishApply() {
    clearSetupDraft();
    setPlan(null);
    setFeedbackTarget(null);
    setOpen(false);
    setNotice(t('app.smartCut.notice.applied'));
  }

  useEffect(() => {
    if (lastApplyRevision.current === applyRevision) return;
    lastApplyRevision.current = applyRevision;
    clearSetupDraft();
    setPlan(null);
    setFeedbackTarget(null);
    setOpen(false);
    setNotice(t('app.smartCut.notice.applied'));
  }, [applyRevision, t]);

  function apply() {
    if (planDisabled) return;
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
    if (onApply(nextClips) === false) {
      setNotice(t('app.smartCut.notice.confirmReplace'));
      return;
    }
    finishApply();
  }

  if (!open) {
    return (
      <section className="mb-4 rounded-2xl border border-vx-accent/40 bg-vx-accent/[0.06] p-4" aria-labelledby="smart-cut-heading">
      {draftCandidate && <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-vx-accent bg-vx-panel px-4 py-3 text-sm">
        <p className="min-w-0 flex-1 font-bold">{t('app.editor.workspace.recoverQuestion')}</p>
        <button type="button" onClick={recoverSetupDraft} className="min-h-11 rounded-full bg-vx-accent px-4 text-xs font-extrabold text-vx-accent-ink">{t('app.editor.workspace.recover')}</button>
        <button type="button" onClick={discardSetupDraft} className="min-h-11 rounded-full border border-vx-border px-4 text-xs font-extrabold">{t('app.publish.drafts.discard')}</button>
      </div>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">{t('app.smartCut.name')} · {t(analysisReady ? 'app.smartCut.mode.speechReady' : 'app.smartCut.mode.localPreview')}</p>
            <h3 id="smart-cut-heading" className="mt-1 text-base font-black">{t('app.smartCut.summary.title')}</h3>
            <p className="mt-1 max-w-xl text-xs leading-5 text-vx-fg-muted">{t(analysisReady ? 'app.smartCut.summary.speech' : 'app.smartCut.summary.local')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {onUndo && <button type="button" disabled={disabled} onClick={onUndo} className="min-h-11 rounded-full border border-vx-border px-4 text-xs font-extrabold hover:border-vx-accent disabled:opacity-40">{t('app.smartCut.action.undo')}</button>}
            <button type="button" disabled={planDisabled || !ready} onClick={() => setOpen(true)} className="min-h-11 rounded-full bg-vx-accent px-4 text-xs font-extrabold text-vx-accent-ink disabled:cursor-not-allowed disabled:opacity-40">{t('app.smartCut.action.plan')}</button>
          </div>
        </div>
        {!ready && <p className="mt-2 text-xs text-vx-fg-muted">{t('app.smartCut.wait')}</p>}
        {notice && <p role="status" className="mt-2 text-xs font-semibold text-vx-fg-muted">{notice}</p>}
      </section>
    );
  }

  return (
    <section className="mb-4 rounded-2xl border border-vx-accent/40 bg-vx-panel-raised p-4 sm:p-5" aria-labelledby="smart-cut-heading">
      {draftCandidate && <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-vx-accent bg-vx-panel px-4 py-3 text-sm">
        <p className="min-w-0 flex-1 font-bold">{t('app.editor.workspace.recoverQuestion')}</p>
        <button type="button" onClick={recoverSetupDraft} className="min-h-11 rounded-full bg-vx-accent px-4 text-xs font-extrabold text-vx-accent-ink">{t('app.editor.workspace.recover')}</button>
        <button type="button" onClick={discardSetupDraft} className="min-h-11 rounded-full border border-vx-border px-4 text-xs font-extrabold">{t('app.publish.drafts.discard')}</button>
      </div>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">{t('app.smartCut.name')} · {modeLabel}</p>
          <h3 id="smart-cut-heading" className="mt-1 text-lg font-black">{t(plan ? 'app.smartCut.review.title' : 'app.smartCut.shape.title')}</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-vx-fg-muted">{t(analysisReady ? 'app.smartCut.explainer.speech' : 'app.smartCut.explainer.local')}</p>
        </div>
        <button type="button" disabled={disabled} onClick={discard} className="min-h-11 rounded-full border border-vx-border px-3 text-xs font-bold text-vx-fg-muted hover:border-vx-danger hover:text-vx-danger disabled:opacity-40">{t('app.smartCut.action.discard')}</button>
      </div>

      {!plan ? (
        <div className="mt-4 grid gap-4">
          {analysisReady && <p className="rounded-xl border border-vx-border bg-vx-base p-3 text-xs leading-5 text-vx-fg-muted">{t('app.smartCut.speechReady')}</p>}
          {analysisReady && <label className="text-[11px] font-bold text-vx-fg-muted">{t('app.smartCut.language.label')}
            <select aria-label={t('app.smartCut.language.label')} disabled={disabled} value={languageOverride} onChange={(event) => changeLanguage(event.target.value)} className={`${inputClass} disabled:opacity-50`}>
              <option value="auto">{detectedLanguageText}</option>
              {SPEECH_CUT_LANGUAGES.map((code) => <option key={code} value={code}>{languageName(code)}</option>)}
            </select>
            <span className="mt-1 block font-normal leading-5">{t('app.smartCut.language.help')}</span>
          </label>}
          {analysisReady && (
            <fieldset>
              <legend className="text-[11px] font-bold text-vx-fg-muted">{t('app.smartCut.fillers.title')}</legend>
              {fillerRows.length ? (
                <>
                  <label className="mt-2 flex min-h-11 items-center gap-3 text-sm font-bold">
                    <input type="checkbox" checked={removeFillers} disabled={disabled} onChange={(event) => setRemoveFillers(event.target.checked)} className="size-5 accent-vx-accent" />
                    {t('app.smartCut.fillers.toggle', { count: number(fillerRows.length) })}
                  </label>
                  {removeFillers && (
                    <ul className="mt-1 grid gap-1">
                      {fillerRows.map((row) => (
                        <li key={row.key}>
                          <label className="flex min-h-11 items-center gap-3 text-xs">
                            <input type="checkbox" checked={!skippedFillers.includes(row.key)} disabled={disabled} onChange={() => toggleFiller(row.key)} className="size-5 accent-vx-accent" />
                            <span className="font-bold text-vx-fg-body">{row.label}</span>
                            <span className="font-vx-mono text-[10px] text-vx-fg-muted vx-num">{t('app.smartCut.range', { start: number(row.start, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), end: number(row.end, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="mt-2 text-xs leading-5 text-vx-fg-muted">{t('app.smartCut.fillers.none')}</p>
              )}
            </fieldset>
          )}
          <label className="text-[11px] font-bold text-vx-fg-muted">{t('app.smartCut.script')}
            <textarea disabled={disabled} value={script} onChange={(event) => setScript(event.target.value)} rows="4" placeholder={t('app.smartCut.scriptPlaceholder')} className={`${inputClass} resize-y disabled:opacity-50`} />
          </label>
          {!analysisReady && <label className="text-[11px] font-bold text-vx-fg-muted">{t('app.smartCut.notes')}
            <textarea disabled={disabled} value={notes} onChange={(event) => setNotes(event.target.value)} rows="2" placeholder={t('app.smartCut.notesPlaceholder')} className={`${inputClass} resize-y disabled:opacity-50`} />
          </label>}
          <fieldset>
            <legend className="text-[11px] font-bold text-vx-fg-muted">{t('app.smartCut.pacing')}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(SMART_CUT_PACING).map(([key, option]) => (
                <button key={key} type="button" disabled={disabled} aria-pressed={pacing === key} onClick={() => setPacing(key)} className="min-h-11 rounded-full border border-vx-border px-4 text-xs font-bold text-vx-fg-body hover:border-vx-accent aria-pressed:border-vx-accent aria-pressed:bg-vx-accent aria-pressed:text-vx-accent-ink disabled:opacity-40">{t(option.labelKey)}</button>
              ))}
            </div>
          </fieldset>
          {!ready && <p role="status" className="text-xs text-vx-fg-muted">{t('app.smartCut.reading')}</p>}
          <button type="button" disabled={planDisabled || !ready} onClick={createPlan} className="min-h-11 justify-self-start rounded-full bg-vx-accent px-5 text-sm font-extrabold text-vx-accent-ink disabled:cursor-not-allowed disabled:opacity-40">{t(analysisReady ? 'app.smartCut.action.removePauses' : 'app.smartCut.action.createPreview')}</button>
        </div>
      ) : (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2" role="group" aria-label={t('app.smartCut.compare')}>
              {Object.keys({ raw: true, cut: true }).map((mode) => <button key={mode} type="button" disabled={disabled} aria-pressed={view === mode} onClick={() => setView(mode)} className="min-h-11 rounded-full border border-vx-border px-4 text-xs font-bold uppercase tracking-wide aria-pressed:border-vx-accent aria-pressed:bg-vx-accent aria-pressed:text-vx-accent-ink disabled:opacity-40">{t(`app.smartCut.view.${mode}`)}</button>)}
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
                  ? plan.takes.filter((item) => item.id === segment.takeId || segment.alternates?.includes(item.id))
                  : plan.takes;
                return (
                  <li key={segment.id} className="rounded-xl border border-vx-border bg-vx-base p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1"><p className="font-vx-mono text-[9px] font-bold text-vx-accent">{t('app.smartCut.section', { count: number(index + 1) })}</p><p className="mt-1 line-clamp-2 text-sm font-bold">{segment.label}</p></div>
                      <span className="font-vx-mono text-[10px] text-vx-fg-muted vx-num">{t('app.smartCut.range', { start: number(segment.start, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), end: number(segment.end, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</span>
                    </div>
                    <div className="mt-3 block text-[10px] font-bold text-vx-fg-muted">{t('app.smartCut.take')}
                      {eligibleTakes.length < 2
                        ? <p className="mt-1 text-sm font-bold text-vx-fg">{take?.name}</p>
                        : <select aria-label={t('app.smartCut.takeForSection', { count: number(index + 1) })} value={segment.takeId} disabled={disabled} onChange={(event) => setPlan((current) => swapSmartCutTake(current, segment.id, event.target.value))} className={`${inputClass} disabled:opacity-60`}>
                          {eligibleTakes.map((option) => <option key={option.id} value={option.id}>{option.name}{option.id === take?.id ? t('app.smartCut.selected') : ''}</option>)}
                        </select>}
                    </div>
                    <SmartCutSegmentPreview clip={clips.find((clip) => String(clip.uid || clip.job_id) === segment.takeId)} start={segment.start} end={segment.end} />
                    <p className={`mt-2 text-[10px] font-bold uppercase tracking-wide ${plan.mode === 'transcript-silence' ? 'text-vx-accent' : 'text-vx-danger'}`}>{segmentMatchText(t, number, segment)}</p>
                    <p className="mt-2 text-xs leading-5 text-vx-fg-muted"><span className="font-bold text-vx-fg-body">{t('app.smartCut.why')}</span> {segmentReasonText(t, number, segment, take)}</p>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="mt-3 rounded-xl border border-vx-border bg-vx-base p-3">
            <p className="text-[10px] font-bold text-vx-fg-muted">{t('app.smartCut.warnings')}</p>
            <ul className="mt-2 grid gap-1 text-xs leading-5 text-vx-fg-muted">{displayedWarnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul>
          </div>

          {feedbackTarget && <SmartCutFeedback key={feedbackTarget.responseId} responseId={feedbackTarget.responseId} planMode={feedbackTarget.planMode} />}

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={planDisabled} onClick={apply} className="min-h-11 rounded-full bg-vx-accent px-5 text-sm font-extrabold text-vx-accent-ink disabled:opacity-40">{t('app.smartCut.action.apply')}</button>
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
