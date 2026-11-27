'use client';
import { BEAT_ACTIONS } from '../../../_lib/music/beat/beatActionLabels.mjs';
import { tOr } from '../../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../../components/I18nProvider';
import { automationControl } from '../../../_lib/music/beat/beatMixControls.mjs';
import { useEffect, useRef, useState } from 'react';
import { PRESETS } from '../../../../../lib/musicInstruments.js';
import { addMidiRegion } from '../../../_lib/music/beat/beatMidiOps.mjs';
import * as ops from '../../../_lib/music/beat/beatOps.mjs';
import { button, input } from './beatStyles';

const titleSpan = 'col-span-2';
export default function BeatTrackHeader({ onHeight, armedId, onArm, mode = 'song', recording = false, automationLane, onAutomation, track, edit, locator, last, selected, onSelect }) {
  const { t } = useI18n();
  const header = useRef(null);
  useEffect(() => {
    if (!onHeight || !header.current) return;
    const measure = () => onHeight(track.id, header.current.getBoundingClientRect().height);
    const observer = new ResizeObserver(measure); observer.observe(header.current); measure();
    return () => observer.disconnect();
  }, [onHeight, track.id]);
  const gain = automationControl(track, 'gain', mode, recording), pan = automationControl(track, 'pan', mode, recording);
  const [nameDraft, setNameDraft] = useState(null);
  function field(op, value, label, key) {
    edit((d) => op(d, track.id, value), { liveMix: [ops.setTrackMute, ops.setTrackSolo, ops.setTrackGain, ops.setTrackPan].includes(op), label, trackId: track.id, key: key && `${track.id}:${key}` });
  }
  function commitName() {
    if (nameDraft === null) return;
    field(ops.renameTrack, nameDraft.trim(), BEAT_ACTIONS.a53, 'name');
    setNameDraft(null);
  }
  function automationButton(extra = '') {
    return <button className={`${button} min-w-0 whitespace-normal px-2 text-xs ${extra}`} aria-expanded={!!automationLane}
      aria-label={t('app.music.beat.labels.l40', { p0: track.name, p1: track.fx?.length ? t('app.music.beat.labels.l41', { p0: track.fx.length }) : '' })}
      onClick={() => onAutomation?.(automationLane ? null : 'gain')}>{t('app.music.beat.ui.automation')}</button>;
  }
  function settings(location) {
    const automationId = `${track.id}-${location}-automated`;
    return <div className="grid min-w-0 grid-cols-2 gap-1">
      <label className="col-span-2 text-xs">{t('app.music.beat.ui.name')}<input aria-label={t('app.music.beat.labels.l42', { p0: track.name })} className={`${input} w-full`} maxLength={40}
          value={nameDraft ?? track.name} onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitName} onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitName(); }
          }} />
      </label>
      {track.kind === 'drums' && <label className="col-span-2 text-xs">{t('app.music.beat.ui.kit')}<select className={`${input} w-full`} value={track.kit}
          onChange={(e) => field(ops.setTrackKit, e.target.value, BEAT_ACTIONS.a54)}>
          {PRESETS.drums.map((kit) => <option key={kit.id} value={kit.id}>{kit.label}</option>)}
        </select>
      </label>}
      <label data-beat-live className="min-w-0 text-xs">{t('app.music.beat.ui.pan.2')}{pan.disabled ? t('app.music.beat.ui.automated') : t('app.music.beat.ui.l.r')}
        <input aria-label={t('app.music.beat.labels.l8', { p0: track.name })} disabled={pan.disabled} aria-describedby={pan.disabled ? `${automationId}-pan` : undefined} type="range" min="-100" max="100" value={track.pan * 100}
          className="min-h-11 w-full accent-vx-accent focus-visible:outline-vx-accent"
          onChange={(e) => field(ops.setTrackPan, Number(e.target.value) / 100, BEAT_ACTIONS.a56, 'pan')} />
      </label>
      {pan.disabled && <span id={`${automationId}-pan`} className="col-span-2 text-xs">{tOr(t, 'app.music.beat.control.panHelp', pan.message)}</span>}
      {track.fx?.length > 0 && <p className="col-span-2 text-xs">{t('app.music.beat.control.effects', { count: track.fx.length })}</p>}
      {automationButton(titleSpan)}
      {track.kind !== 'audio' && <button className={button} onClick={() => edit((d) => track.kind === 'midi' ? addMidiRegion(d, track.id, locator) : ops.addRegion(d, track.id, locator, d.currentPattern),
        { label: BEAT_ACTIONS.a2, trackId: track.id, start: locator })}>{t('app.music.beat.ui.add.region')}</button>}
      <button className={button} disabled={last} title={last ? t('app.music.beat.ui.keep.at.least.one.track') : undefined}
        onClick={() => { if (window.confirm(t('app.music.beat.status.s54', { p0: track.name }))) {
          edit((d) => ops.removeTrack(d, track.id), { label: BEAT_ACTIONS.a31, trackId: track.id });
        } }}>{t('app.music.beat.ui.delete.track')}</button>
    </div>;
  }
  return <div ref={header} className={`relative min-h-36 border-b border-vx-border p-1.5 ${selected ? 'bg-vx-accent/10' : 'bg-vx-panel'}`}>
    <div className="flex items-center gap-1">
      <button data-beat-read className="min-h-9 min-w-0 flex-1 truncate text-start text-xs font-bold focus-visible:outline-vx-accent"
        aria-pressed={selected} onClick={onSelect} title={track.name}>{track.name}</button>
      <button className={`${button} min-h-9 min-w-9 rounded-lg px-1 py-1 ${track.mute ? 'bg-vx-accent text-vx-accent-ink' : ''}`}
        data-beat-live aria-label={t('app.music.beat.labels.l44', { p0: track.name })}
        aria-pressed={track.mute} onClick={() => field(ops.setTrackMute, !track.mute,
          `${track.mute ? 'unmute' : 'mute'} ${track.name}`)}>{t('app.music.beat.ui.m')}</button>
      <button className={`${button} min-h-9 min-w-9 rounded-lg px-1 py-1 ${track.solo ? 'bg-vx-accent text-vx-accent-ink' : ''}`}
        data-beat-live aria-label={t('app.music.beat.labels.l45', { p0: track.name })}
        aria-pressed={track.solo} onClick={() => field(ops.setTrackSolo, !track.solo,
          `${track.solo ? 'unsolo' : 'solo'} ${track.name}`)}>{t('app.music.beat.ui.s.3')}</button>
      {track.kind === 'audio' && <button className={`${button} min-h-9 min-w-9 rounded-lg px-1 py-1 text-xs`} aria-label={t('app.music.beat.labels.l46', { p0: track.name })} aria-pressed={armedId === track.id} onClick={() => onArm(armedId === track.id ? null : track.id)}><span aria-hidden="true" className="text-vx-hue-rose">●</span></button>}
    </div>
    <label data-beat-live className="mt-1 block text-xs">{t('app.music.beat.ui.gain.2')}{gain.disabled ? t('app.music.beat.ui.automated') : t('app.music.beat.labels.l43', { p0: Math.round(track.gain * 100) })}
      <input aria-label={t('app.music.beat.labels.l7', { p0: track.name })} disabled={gain.disabled} aria-describedby={gain.disabled ? `${track.id}-gain-visible` : undefined} type="range" min="0" max="100" value={track.gain * 100}
        className="min-h-9 w-full accent-vx-accent focus-visible:outline-vx-accent" onChange={(e) => field(ops.setTrackGain, Number(e.target.value) / 100, BEAT_ACTIONS.a55, 'gain')} />
      {gain.disabled && <span id={`${track.id}-gain-visible`} className="block text-[10px]">{tOr(t, 'app.music.beat.control.gainHelp', gain.message)}</span>}
    </label>
    <details>
      <summary data-beat-read data-beat-live aria-label={t('app.music.beat.labels.l47', { p0: track.name })}
        className="relative z-10 flex min-h-9 cursor-pointer items-center gap-2 text-xs focus-visible:outline-vx-accent"><svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 6h7 M15 6h5 M4 12h3 M11 12h9 M4 18h9 M17 18h3 M11 4v4 M7 10v4 M13 16v4" /></svg>{t('app.music.beat.ui.track.settings')}</summary>
      <div className="absolute start-0 top-full z-30 w-64 rounded-xl border border-vx-border bg-vx-panel p-2 shadow-lg">
        {settings('panel')}
      </div>
    </details>
  </div>;
}
