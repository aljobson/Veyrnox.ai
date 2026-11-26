'use client';

import { useState } from 'react';
import { MusicCreateIcon } from './MusicCreateIcon';

export const EMPTY_MUSIC_DIRECTION = Object.freeze({ voice: '', genre: '', mood: '', tempo: '', structure: '' });

const OPTIONS = {
  voice: ['Female vocal', 'Male vocal', 'Duet', 'Choir', 'Spoken word', 'Instrumental'],
  genre: ['Pop', 'Rock', 'Hip-hop', 'R&B', 'Electronic', 'Cinematic', 'Folk', 'Jazz', 'Classical'],
  mood: ['Uplifting', 'Melancholic', 'Romantic', 'Dark', 'Dreamy', 'Energetic', 'Calm', 'Triumphant'],
  tempo: ['72 BPM · Slow', '84 BPM · Steady', '108 BPM · Driving', '128 BPM · Fast'],
  structure: ['Verse · chorus', 'Verse · pre-chorus · chorus', 'Intro · verse · chorus · bridge · outro', 'Loop / ambient progression'],
};

const LABELS = { voice: 'Voice', genre: 'Genre', mood: 'Mood', tempo: 'Tempo', structure: 'Song structure' };
const TILES = ['voice', 'genre', 'mood', 'tempo'];
const TONES = { voice: 'text-vx-danger', genre: 'text-vx-success', mood: 'text-vx-money', tempo: 'text-vx-warn' };

export function musicAdvancedDirectionText(value) {
  return Object.entries(LABELS)
    .map(([key, label]) => value?.[key] ? `${label}: ${value[key]}` : '')
    .filter(Boolean)
    .join('; ');
}

function boundedJoin(base, suffix, max, separator) {
  const clean = (base || '').trim();
  if (!Number.isFinite(max)) return [clean, suffix].filter(Boolean).join(separator);
  if (!suffix) return Array.from(clean).slice(0, max).join('');
  const suffixText = Array.from(suffix);
  if (suffixText.length >= max) return suffixText.slice(0, max).join('');
  const remaining = Math.max(0, max - suffixText.length - separator.length);
  return [Array.from(clean).slice(0, remaining).join('').trimEnd(), suffix].filter(Boolean).join(separator);
}

export function buildMusicDirection(base, value, max = Infinity) {
  const advanced = musicAdvancedDirectionText(value);
  return boundedJoin(base, advanced, max, '\n\n');
}

export function canMergeMusicStyleDirection(base, value, max = Infinity) {
  if (!Number.isFinite(max)) return true;
  const clean = (base || '').replace(/\n?\[Smart direction: [^\]]*\]\s*$/u, '').trimEnd();
  const advanced = musicAdvancedDirectionText(value);
  if (!advanced) return true;
  return Array.from(`${clean}${clean ? '\n' : ''}[Smart direction: ${advanced}]`).length <= max;
}

export function mergeMusicStyleDirection(base, value, max = Infinity) {
  const clean = (base || '').replace(/\n?\[Smart direction: [^\]]*\]\s*$/u, '').trimEnd();
  const advanced = musicAdvancedDirectionText(value);
  if (!advanced) return clean;
  if (!canMergeMusicStyleDirection(base, value, max)) return base || '';
  return `${clean}${clean ? '\n' : ''}[Smart direction: ${advanced}]`;
}

export function MusicAdvancedDirectionFields({ value, onChange, voiceLocked = false }) {
  const [openKey, setOpenKey] = useState('');
  const visibleValue = (key) => voiceLocked && key === 'voice' ? 'Instrumental' : value?.[key] || 'Auto';
  const tileValue = (key) => visibleValue(key).split(' · ')[0];

  function choose(key, nextValue) {
    onChange({ ...value, [key]: nextValue });
    setOpenKey('');
  }

  function toggle(key) {
    if (voiceLocked && key === 'voice') return;
    setOpenKey((current) => current === key ? '' : key);
  }

  return (
    <section aria-labelledby="smart-direction-title" className="rounded-2xl border border-vx-border bg-vx-panel-raised/50 p-3 sm:p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 id="smart-direction-title" className="text-sm font-black text-vx-fg">Smart direction</h3>
        <span className="text-xs text-vx-fg-faint">Optional</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3" aria-label="Smart music controls">
        {TILES.map((key) => {
          const locked = voiceLocked && key === 'voice';
          const selected = Boolean(value?.[key]) || locked;
          return (
            <button
              key={key}
              type="button"
              aria-expanded={openKey === key}
              aria-controls={`music-${key}-choices`}
              aria-label={`${LABELS[key]}: ${visibleValue(key)}`}
              disabled={locked}
              onClick={() => toggle(key)}
              className="group flex min-w-0 flex-col items-center rounded-2xl px-1 py-1 text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent disabled:cursor-default"
            >
              <span className={`grid aspect-square w-full max-w-24 place-items-center rounded-2xl border transition-[background-color,border-color,transform,box-shadow] ${selected ? 'border-current bg-vx-base shadow-[0_12px_30px_rgb(0_0_0/0.16)]' : 'border-vx-border bg-vx-base/70 group-hover:border-vx-border-boost group-hover:bg-vx-panel'} ${TONES[key]} group-active:scale-[0.98]`}>
                <MusicCreateIcon name={key} className="h-7 w-7" />
              </span>
              <span className="mt-2 text-[10px] font-black uppercase tracking-[0.12em] text-vx-fg-muted sm:text-xs">{LABELS[key]}</span>
              <span className={`mt-0.5 max-w-full text-balance text-center text-[10px] font-semibold leading-tight sm:text-xs ${selected ? 'text-vx-fg-body' : 'text-vx-fg-faint'}`}>{tileValue(key)}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        aria-expanded={openKey === 'structure'}
        aria-controls="music-structure-choices"
        onClick={() => toggle('structure')}
        className="mt-3 flex min-h-11 w-full items-center gap-3 rounded-xl border border-vx-border bg-vx-base/70 px-3 text-left text-sm transition-colors hover:border-vx-border-boost hover:bg-vx-panel focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent"
      >
        <MusicCreateIcon name="structure" className="h-4 w-4 text-vx-accent" />
        <span className="font-bold">Song structure</span>
        <span className="ml-auto truncate text-vx-fg-muted">{visibleValue('structure')}</span>
        <MusicCreateIcon name="chevron" className={`h-4 w-4 text-vx-fg-muted transition-transform ${openKey === 'structure' ? 'rotate-180' : ''}`} />
      </button>

      {openKey ? (
        <div id={`music-${openKey}-choices`} role="group" aria-label={`${LABELS[openKey]} choices`} className="mt-3 flex flex-wrap gap-2 rounded-2xl border border-vx-border bg-vx-base p-3 shadow-[0_16px_36px_rgb(0_0_0/0.16)]">
          {['', ...OPTIONS[openKey]].map((option) => {
            const label = option || 'Auto';
            const selected = (value?.[openKey] || '') === option;
            return (
              <button
                key={label}
                type="button"
                aria-pressed={selected}
                onClick={() => choose(openKey, option)}
                className={`min-h-10 rounded-full border px-4 text-sm font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent ${selected ? 'border-vx-accent bg-vx-accent text-vx-accent-ink' : 'border-vx-border bg-vx-panel text-vx-fg-body hover:border-vx-border-boost'}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
