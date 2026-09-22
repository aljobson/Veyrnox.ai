'use client';
import { useState } from 'react';
import { CHARACTER_TABS, CHARACTER_GROUPS } from '../_lib/character';

const pill = (on) => `font-vx-mono text-[11px] font-bold rounded-full px-3.5 py-1.5 border ${
  on ? 'border-vx-accent text-vx-accent bg-vx-accent/[0.07]' : 'border-vx-border text-vx-fg-muted hover:text-vx-fg'}`;

// Character builder for image models. Off by default; when on, the page
// sends buildCharacterPrompt(prompt, picks). Every group defaults to "Any".
export function CharacterPanel({ enabled, onToggle, picks, onChange }) {
  const [tab, setTab] = useState(CHARACTER_TABS[0]);
  function shuffle() {
    const next = {};
    for (const g of CHARACTER_GROUPS) next[g.id] = g.options[Math.floor(Math.random() * g.options.length)][0];
    onChange(next);
  }
  return (
    <div className="rounded-2xl border border-vx-border bg-vx-panel p-5">
      <div className="flex items-center justify-between">
        <span className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">CHARACTER</span>
        <button onClick={() => onToggle(!enabled)} aria-pressed={enabled} className={pill(enabled)}>
          {enabled ? 'ON' : 'OFF'}
        </button>
      </div>
      {enabled && (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {CHARACTER_TABS.map((t) => (
              <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t} className={pill(tab === t)}>{t}</button>
            ))}
            <span className="flex-1" />
            <button onClick={shuffle} className={pill(false)}>Shuffle</button>
            <button onClick={() => onChange({})} className={pill(false)}>Clear</button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {CHARACTER_GROUPS.filter((g) => g.tab === tab).map((g) => (
              <label key={g.id} className="flex flex-col gap-1">
                <span className="font-vx-mono text-[9.5px] tracking-[0.1em] text-vx-fg-faint uppercase">{g.label}</span>
                <select
                  value={picks[g.id] || ''}
                  onChange={(e) => {
                    const next = { ...picks };
                    if (e.target.value) next[g.id] = e.target.value; else delete next[g.id];
                    onChange(next);
                  }}
                  className="bg-vx-base border border-vx-border rounded-lg px-2 py-1.5 text-xs text-vx-fg focus:outline-none focus:border-vx-accent"
                >
                  <option value="">Any</option>
                  {g.options.map(([label]) => <option key={label} value={label}>{label}</option>)}
                </select>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
