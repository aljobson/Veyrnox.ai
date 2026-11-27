'use client';
import { beatText } from '../../../_lib/music/beat/beatDisplay.mjs';
import { BEAT_ACTIONS } from '../../../_lib/music/beat/beatActionLabels.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

import { useState } from 'react';
import { BEAT_LIMITS } from '../../../_lib/music/beat/beatDocument.mjs';
import { formatPosition } from '../../../_lib/music/beat/beatTime.mjs';
import * as ops from '../../../_lib/music/beat/beatOps.mjs';
import { action, button, input } from './beatStyles';

const viewModes = ['song', 'pattern'];
const cycleFields = ['start', 'end'];
export default function BeatTransport({ doc, edit, selectPattern, playing, loading, toggle, clear, announce, patternPanel = false }) {
  const { t } = useI18n();
  const [bpmDraft, setBpmDraft] = useState(null);
  const [advanced, setAdvanced] = useState(false);
  const [cycleDrafts, setCycleDrafts] = useState({ start: null, end: null });
  const [cycleErrors, setCycleErrors] = useState({ start: '', end: '' });
  const bpm = bpmDraft ?? String(doc.tempo.bpm);
  const invalid = bpm.trim() === '' || !Number.isFinite(Number(bpm)) || Number(bpm) < 40 || Number(bpm) > 240;
  function pattern(slot) { selectPattern(slot); announce(t('app.music.beat.status.s44', { p0: slot })); }
  function cycle(field, value) {
    edit((d) => ops.setCycle(d, { ...d.cycle, [field]: value }), { label: BEAT_ACTIONS.a24 });
  }
  function commitCycle(field) {
    const draft = cycleDrafts[field];
    if (draft === null) return;
    const value = (Math.round(Number(draft)) - 1) * 3840;
    const result = draft.trim() === '' ? { refused: t('app.music.beat.status.s55') }
      : ops.tryOp(doc, (d) => ops.setCycle(d, { ...d.cycle, [field]: value }));
    if (result.refused) {
      setCycleErrors((errors) => ({ ...errors, [field]: beatText(result.refused, t) }));
      announce(result.refused);
      return;
    }
    cycle(field, value);
    setCycleDrafts((drafts) => ({ ...drafts, [field]: null }));
    setCycleErrors((errors) => ({ ...errors, [field]: '' }));
  }
  const compactButton = `${button} min-h-9 min-w-9 rounded-lg px-2 py-1.5`;
  return <section data-beat-transport aria-label={t('app.music.beat.ui.transport')} className="space-y-2 rounded-2xl border border-vx-border bg-vx-panel p-2">
    <div className="flex flex-wrap items-center gap-2">
      <button data-beat-read data-beat-live data-beat-tip="play" className={`${action} grid min-h-11 min-w-11 place-items-center rounded-full px-0`} aria-label={playing || loading ? t('app.music.beat.ui.stop') : t('app.music.beat.ui.play')} title={playing || loading ? t('app.music.beat.ui.stop') : t('app.music.beat.ui.play')} aria-pressed={playing || loading} onClick={toggle}>
        {playing || loading ? <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="1" /></svg> : <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>}<span className="sr-only">{playing || loading ? t('app.music.beat.ui.stop') : t('app.music.beat.ui.play')}</span>
      </button>
      {loading && <span role="status">{t('app.music.beat.ui.loading.sounds')}</span>}
      <div role="group" aria-label={t('app.music.beat.ui.playback.view')} className="flex rounded-xl border border-vx-border p-1">
        {viewModes.map((view) => <button key={view} className={`${compactButton} border-0 ${doc.view === view ? 'bg-vx-accent text-vx-accent-ink' : 'bg-transparent'}`}
          aria-pressed={doc.view === view} onClick={() => edit((d) => ops.setView(d, view), { label: BEAT_ACTIONS.a32 })}>
          {view === 'song' ? t('app.music.beat.ui.song') : t('app.music.beat.ui.pattern.2')}
        </button>)}
      </div>
      <label className="flex items-center gap-2 text-xs font-bold">{t('app.music.beat.ui.bpm')}<input className={`${input} min-h-9 w-20 py-1.5`} type="number"
        min="40" max="240" step="any" value={bpm} aria-invalid={invalid}
        aria-describedby={invalid ? 'bpm-error' : undefined} onChange={(e) => {
          const value = e.target.value; setBpmDraft(value);
          if (value.trim() && Number.isFinite(Number(value)) && Number(value) >= 40 && Number(value) <= 240) {
            edit((d) => ops.setTempo(d, Number(value)), { key: 'tempo', label: BEAT_ACTIONS.a33 });
          }
        }} onBlur={() => { if (invalid) announce(t('app.music.beat.ui.enter.a.tempo.from.40.to.240.bpm')); else setBpmDraft(null); }} />
        {invalid && <span id="bpm-error" className="text-sm text-vx-danger">{t('app.music.beat.ui.enter.a.tempo.from.40.to.240.bpm')}</span>}
      </label>
      <div role="tablist" aria-label={t('app.music.beat.ui.patterns')} className="flex gap-1">
        {BEAT_LIMITS.patterns.map((slot, index) => <button key={slot} role="tab" id={`pattern-${slot}`}
          aria-selected={doc.currentPattern === slot} aria-controls={patternPanel ? 'beat-pattern' : undefined}
          tabIndex={doc.currentPattern === slot ? 0 : -1} className={`${compactButton} ${doc.currentPattern === slot ? 'bg-vx-accent text-vx-accent-ink' : ''}`}
          onClick={() => pattern(slot)} onKeyDown={(e) => {
            const direction = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
            if (!direction && !['Home', 'End'].includes(e.key)) return;
            e.preventDefault();
            const next = e.key === 'Home' ? 'A' : e.key === 'End' ? 'D' : BEAT_LIMITS.patterns[(index + direction + 4) % 4];
            pattern(next); document.getElementById(`pattern-${next}`)?.focus();
          }}>{slot}</button>)}
      </div>
      <button data-beat-read className={`${compactButton} ms-auto grid place-items-center px-0`} aria-label={t('app.music.beat.ui.track.settings')} title={t('app.music.beat.ui.track.settings')} aria-expanded={advanced} onClick={() => setAdvanced(value => !value)}>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 6h7 M15 6h5 M4 12h3 M11 12h9 M4 18h9 M17 18h3 M11 4v4 M7 10v4 M13 16v4" /></svg>
      </button>
    </div>
    <div className={advanced ? 'flex flex-wrap items-end gap-3 border-t border-vx-border pt-2' : 'hidden'}>
      <label className="flex flex-col gap-1 text-xs">{t('app.music.beat.ui.swing')}{Math.round(doc.swing * 100)}%
        <input className="min-h-11 w-36 accent-vx-accent focus-visible:outline-vx-accent" type="range"
          min="0" max="60" value={Math.round(doc.swing * 100)} onChange={(e) => edit(
            (d) => ops.setSwing(d, Number(e.target.value) / 100), { key: 'swing', label: BEAT_ACTIONS.a34 })} />
      </label>
      <label className="flex min-h-11 items-center gap-2"><input className="size-5 accent-vx-accent focus-visible:outline-2 focus-visible:outline-vx-accent" type="checkbox" checked={doc.metronome}
        onChange={(e) => edit((d) => ops.setMetronome(d, e.target.checked), { label: BEAT_ACTIONS.a35 })} />{t('app.music.beat.ui.metronome')}</label>
      <label className="flex flex-col gap-1 text-xs">{t('app.music.beat.ui.steps.2')}<select className={`${input} min-h-9 py-1.5`} value={doc.steps}
        onChange={(e) => edit((d) => ops.setSteps(d, Number(e.target.value)), { label: BEAT_ACTIONS.a36 })}>
        <option value={16}>{t('app.music.beat.ui.16.1.bar')}</option><option value={32}>{t('app.music.beat.ui.32.2.bars')}</option>
      </select></label>
      <button className={compactButton} aria-pressed={doc.cycle.on} onClick={() => cycle('on', !doc.cycle.on)}>{t('app.music.beat.ui.cycle')}</button>
      {cycleFields.map((field) => <label key={field}>
        {field === 'start' ? t('app.music.beat.ui.start.bar') : t('app.music.beat.ui.end.bar')} <input className={`${input} min-h-9 w-20 py-1.5`} type="number"
          min={field === 'start' ? '1' : '2'} max={field === 'start' ? '512' : '513'} step="1"
          value={cycleDrafts[field] ?? String(Math.floor(doc.cycle[field] / 3840) + 1)}
          aria-invalid={Boolean(cycleErrors[field])}
          aria-describedby={cycleErrors[field] ? `cycle-${field}-error` : undefined}
          onChange={(e) => {
            const value = e.target.value;
            setCycleDrafts((drafts) => ({ ...drafts, [field]: value }));
            setCycleErrors((errors) => ({ ...errors, [field]: '' }));
          }} onBlur={() => commitCycle(field)} onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitCycle(field); }
            if (e.key === 'Escape') {
              e.preventDefault();
              setCycleDrafts((drafts) => ({ ...drafts, [field]: null }));
              setCycleErrors((errors) => ({ ...errors, [field]: '' }));
            }
          }} />
        {doc.cycle[field] % 3840 !== 0 && <span className="ms-2 text-xs">{formatPosition(doc.cycle[field], t)}</span>}
        {cycleErrors[field] && <span id={`cycle-${field}-error`} className="ms-2 text-sm text-vx-danger">{cycleErrors[field]}</span>}
      </label>)}
      <span className="text-xs text-vx-fg-muted">{t('app.music.beat.ui.end.is.exclusive')}</span>
      <label className="flex flex-wrap items-center gap-2">{t('app.music.beat.ui.pattern.actions')}<select className={`${input} max-w-48`} value="" onChange={(e) => {
          if (e.target.value === 'clear') clear();
          else if (e.target.value) edit((d) => ops.copyPattern(d, d.currentPattern, e.target.value),
            { label: BEAT_ACTIONS.a37, message: t('app.music.beat.status.s56', { p0: doc.currentPattern, p1: e.target.value }) });
        }}><option value="">{t('app.music.beat.ui.choose')}</option>
          {BEAT_LIMITS.patterns.filter((slot) => slot !== doc.currentPattern).map((slot) =>
            <option key={slot} value={slot}>{t('app.music.beat.ui.copy')}{doc.currentPattern}{t('app.music.beat.ui.to')}{slot}</option>)}
          <option value="clear">{t('app.music.beat.ui.clear.pattern')}</option>
        </select>
      </label>
    </div>
  </section>;
}
