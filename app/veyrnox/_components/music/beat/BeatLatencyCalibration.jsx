'use client';
import { beatErrorMessage, beatFailure } from '../../../_lib/music/beat/beatErrors.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

import { useEffect, useRef, useState } from 'react';
import { calibrationFrames, detectClickOnsets, matchCalibration, writeLatency } from '../../../_lib/music/beat/beatLatency.mjs';
import { capturedSamples } from '../../../_lib/music/beat/beatTakeCapture.mjs';
import { drainCapture } from '../../../_lib/music/beat/beatCapture.js';
import { button, action } from './beatStyles';
export default function BeatLatencyCalibration({ capture, close, announce }) {
  const { t } = useI18n();
  const dialog = useRef(null), cancel = useRef(() => {});
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(t('app.music.beat.status.s29'));
  useEffect(() => { dialog.current.showModal(); return () => cancel.current(); }, []);
  async function measure() {
    const context = capture.context, chunks = [], nodes = [];
    const start = context.currentTime, sr = context.sampleRate, startFrame = Math.round(start * sr), scheduled = calibrationFrames(sr, start);
    let cancelled = false, timer;
    const unsubscribe = capture.subscribe(chunk => chunks.push(chunk));
    cancel.current = () => { cancelled = true; clearTimeout(timer); unsubscribe(); for (const node of nodes) { try { node.stop(); node.disconnect(); } catch { /* Already ended. */ } } };
    setBusy(true); setMessage(t('app.music.beat.status.s30'));
    try {
      for (const frame of scheduled) {
        const oscillator = context.createOscillator(), gain = context.createGain(), at = frame / sr;
        oscillator.frequency.value = 2000; gain.gain.value = 0.5;
        oscillator.connect(gain).connect(context.destination); oscillator.start(at); oscillator.stop(at + 0.003);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); }; nodes.push(oscillator);
      }
      await new Promise(resolve => { timer = setTimeout(resolve, Math.max(0, (scheduled.at(-1) / sr + 0.5 - context.currentTime) * 1000)); });
      if (cancelled) return;
      if (!await drainCapture(capture, scheduled.at(-1) / sr, 0.4)) throw beatFailure('recovery-r3');
      const end = Math.max(startFrame, ...chunks.map(c => c.frame + c.samples.length));
      const samples = capturedSamples(chunks, startFrame, end);
      const onsets = detectClickOnsets(samples, sr, scheduled[0] - startFrame).map(o => ({ ...o, frame: o.frame + startFrame }));
      const result = matchCalibration(onsets, scheduled, sr);
      if (!result.ok) throw beatFailure('recovery-r52');
      if (!writeLatency(capture.deviceId, result.ms)) throw beatFailure('recovery-r4');
      const text = t('app.music.beat.labels.l30', { p0: result.ms.toFixed(2) }); setMessage(text); announce(text);
    } catch (e) { if (!cancelled) { setMessage(beatErrorMessage(e, 'calibrate', t)); announce(beatErrorMessage(e, 'calibrate', t)); } }
    finally { unsubscribe(); if (!cancelled) setBusy(false); }
  }
  return <dialog ref={dialog} onCancel={close} aria-labelledby="beat-calibration-title" className="m-auto w-full max-w-lg space-y-4 rounded-2xl border border-vx-border bg-vx-panel p-6 text-vx-fg backdrop:bg-vx-base/80">
    <h2 id="beat-calibration-title" className="text-xl font-bold">{t('app.music.beat.ui.calibrate.recording.latency')}</h2>
    <p role="status">{message}</p><div className="flex flex-wrap gap-2"><button className={action} disabled={busy} onClick={measure}>{t('app.music.beat.ui.measure.8.clicks')}</button><button className={button} onClick={close}>{busy ? t('app.music.beat.ui.cancel') : t('app.music.beat.close')}</button></div>
  </dialog>;
}
