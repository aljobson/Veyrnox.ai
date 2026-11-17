'use client';
import { BEAT_ACTIONS } from '../../../_lib/music/beat/beatActionLabels.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

import { AI_LABELS, aiText } from '../../../_lib/music/beat/beatAi.mjs';
import { useState, useSyncExternalStore } from 'react';
import { assetState, subscribeAssets } from '../../../_lib/music/beat/beatAssets.js';
import * as ops from '../../../_lib/music/beat/beatOps.mjs';
import { button, input } from './beatStyles';
function FadeField({ region, which, edit }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(null);
  const fade = region[which], incoming = which === 'fadeIn';
  const partial = fade && (incoming ? fade.startSec !== 0 : fade.endBeforeEndSec !== 0);
  const value = !fade ? 0 : (incoming ? fade.endSec : fade.startBeforeEndSec) * 1000;
  function commit() {
    if (draft === null) return;
    const seconds = Number(draft) / 1000;
    if (!draft.trim() || !Number.isFinite(seconds) || seconds < 0 || seconds > 10) return;
    edit((d) => ops.setAudioRegion(d, region.id, { [which]: seconds === 0 ? null : incoming ? { startSec: 0, endSec: seconds } : { startBeforeEndSec: seconds, endBeforeEndSec: 0 } }), { label: BEAT_ACTIONS.a21, regionId: region.id });
    setDraft(null);
  }
  return <label className="flex flex-col">{t('app.music.beat.details.d32', { direction: incoming ? t('app.music.beat.labels.l32') : t('app.music.beat.labels.l33') })}
    <input className={`${input} w-32`} type="number" min="0" max="10000" step="1" placeholder={partial ? t('app.music.beat.labels.l34') : undefined}
      value={draft ?? (partial ? '' : String(Math.round(value)))} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') setDraft(null); }} />
    {partial && <span className="text-xs">{t('app.music.beat.labels.l34')}</span>}
    {draft !== null && (!draft.trim() || !Number.isFinite(Number(draft)) || Number(draft) < 0 || Number(draft) > 10000) && <span className="text-xs text-vx-danger">{t('app.music.beat.details.d33')}</span>}
  </label>;
}
export default function BeatRegionInspector({ ai = {}, onAi, asset, trackId, region, edit }) {
  const { t } = useI18n();
  const held = useSyncExternalStore(subscribeAssets, () => !!asset && assetState(asset, 120).status === 'held', () => false);
  const controls = <div className="flex flex-wrap items-end gap-3">
    <label>{t('app.music.beat.ui.gain.2')}{region.gainDb}{t('app.music.beat.ui.db')}<input aria-label={t('app.music.beat.ui.region.gain.db')} className="block min-h-11 accent-vx-accent focus-visible:outline-vx-accent" type="range" min="-24" max="6" step="1" value={region.gainDb}
      onChange={(e) => edit((d) => ops.setAudioRegion(d, region.id, { gainDb: Number(e.target.value) }), { key: `gain:${region.id}`, label: BEAT_ACTIONS.a22 })} /></label>
    <FadeField key={`${region.id}:in:${JSON.stringify(region.fadeIn)}`} region={region} which="fadeIn" edit={edit} />
    <FadeField key={`${region.id}:out:${JSON.stringify(region.fadeOut)}`} region={region} which="fadeOut" edit={edit} />
    <button className={button} aria-pressed={region.reverse} onClick={() => edit((d) => ops.setAudioRegion(d, region.id, { reverse: !region.reverse }), { label: BEAT_ACTIONS.a23 })}>{t('app.music.beat.ui.reverse')}</button>
    {asset?.source === 'song' && Object.entries(ai).some(([op, enabled]) => op !== 'generate' && enabled) && <div role="group" aria-label={t('app.music.beat.ui.ai.actions')} className="flex flex-wrap items-center gap-3">{Object.entries(ai).filter(([op, enabled]) => op !== 'generate' && enabled).map(([op]) => <button key={op} className={button} disabled={held} title={held ? t('app.music.beat.ui.this.part.is.held.for.review') : undefined} onClick={() => onAi({ op, region, trackId, source: { songId: asset.ref.songId, versionId: asset.ref.versionId, assetId: region.assetId, asset } })}><span aria-hidden="true">✦ </span>{aiText(AI_LABELS[op], t)}</button>)}{held && Object.values(ai).some(Boolean) && <span>{t('app.music.beat.ui.this.part.is.held.for.review')}</span>}</div>}
    {/* Match-song-tempo is deferred: the Music list payload does not provide tempo. */}
  </div>;
  return <><section className="hidden rounded-xl border border-vx-border p-3 lg:block" aria-label={t('app.music.beat.ui.audio.region.inspector')}>{controls}</section>
    <details className="rounded-xl border border-vx-border p-3 lg:hidden"><summary className="flex min-h-11 cursor-pointer items-center focus-visible:outline-vx-accent">{t('app.music.beat.ui.audio.region.settings')}</summary>{controls}</details></>;
}
