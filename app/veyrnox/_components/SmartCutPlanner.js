'use client';

import { useRef, useState } from 'react';
import { useAssetUrl } from '../_lib/useAssetUrl';
import { buildSpeechAwareCutPlan } from '../_lib/smartCutAnalysis';
import { buildSmartCutPlan, SMART_CUT_PACING, smartCutPlanUsesAvailableTakes, smartCutPlanWithinLimits, swapSmartCutTake } from '../_lib/smartCut';

const inputClass = 'mt-1 w-full rounded-xl border border-vx-border bg-vx-base px-3 py-2.5 text-sm text-vx-fg focus:border-vx-accent focus:outline-hidden';

export function SmartCutPlanner({ clips, analyses = null, disabled = false, onApply, onUndo, startOpen = false }) {
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
  const modeLabel = plan?.mode === 'transcript-silence' ? 'SPEECH AWARE' : 'LOCAL PREVIEW';

  function createPlan() {
    if (disabled) return;
    try {
      setPlan(analysisReady
        ? buildSpeechAwareCutPlan({ clips, analyses })
        : buildSmartCutPlan({ clips, script, notes, pacing }));
      setView('cut');
      setNotice(analysisReady
        ? 'Speech-aware draft created. Review every transcript boundary before applying it.'
        : 'Local preview created. Review every section before applying it.');
    } catch (error) {
      setPlan(null);
      setNotice(error instanceof Error ? error.message : 'Smart Cut could not create a plan.');
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
      setNotice('This plan is outside the Clip Editor limits. Restart it before applying.');
      return;
    }
    if (!smartCutPlanUsesAvailableTakes(plan, clips)) {
      setNotice('The selected clips changed. Restart the plan before applying it.');
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
    setNotice('Smart Cut applied. Fine-tune the clips below, then choose captions and create the video.');
  }

  if (!open) {
    return (
      <section className="mb-4 rounded-2xl border border-vx-accent/40 bg-vx-accent/[0.06] p-4" aria-labelledby="smart-cut-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">SMART CUT · {analysisReady ? 'SPEECH READY' : 'LOCAL PREVIEW'}</p>
            <h3 id="smart-cut-heading" className="mt-1 text-base font-black">Turn selected takes into a first cut</h3>
            <p className="mt-1 max-w-xl text-xs leading-5 text-vx-fg-muted">{analysisReady ? 'Remove long pauses from timed speech, review every boundary, then continue in the Clip Editor.' : 'Add an optional script and pacing, review the suggested sections, swap takes, then continue in the Clip Editor.'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {onUndo && <button type="button" disabled={disabled} onClick={onUndo} className="min-h-10 rounded-full border border-vx-border px-4 text-xs font-extrabold hover:border-vx-accent disabled:opacity-40">Undo Smart Cut</button>}
            <button type="button" disabled={disabled || !ready} onClick={() => setOpen(true)} className="min-h-10 rounded-full bg-vx-accent px-4 text-xs font-extrabold text-vx-accent-ink disabled:cursor-not-allowed disabled:opacity-40">Plan a Smart Cut</button>
          </div>
        </div>
        {!ready && <p className="mt-2 text-xs text-vx-fg-muted">Wait for the selected clips to finish loading.</p>}
        {notice && <p role="status" className="mt-2 text-xs font-semibold text-vx-fg-muted">{notice}</p>}
      </section>
    );
  }

  return (
    <section className="mb-4 rounded-2xl border border-vx-accent/40 bg-vx-panel-raised p-4 sm:p-5" aria-labelledby="smart-cut-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">SMART CUT · {modeLabel}</p>
          <h3 id="smart-cut-heading" className="mt-1 text-lg font-black">{plan ? 'Review the first cut' : 'Shape the first cut'}</h3>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-vx-fg-muted">{analysisReady ? 'This draft uses previously completed timed speech analysis. Creating or reviewing the plan makes no new external call or credit spend.' : 'Smart Cut makes no analysis upload, external AI call or credit spend. This deterministic preview does not analyse speech or picture quality.'}</p>
        </div>
        <button type="button" disabled={disabled} onClick={discard} className="min-h-10 rounded-full border border-vx-border px-3 text-xs font-bold text-vx-fg-muted hover:border-vx-danger hover:text-vx-danger disabled:opacity-40">Discard</button>
      </div>

      {!plan ? (
        <div className="mt-4 grid gap-4">
          {analysisReady && <p className="rounded-xl border border-vx-border bg-vx-base p-3 text-xs leading-5 text-vx-fg-muted">Timed speech is ready for all selected clips. Smart Cut will keep transcript-backed sections and remove pauses of at least 0.75 seconds.</p>}
          {!analysisReady && <>
          <label className="text-[11px] font-bold text-vx-fg-muted">SCRIPT (OPTIONAL)
            <textarea disabled={disabled} value={script} onChange={(event) => setScript(event.target.value)} rows="4" placeholder="Paste the spoken script or section outline…" className={`${inputClass} resize-y disabled:opacity-50`} />
          </label>
          <label className="text-[11px] font-bold text-vx-fg-muted">EDITING NOTES (OPTIONAL)
            <textarea disabled={disabled} value={notes} onChange={(event) => setNotes(event.target.value)} rows="2" placeholder="For example: keep the opening warm; finish on the cleanest take." className={`${inputClass} resize-y disabled:opacity-50`} />
          </label>
          <fieldset>
            <legend className="text-[11px] font-bold text-vx-fg-muted">PACING</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(SMART_CUT_PACING).map(([key, option]) => (
                <button key={key} type="button" disabled={disabled} aria-pressed={pacing === key} onClick={() => setPacing(key)} className="min-h-10 rounded-full border border-vx-border px-4 text-xs font-bold text-vx-fg-body hover:border-vx-accent aria-pressed:border-vx-accent aria-pressed:bg-vx-accent aria-pressed:text-vx-accent-ink disabled:opacity-40">{option.label}</button>
              ))}
            </div>
          </fieldset>
          </>}
          {!ready && <p role="status" className="text-xs text-vx-fg-muted">Reading the selected videos before planning the cut…</p>}
          <button type="button" disabled={disabled || !ready} onClick={createPlan} className="min-h-11 justify-self-start rounded-full bg-vx-accent px-5 text-sm font-extrabold text-vx-accent-ink disabled:cursor-not-allowed disabled:opacity-40">{analysisReady ? 'Remove long pauses' : 'Create local preview'}</button>
        </div>
      ) : (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2" role="group" aria-label="Compare source and Smart Cut">
              {['raw', 'cut'].map((mode) => <button key={mode} type="button" disabled={disabled} aria-pressed={view === mode} onClick={() => setView(mode)} className="min-h-10 rounded-full border border-vx-border px-4 text-xs font-bold uppercase tracking-wide aria-pressed:border-vx-accent aria-pressed:bg-vx-accent aria-pressed:text-vx-accent-ink disabled:opacity-40">{mode}</button>)}
            </div>
            <span className="font-vx-mono text-[11px] font-bold text-vx-fg-muted vx-num">{plan.totalDuration.toFixed(1)} s · {plan.segments.length} section{plan.segments.length === 1 ? '' : 's'} · {plan.pacingLabel}{plan.mode === 'transcript-silence' ? ` · ${plan.silenceRemoved.toFixed(1)} s removed` : ''}</span>
          </div>

          {view === 'raw' ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {plan.takes.map((take) => <div key={take.id} className="rounded-xl border border-vx-border bg-vx-base p-3"><p className="truncate text-sm font-bold">{take.name}</p><p className="mt-1 font-vx-mono text-[10px] text-vx-fg-muted vx-num">{take.duration.toFixed(1)} s source</p><SmartCutSegmentPreview clip={clips.find((clip) => String(clip.uid || clip.job_id) === take.id)} start={take.rangeStart ?? 0} end={take.rangeEnd ?? take.duration} /></div>)}
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
                      <div className="min-w-0 flex-1"><p className="font-vx-mono text-[9px] font-bold text-vx-accent">SECTION {index + 1}</p><p className="mt-1 line-clamp-2 text-sm font-bold">{segment.label}</p></div>
                      <span className="font-vx-mono text-[10px] text-vx-fg-muted vx-num">{segment.start.toFixed(1)}–{segment.end.toFixed(1)} s</span>
                    </div>
                    <label className="mt-3 block text-[10px] font-bold text-vx-fg-muted">TAKE
                      <select aria-label={`Take for section ${index + 1}`} value={segment.takeId} disabled={disabled || eligibleTakes.length < 2} onChange={(event) => setPlan((current) => swapSmartCutTake(current, segment.id, event.target.value))} className={`${inputClass} disabled:opacity-60`}>
                        {eligibleTakes.map((option) => <option key={option.id} value={option.id}>{option.name}{option.id === take?.id ? ' · selected' : ''}</option>)}
                      </select>
                    </label>
                    <SmartCutSegmentPreview clip={clips.find((clip) => String(clip.uid || clip.job_id) === segment.takeId)} start={segment.start} end={segment.end} />
                    <p className={`mt-2 text-[10px] font-bold uppercase tracking-wide ${plan.mode === 'transcript-silence' ? 'text-vx-accent' : 'text-vx-danger'}`}>{segment.matchStatus}</p>
                    <p className="mt-2 text-xs leading-5 text-vx-fg-muted"><span className="font-bold text-vx-fg-body">Why this take:</span> {segment.reason}</p>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="mt-3 rounded-xl border border-vx-border bg-vx-base p-3">
            <p className="text-[10px] font-bold text-vx-fg-muted">REVIEW WARNINGS</p>
            <ul className="mt-2 grid gap-1 text-xs leading-5 text-vx-fg-muted">{plan.warnings.map((warning) => <li key={warning}>• {warning}</li>)}</ul>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={disabled} onClick={apply} className="min-h-11 rounded-full bg-vx-accent px-5 text-sm font-extrabold text-vx-accent-ink disabled:opacity-40">Apply to Clip Editor</button>
            <button type="button" disabled={disabled} onClick={restart} className="min-h-11 rounded-full border border-vx-border px-4 text-sm font-bold hover:border-vx-accent disabled:opacity-40">Restart plan</button>
          </div>
        </div>
      )}
      {notice && <p role="status" className="mt-3 text-xs font-semibold text-vx-fg-muted">{notice}</p>}
    </section>
  );
}

function SmartCutSegmentPreview({ clip, start, end }) {
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
      aria-label={`Preview ${clip.name || 'alternate take'}`}
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
