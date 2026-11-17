'use client';
import { useEffect, useRef, useState } from 'react';
import { calibrationFrames, detectClickOnsets, matchCalibration, writeLatency } from '../../../_lib/music/beat/beatLatency.mjs';
import { capturedSamples } from '../../../_lib/music/beat/beatTakeCapture.mjs';
import { drainCapture } from '../../../_lib/music/beat/beatCapture.js';
import { button, action } from './beatStyles';
export default function BeatLatencyCalibration({ capture, close, announce }) {
  const dialog = useRef(null), cancel = useRef(() => {});
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('Play the clicks through speakers near the microphone, or connect a hardware loopback. Keep the room quiet.');
  useEffect(() => { dialog.current.showModal(); return () => cancel.current(); }, []);
  async function measure() {
    const context = capture.context, chunks = [], nodes = [];
    const start = context.currentTime, sr = context.sampleRate, startFrame = Math.round(start * sr), scheduled = calibrationFrames(sr, start);
    let cancelled = false, timer;
    const unsubscribe = capture.subscribe(chunk => chunks.push(chunk));
    cancel.current = () => { cancelled = true; clearTimeout(timer); unsubscribe(); for (const node of nodes) { try { node.stop(); node.disconnect(); } catch { /* Already ended. */ } } };
    setBusy(true); setMessage('Listening for 8 clicks…');
    try {
      for (const frame of scheduled) {
        const oscillator = context.createOscillator(), gain = context.createGain(), at = frame / sr;
        oscillator.frequency.value = 2000; gain.gain.value = 0.5;
        oscillator.connect(gain).connect(context.destination); oscillator.start(at); oscillator.stop(at + 0.003);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); }; nodes.push(oscillator);
      }
      await new Promise(resolve => { timer = setTimeout(resolve, Math.max(0, (scheduled.at(-1) / sr + 0.5 - context.currentTime) * 1000)); });
      if (cancelled) return;
      if (!await drainCapture(capture, scheduled.at(-1) / sr, 0.4)) throw new Error('Calibration interrupted — keep this page open and try again.');
      const end = Math.max(startFrame, ...chunks.map(c => c.frame + c.samples.length));
      const samples = capturedSamples(chunks, startFrame, end);
      const onsets = detectClickOnsets(samples, sr, scheduled[0] - startFrame).map(o => ({ ...o, frame: o.frame + startFrame }));
      const result = matchCalibration(onsets, scheduled, sr);
      if (!result.ok) throw new Error(result.error);
      if (!writeLatency(capture.deviceId, result.ms)) throw new Error('Could not save calibration on this device. Allow local storage and try again.');
      const text = `Calibrated: ${result.ms.toFixed(2)} ms round trip`; setMessage(text); announce(text);
    } catch (e) { if (!cancelled) { setMessage(e.message); announce(e.message); } }
    finally { unsubscribe(); if (!cancelled) setBusy(false); }
  }
  return <dialog ref={dialog} onCancel={close} aria-labelledby="beat-calibration-title" className="m-auto w-full max-w-lg space-y-4 rounded-2xl border border-vx-border bg-vx-panel p-6 text-vx-fg backdrop:bg-vx-base/80">
    <h2 id="beat-calibration-title" className="text-xl font-bold">Calibrate recording latency</h2>
    <p role="status">{message}</p><div className="flex flex-wrap gap-2"><button className={action} disabled={busy} onClick={measure}>Measure 8 clicks</button><button className={button} onClick={close}>{busy ? 'Cancel' : 'Close'}</button></div>
  </dialog>;
}
