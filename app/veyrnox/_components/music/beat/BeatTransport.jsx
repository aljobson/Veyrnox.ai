'use client';
import { useState } from 'react';
import { BEAT_LIMITS } from '../../../_lib/music/beat/beatDocument.mjs';
import * as ops from '../../../_lib/music/beat/beatOps.mjs';
import { action, button, input } from './beatStyles';

export default function BeatTransport({ doc, edit, selectPattern, playing, toggle, clear, announce }) {
  const [bpmDraft, setBpmDraft] = useState(null);
  const [cycleDrafts, setCycleDrafts] = useState({ start: null, end: null });
  const [cycleErrors, setCycleErrors] = useState({ start: '', end: '' });
  const bpm = bpmDraft ?? String(doc.tempo.bpm);
  const invalid = bpm.trim() === '' || !Number.isFinite(Number(bpm)) || Number(bpm) < 40 || Number(bpm) > 240;
  function pattern(slot) { selectPattern(slot); announce(`Pattern ${slot}`); }
  function cycle(field, value) {
    edit((d) => ops.setCycle(d, { ...d.cycle, [field]: value }), { label: 'change cycle' });
  }
  function commitCycle(field) {
    const draft = cycleDrafts[field];
    if (draft === null) return;
    const value = (Number(draft) - 1) * 3840;
    const result = draft.trim() === '' ? { refused: 'Enter a bar number.' }
      : ops.tryOp(doc, (d) => ops.setCycle(d, { ...d.cycle, [field]: value }));
    if (result.refused) {
      setCycleErrors((errors) => ({ ...errors, [field]: result.refused }));
      announce(result.refused);
      return;
    }
    cycle(field, value);
    setCycleDrafts((drafts) => ({ ...drafts, [field]: null }));
    setCycleErrors((errors) => ({ ...errors, [field]: '' }));
  }
  return <section aria-label="Transport" className="space-y-4 rounded-2xl border border-vx-border bg-vx-panel p-3">
    <div className="flex flex-wrap items-end gap-3">
      <button className={action} aria-pressed={playing} onClick={toggle}>{playing ? 'Stop' : 'Play'}</button>
      <div role="group" aria-label="Playback view" className="flex gap-1">
        {['song', 'pattern'].map((view) => <button key={view} className={doc.view === view ? action : button}
          aria-pressed={doc.view === view} onClick={() => edit((d) => ops.setView(d, view), { label: 'change view' })}>
          {view === 'song' ? 'Song' : 'Pattern'}
        </button>)}
      </div>
      <label className="flex flex-col gap-1">BPM<input className={`${input} w-24`} type="number"
        min="40" max="240" step="any" value={bpm} aria-invalid={invalid}
        aria-describedby={invalid ? 'bpm-error' : undefined} onChange={(e) => {
          const value = e.target.value; setBpmDraft(value);
          if (value.trim() && Number.isFinite(Number(value)) && Number(value) >= 40 && Number(value) <= 240) {
            edit((d) => ops.setTempo(d, Number(value)), { key: 'tempo', label: 'change tempo' });
          }
        }} onBlur={() => { if (invalid) announce('Enter a tempo from 40 to 240 BPM.'); else setBpmDraft(null); }} />
      </label>
      <label className="flex flex-col gap-1">Swing {Math.round(doc.swing * 100)}%
        <input className="min-h-11 w-36 accent-vx-accent focus-visible:outline-vx-accent" type="range"
          min="0" max="60" value={Math.round(doc.swing * 100)} onChange={(e) => edit(
            (d) => ops.setSwing(d, Number(e.target.value) / 100), { key: 'swing', label: 'change swing' })} />
      </label>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={doc.metronome}
        onChange={(e) => edit((d) => ops.setMetronome(d, e.target.checked), { label: 'toggle metronome' })} />Metronome</label>
      <label className="flex flex-col gap-1">Steps<select className={input} value={doc.steps}
        onChange={(e) => edit((d) => ops.setSteps(d, Number(e.target.value)), { label: 'change pattern length' })}>
        <option value={16}>16 · 1 bar</option><option value={32}>32 · 2 bars</option>
      </select></label>
    </div>
    {invalid && <p id="bpm-error" className="text-sm text-vx-fg">Enter a tempo from 40 to 240 BPM.</p>}
    <div className="flex flex-wrap items-center gap-3">
      <button className={button} aria-pressed={doc.cycle.on} onClick={() => cycle('on', !doc.cycle.on)}>Cycle</button>
      {['start', 'end'].map((field) => <label key={field}>
        {field === 'start' ? 'Start bar' : 'End bar'} <input className={`${input} w-24`} type="number"
          min={field === 'start' ? '1' : '1.0625'} max={field === 'start' ? '512' : '513'} step="0.0625"
          value={cycleDrafts[field] ?? String(doc.cycle[field] / 3840 + 1)}
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
        {cycleErrors[field] && <span id={`cycle-${field}-error`} className="ml-2 text-sm">{cycleErrors[field]}</span>}
      </label>)}
      <span className="text-xs text-vx-fg-muted">End is exclusive.</span>
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <div role="tablist" aria-label="Patterns" className="flex gap-1">
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
      <label className="flex flex-wrap items-center gap-2">Pattern actions
        <select className={`${input} max-w-48`} value="" onChange={(e) => {
          if (e.target.value === 'clear') clear();
          else if (e.target.value) edit((d) => ops.copyPattern(d, d.currentPattern, e.target.value),
            { label: 'copy pattern', message: `Copied pattern ${doc.currentPattern} to ${e.target.value}` });
        }}><option value="">Choose…</option>
          {BEAT_LIMITS.patterns.filter((slot) => slot !== doc.currentPattern).map((slot) =>
            <option key={slot} value={slot}>Copy {doc.currentPattern} to {slot}</option>)}
          <option value="clear">Clear pattern</option>
        </select>
      </label>
    </div>
  </section>;
}
