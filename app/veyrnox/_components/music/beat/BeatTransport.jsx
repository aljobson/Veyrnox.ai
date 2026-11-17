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
export default function BeatTransport({ doc, edit, selectPattern, playing, loading, toggle, clear, announce }) {
  const { t } = useI18n();
  const [bpmDraft, setBpmDraft] = useState(null);
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
  return <section data-beat-transport aria-label={t('app.music.beat.ui.transport')} className="space-y-4 rounded-2xl border border-vx-border bg-vx-panel p-3">
    <div className="flex flex-wrap items-end gap-3">
      <button data-beat-live data-beat-tip="play" className={action} aria-pressed={playing || loading} onClick={toggle}>{playing || loading ? t('app.music.beat.ui.stop') : t('app.music.beat.ui.play')}</button>
      {loading && <span role="status">{t('app.music.beat.ui.loading.sounds')}</span>}
      <div role="group" aria-label={t('app.music.beat.ui.playback.view')} className="flex gap-1">
        {viewModes.map((view) => <button key={view} className={doc.view === view ? action : button}
          aria-pressed={doc.view === view} onClick={() => edit((d) => ops.setView(d, view), { label: BEAT_ACTIONS.a32 })}>
          {view === 'song' ? t('app.music.beat.ui.song') : t('app.music.beat.ui.pattern.2')}
        </button>)}
      </div>
      <label className="flex flex-col gap-1">{t('app.music.beat.ui.bpm')}<input className={`${input} w-24`} type="number"
        min="40" max="240" step="any" value={bpm} aria-invalid={invalid}
        aria-describedby={invalid ? 'bpm-error' : undefined} onChange={(e) => {
          const value = e.target.value; setBpmDraft(value);
          if (value.trim() && Number.isFinite(Number(value)) && Number(value) >= 40 && Number(value) <= 240) {
            edit((d) => ops.setTempo(d, Number(value)), { key: 'tempo', label: BEAT_ACTIONS.a33 });
          }
        }} onBlur={() => { if (invalid) announce(t('app.music.beat.ui.enter.a.tempo.from.40.to.240.bpm')); else setBpmDraft(null); }} />
        {invalid && <span id="bpm-error" className="text-sm text-vx-danger">{t('app.music.beat.ui.enter.a.tempo.from.40.to.240.bpm')}</span>}
      </label>
      <label className="flex flex-col gap-1">{t('app.music.beat.ui.swing')}{Math.round(doc.swing * 100)}%
        <input className="min-h-11 w-36 accent-vx-accent focus-visible:outline-vx-accent" type="range"
          min="0" max="60" value={Math.round(doc.swing * 100)} onChange={(e) => edit(
            (d) => ops.setSwing(d, Number(e.target.value) / 100), { key: 'swing', label: BEAT_ACTIONS.a34 })} />
      </label>
      <label className="flex min-h-11 items-center gap-2"><input className="size-5 accent-vx-accent focus-visible:outline-2 focus-visible:outline-vx-accent" type="checkbox" checked={doc.metronome}
        onChange={(e) => edit((d) => ops.setMetronome(d, e.target.checked), { label: BEAT_ACTIONS.a35 })} />{t('app.music.beat.ui.metronome')}</label>
      <label className="flex flex-col gap-1">{t('app.music.beat.ui.steps.2')}<select className={input} value={doc.steps}
        onChange={(e) => edit((d) => ops.setSteps(d, Number(e.target.value)), { label: BEAT_ACTIONS.a36 })}>
        <option value={16}>{t('app.music.beat.ui.16.1.bar')}</option><option value={32}>{t('app.music.beat.ui.32.2.bars')}</option>
      </select></label>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <button className={button} aria-pressed={doc.cycle.on} onClick={() => cycle('on', !doc.cycle.on)}>{t('app.music.beat.ui.cycle')}</button>
      {cycleFields.map((field) => <label key={field}>
        {field === 'start' ? t('app.music.beat.ui.start.bar') : t('app.music.beat.ui.end.bar')} <input className={`${input} w-24`} type="number"
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
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <div role="tablist" aria-label={t('app.music.beat.ui.patterns')} className="flex gap-1">
        {BEAT_LIMITS.patterns.map((slot, index) => <button key={slot} role="tab" id={`pattern-${slot}`}
          aria-selected={doc.currentPattern === slot} aria-controls="beat-pattern"
          tabIndex={doc.currentPattern === slot ? 0 : -1} className={doc.currentPattern === slot ? action : button}
          onClick={() => pattern(slot)} onKeyDown={(e) => {
            const direction = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
            if (!direction && !['Home', 'End'].includes(e.key)) return;
            e.preventDefault();
            const next = e.key === 'Home' ? 'A' : e.key === 'End' ? 'D' : BEAT_LIMITS.patterns[(index + direction + 4) % 4];
            pattern(next); document.getElementById(`pattern-${next}`)?.focus();
          }}>{slot}</button>)}
      </div>
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
