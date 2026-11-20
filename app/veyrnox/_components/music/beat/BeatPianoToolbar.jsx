'use client';
import { BEAT_ACTIONS } from '../../../_lib/music/beat/beatActionLabels.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

import { useState } from 'react';
import * as midi from '../../../_lib/music/beat/beatMidiOps.mjs';
import { clipLengthFromBars } from '../../../_lib/music/beat/beatMidiRules.mjs';
import { button, input } from './beatStyles';
export default function BeatPianoToolbar({ doc, region, clip, edit, snap, setSnap, quantise, strength, setStrength, close, playback }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(null);
  const [storedLength, setStoredLength] = useState(clip.lengthTicks);
  if (storedLength !== clip.lengthTicks) { setStoredLength(clip.lengthTicks); setDraft(null); }
  function commitLength() {
    if (draft === null) return;
    const length = clipLengthFromBars(draft);
    setDraft(null);
    if (length !== null && length !== clip.lengthTicks) edit((d) => midi.setClipLength(d, region.clipId, length), { key: `clip-length:${region.clipId}`, label: BEAT_ACTIONS.a19 });
  }
  const uses = doc.tracks.flatMap((t) => t.regions).filter((r) => r.clipId === region.clipId).length;
  return <div className="flex flex-wrap items-center gap-2 border-b border-vx-border p-2">
    <h2 className="w-full font-bold">{t('app.music.beat.ui.editing.clip.quot')}{clip.name}{t('app.music.beat.ui.quot.used.by')}{uses} {uses === 1 ? t('app.music.beat.ui.region') : t('app.music.beat.ui.regions')})</h2>
    <button data-beat-read className={button} onClick={playback.toggle}>{playback.playing ? t('app.music.beat.ui.stop') : t('app.music.beat.ui.play')}</button>
    <button className={button} onClick={() => edit((d) => midi.makeUnique(d, region.id), { label: BEAT_ACTIONS.a20 })}>{t('app.music.beat.ui.make.unique')}</button>
    <label>{t('app.music.beat.ui.snap')}<select className={input} value={snap} onChange={(e) => setSnap(Number(e.target.value))}>{[[960, '1/4'], [480, '1/8'], [240, '1/16'], [120, '1/32'], [60, '1/64'], [0, t('app.music.beat.enum.e35')]].map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
    <label>{t('app.music.beat.ui.strength')}<select className={input} value={strength} onChange={(e) => setStrength(Number(e.target.value))}><option value={1}>100 %</option><option value={0.5}>50 %</option></select></label>
    <button className={button} disabled={!snap} onClick={quantise}>{t('app.music.beat.ui.quantise')}</button>
    <label>{t('app.music.beat.ui.clip.bars')}<input className={`${input} w-20`} type="text" inputMode="decimal" value={draft ?? clip.lengthTicks / 3840} onChange={(e) => setDraft(e.target.value)} onBlur={commitLength} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitLength(); } }} /></label>
    <button data-beat-read className={`${button} md:hidden`} onClick={close}>{t('app.music.beat.ui.close.piano.roll')}</button>
    <p className="w-full text-xs" title={t('app.music.beat.ui.notes.end.at.region.ends.and.clip.loop.seams.split.trim.and.overlap.pr')}>{t('app.music.beat.ui.notes.end.at.region.boundaries.and.loop.seams.drum.sounds.decay.natura')}</p>
  </div>;
}
