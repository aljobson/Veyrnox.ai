'use client';
import { beatErrorMessage } from '../../../_lib/music/beat/beatErrors.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { assetState, subscribeAssets, loadAsset, audioPeaks, yieldAudio, retryBeatAssets } from '../../../_lib/music/beat/beatAssets';
import { button } from './beatStyles';
import { tickSeconds, modulo } from '../../../_lib/music/beat/beatAudioSegments.mjs';
export default function BeatAudioRegion({ region, asset, bpm, zoom }) {
  const { t } = useI18n();
  const canvas = useRef(null);
  const state = useSyncExternalStore(subscribeAssets, () => assetState(asset, bpm), () => assetState(asset, bpm));
  useEffect(() => {
    let live = true;
    async function draw() {
      const buffer = await loadAsset(asset, bpm, region.reverse);
      if (!buffer || !live) return;
      const peaks = await audioPeaks(buffer);
      await yieldAudio();
      if (!live || !canvas.current) return;
      const node = canvas.current, context = node.getContext('2d');
      const width = Math.max(1, Math.min(2048, Math.round(node.getBoundingClientRect().width)));
      node.width = width; node.height = 24;
      context.strokeStyle = getComputedStyle(node).color;
      const duration = tickSeconds(region.length, bpm), phase = asset.source === 'sound' ? tickSeconds(region.phaseTicks, bpm) : region.phaseSec;
      context.beginPath();
      for (let x = 0; x < width; x++) {
        const time = phase + x / width * duration;
        const peak = peaks[Math.min(peaks.length - 1, Math.floor(modulo(time, asset.durationSec) / asset.durationSec * peaks.length))];
        context.moveTo(x, 12 - peak * 12); context.lineTo(x, 12 + peak * 12);
      }
      context.stroke(); context.beginPath();
      for (let seam = asset.durationSec - phase; seam < duration; seam += asset.durationSec) {
        const x = seam / duration * width; context.moveTo(x - 2, 0); context.lineTo(x, 5); context.lineTo(x + 2, 0);
      }
      context.stroke();
    }
    void draw(); return () => { live = false; };
  }, [asset, bpm, region, zoom, state]);
  if (state.status === 'held') return <span className="block px-3" aria-label={t('app.music.beat.ui.held.for.review.this.part.can.t.be.played.or.exported')}><span aria-hidden="true">✦ </span>{t('app.music.beat.ui.held.for.review')}</span>;
  return <><span className="block truncate px-3 font-bold">{state.status === 'missing' ? t('app.music.beat.ui.missing.sound') : asset.name}</span>
    <canvas ref={canvas} aria-hidden="true" className="h-6 w-full text-vx-hue-sky" />
      {state.status !== 'ready' && <span className="block truncate px-3 text-xs" title={state.status === 'missing' ? beatErrorMessage({ displayCode: state.code, params: state.params }, 'playback', t) : undefined}>{state.status === 'missing' ? beatErrorMessage({ displayCode: state.code, params: state.params }, 'playback', t) : t('app.music.beat.ui.loading.sound')}</span>}</>;
}

// A sibling of the region button, so Retry never nests an interactive control.
export function BeatAudioRetry({ asset, bpm, reverse }) {
  const { t } = useI18n();
  const state = useSyncExternalStore(subscribeAssets, () => assetState(asset, bpm), () => assetState(asset, bpm));
  if (state.status !== 'missing' || state.permanent) return null;
  return <button className={`${button} absolute left-0 top-full z-20`} aria-label={t('app.music.beat.labels.l3', { p0: asset.name })}
    onClick={(event) => { event.stopPropagation(); retryBeatAssets(asset, bpm); void loadAsset(asset, bpm, reverse); }}>{t('app.music.beat.ui.retry')}</button>;
}
