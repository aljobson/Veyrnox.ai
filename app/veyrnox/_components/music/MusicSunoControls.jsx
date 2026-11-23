'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../../components/I18nProvider';
import { appendSunoStyle, capSunoText, sunoDuration, sunoLimit } from './musicSunoForm';

const STYLE_KEYS = ['cinematic', 'electronic', 'indie', 'jazz', 'pop', 'rock'];

function Counter({ id, value, max }) {
  const count = Array.from(value).length;
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setAnnouncement(count >= Math.ceil(max * 0.9) ? `${count}/${max}` : ''), 400);
    return () => window.clearTimeout(timer);
  }, [count, max]);
  return <><span id={id} className="font-vx-mono text-xs font-normal text-vx-fg-faint">{count}/{max}</span><span aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</span></>;
}

function StylePicker({ label, value, onChange, max, counter, note }) {
  const { t } = useI18n();
  const details = useRef(null);
  const [open, setOpen] = useState(false);
  const close = (restoreFocus = false) => {
    if (details.current) details.current.open = false;
    setOpen(false);
    if (restoreFocus) details.current?.querySelector('summary')?.focus();
  };
  useEffect(() => {
    if (!open) return undefined;
    const pointer = (event) => { if (!details.current?.contains(event.target)) close(); };
    const key = (event) => { if (event.key === 'Escape') { event.preventDefault(); close(true); } };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm font-bold text-vx-fg-body">
        <span>{label}</span><Counter id={`${counter}-count`} value={value} max={max} />
      </div>
      <textarea value={value} onChange={(event) => onChange(capSunoText(event.target.value, max))} rows={2} aria-label={label}
        aria-describedby={`${counter}-count${note ? ` ${counter}-note` : ''}`}
        className="mt-2 w-full resize-y rounded-xl border border-vx-border-boost bg-vx-base px-4 py-3 text-vx-fg placeholder:text-vx-fg-faint focus:border-vx-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-vx-accent" />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <details ref={details} onToggle={(event) => setOpen(event.currentTarget.open)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }} className="relative">
          <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-full border border-vx-border px-4 text-xs font-bold hover:border-vx-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vx-accent">{t('app.music.suno.selectStyles')}</summary>
          <div className="absolute start-0 z-20 mt-2 flex w-64 flex-wrap gap-2 rounded-2xl border border-vx-border bg-vx-panel p-3">
            {STYLE_KEYS.map((key) => {
              const style = t(`app.music.suno.style.${key}`);
              return <button key={key} type="button" onClick={() => { onChange(appendSunoStyle(value, style, max)); close(true); }} className="min-h-11 rounded-full border border-vx-border px-3 text-xs font-bold hover:border-vx-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vx-accent">{style}</button>;
            })}
          </div>
        </details>
        <button type="button" onClick={() => onChange('')} disabled={!value} className="min-h-11 rounded-full border border-vx-border px-4 text-xs font-bold disabled:opacity-40">{t('app.music.suno.clear')}</button>
      </div>
      {note ? <p id={`${counter}-note`} className="mt-2 text-xs text-vx-fg-muted">{note}</p> : null}
    </div>
  );
}

function Slider({ id, label, value, onChange, bounds }) {
  const { locale } = useI18n();
  const min = Number(bounds?.min);
  const max = Number(bounds?.max);
  // Locale-aware decimal mark (German reads 0,50): the number is display text only, the wire value is unchanged.
  const display = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
  return (
    <label className="block text-sm font-bold text-vx-fg-body">
      <span className="flex items-center justify-between gap-3"><span>{label}</span><output htmlFor={id} className="font-vx-mono text-xs text-vx-accent">{display}</output></span>
      <input id={id} type="range" min={min} max={max} step={(max - min) / 20} value={value} onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label} aria-valuetext={`${label}: ${display}`} className="mt-3 min-h-11 w-full accent-vx-accent" />
    </label>
  );
}

export function MusicSunoControls({ model, draft, updateDraft, controls, updateControl, compact = false, showTextFields = true, showRights = true }) {
  const { t } = useI18n();
  const titleMax = sunoLimit(model, 'title');
  const lyricsMax = sunoLimit(model, 'lyrics');
  const stylesMax = sunoLimit(model, 'styles');
  const excludeMax = sunoLimit(model, 'exclude_styles');
  const excludeApplied = model?.counters?.exclude_styles?.applied;
  const duration = sunoDuration(model, controls.durationSeconds);
  const variety = Array.isArray(model?.controls?.variety) ? model.controls.variety : [];

  return (
    <div className={compact ? 'space-y-3' : 'space-y-5'}>
      {showTextFields ? <>
        <label className="block text-sm font-bold text-vx-fg-body">
          <span className="flex items-center justify-between gap-3"><span>{t('app.music.suno.title')}</span><Counter id="suno-title-count" value={draft.title} max={titleMax} /></span>
          <input value={draft.title} onChange={(event) => updateDraft('title', capSunoText(event.target.value, titleMax))} aria-describedby="suno-title-count" className="mt-2 min-h-12 w-full rounded-xl border border-vx-border-boost bg-vx-base px-4 text-vx-fg focus:border-vx-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-vx-accent" />
        </label>
        {!controls.instrumental ? <label className="block text-sm font-bold text-vx-fg-body">
          <span className="flex items-center justify-between gap-3"><span>{t('app.music.suno.lyrics')}</span><Counter id="suno-lyrics-count" value={draft.lyrics} max={lyricsMax} /></span>
          <textarea value={draft.lyrics} onChange={(event) => updateDraft('lyrics', capSunoText(event.target.value, lyricsMax))} aria-describedby="suno-lyrics-count" rows={compact ? 4 : 9} className="mt-2 w-full resize-y rounded-2xl border border-vx-border-boost bg-vx-base px-4 py-3 font-vx-mono text-sm leading-6 text-vx-fg focus:border-vx-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-vx-accent" />
        </label> : null}
      </> : null}

      {/* In the chat composer the Style text lives in the composer's own box (same draft.styles): showing it twice confused editing. */}
      {showTextFields ? <StylePicker label={t('app.music.suno.style')} value={draft.styles} onChange={(value) => updateDraft('styles', value)} max={stylesMax} counter="suno-style" /> : null}
      <StylePicker label={t('app.music.suno.exclude')} value={controls.excludeStyles} onChange={(value) => updateControl('excludeStyles', value)} max={excludeMax} counter="suno-exclude"
        note={t('app.music.suno.excludeNote', { count: excludeApplied })} />

      <label className="block text-sm font-bold text-vx-fg-body">{t('app.music.suno.model')}
        <select value={controls.sunoModel} onChange={(event) => updateControl('sunoModel', event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-vx-border-boost bg-vx-base px-4 text-vx-fg focus-visible:ring-2 focus-visible:ring-vx-accent">
          {(model?.controls?.suno_model || []).map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>

      {!controls.instrumental ? <fieldset>
        <legend className="text-sm font-bold text-vx-fg-body">{t('app.music.suno.vocalGender')}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(model?.controls?.vocal_gender || []).map((value) => <label key={value} className="flex min-h-11 items-center gap-2 rounded-full border border-vx-border px-4 text-sm">
            <input type="radio" name="suno-vocal-gender" value={value} checked={controls.vocalGender === value} onChange={() => updateControl('vocalGender', value)} className="accent-vx-accent" />
            {t(`app.music.suno.gender.${value}`)}
          </label>)}
        </div>
      </fieldset> : null}

      <Slider id="suno-style-weight" label={t('app.music.suno.styleWeight')} value={controls.styleWeight} onChange={(value) => updateControl('styleWeight', value)} bounds={model?.limits?.style_weight} />
      <Slider id="suno-weirdness" label={t('app.music.suno.weirdness')} value={controls.weirdness} onChange={(value) => updateControl('weirdness', value)} bounds={model?.limits?.weirdness} />

      {model?.controls?.duration_seconds ? <label className="block text-sm font-bold text-vx-fg-body">
        <span className="flex items-center justify-between gap-3"><span>{t('app.music.suno.duration')}</span><output htmlFor="suno-duration" className="font-vx-mono text-xs text-vx-accent">{duration} {t('app.music.suno.seconds')}</output></span>
        <input id="suno-duration" aria-label={t('app.music.suno.duration')} type="range" min={model.controls.duration_seconds.min} max={model.controls.duration_seconds.max} step="1" value={duration} onChange={(event) => updateControl('durationSeconds', Number(event.target.value))} aria-valuetext={`${duration} ${t('app.music.suno.seconds')}`} className="mt-3 min-h-11 w-full accent-vx-accent" />
      </label> : null}

      <fieldset>
        <legend className="text-sm font-bold text-vx-fg-body">{t('app.music.suno.variety')}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {variety.map((label, index) => <label key={label} className="flex min-h-11 items-center gap-2 rounded-full border border-vx-border px-3 text-xs font-bold">
            <input type="radio" name="suno-variety" value={index} checked={controls.variety === index} onChange={() => updateControl('variety', index)} className="accent-vx-accent" />
            {t(`app.music.suno.variety.${index}`)}
          </label>)}
        </div>
      </fieldset>

      {showRights && !controls.instrumental ? <label className="flex min-h-11 items-start gap-3 text-sm text-vx-fg-body">
        <input type="checkbox" checked={controls.rightsConfirmed} onChange={(event) => updateControl('rightsConfirmed', event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-vx-accent" />
        <span>{t('app.music.suno.rights')}</span>
      </label> : null}
    </div>
  );
}
