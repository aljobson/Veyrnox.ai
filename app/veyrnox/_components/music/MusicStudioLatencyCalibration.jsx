'use client';

import { useEffect, useRef, useState } from 'react';

const CLICK_OFFSETS = Object.freeze([0.15, 0.45, 0.75]);
const DETECTION_WINDOW_MS = 250;
const PEAK_THRESHOLD = 0.08;

function audioConstraint(deviceId) {
  return deviceId ? { audio: { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } } : { audio: true };
}

export function MusicStudioLatencyCalibration() {
  const [inputs, setInputs] = useState([]); const [inputId, setInputId] = useState('');
  const [running, setRunning] = useState(false); const [result, setResult] = useState(null);
  const [message, setMessage] = useState('Microphone permission starts only after Prepare calibration input.');
  const cleanupRef = useRef(() => {});

  useEffect(() => () => cleanupRef.current(), []);

  async function prepare() {
    if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.enumerateDevices) {
      setMessage('Audio-input calibration is unavailable in this browser.'); return;
    }
    setMessage('Requesting microphone permission for calibration…');
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true }); probe.getTracks().forEach((track) => track.stop());
      const found = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput').map((device, index) => ({ id: device.deviceId, label: device.label || `Audio input ${index + 1}` }));
      setInputs(found); setInputId((current) => found.some((input) => input.id === current) ? current : (found[0]?.id || ''));
      setMessage(found.length ? 'Choose the input that will hear three brief speaker clicks.' : 'Permission granted, but no audio input is available.');
    } catch { setMessage('Microphone permission was denied. No calibration was run.'); }
  }

  async function calibrate() {
    if (running || !inputId) return;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) { setMessage('Web Audio calibration is unavailable in this browser.'); return; }
    setRunning(true); setResult(null); setMessage('Listening for three return clicks… Keep speakers audible and the room quiet.');
    let context; let stream; let input; let analyser; let frame = 0; let timeout = 0; let settled = false;
    const cleanup = async () => {
      window.cancelAnimationFrame(frame); window.clearTimeout(timeout);
      try { input?.disconnect(); analyser?.disconnect(); } catch {}
      stream?.getTracks?.().forEach((track) => track.stop());
      await context?.close?.();
    };
    cleanupRef.current = cleanup;
    try {
      stream = await navigator.mediaDevices.getUserMedia(audioConstraint(inputId));
      context = new Context(); await context.resume?.();
      input = context.createMediaStreamSource(stream); analyser = context.createAnalyser(); analyser.fftSize = 2048; input.connect(analyser);
      const startedAt = performance.now(); const scheduled = CLICK_OFFSETS.map((offset) => startedAt + offset * 1000); const detections = new Array(scheduled.length).fill(null);
      CLICK_OFFSETS.forEach((offset) => {
        const oscillator = context.createOscillator(); const gain = context.createGain(); const at = context.currentTime + offset;
        oscillator.frequency.value = 1200; gain.gain.setValueAtTime(0.0001, at); gain.gain.exponentialRampToValueAtTime(0.16, at + 0.004); gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.035);
        oscillator.connect(gain).connect(context.destination); oscillator.start(at); oscillator.stop(at + 0.04);
      });
      const samples = new Float32Array(analyser.fftSize);
      const finish = async () => {
        if (settled) return; settled = true;
        const measured = detections.filter((value) => Number.isFinite(value));
        await cleanup(); cleanupRef.current = () => {}; setRunning(false);
        if (!measured.length) { setMessage('No return click was detected. Raise speaker volume, move the microphone closer and retry.'); return; }
        const milliseconds = measured.reduce((sum, value) => sum + value, 0) / measured.length;
        setResult({ milliseconds, detected: measured.length, expected: scheduled.length });
        setMessage(`Measured ${milliseconds.toFixed(1)} ms from ${measured.length} of ${scheduled.length} return clicks.`);
      };
      const observe = () => {
        analyser.getFloatTimeDomainData(samples);
        const peak = samples.reduce((largest, value) => Math.max(largest, Math.abs(value)), 0); const now = performance.now();
        scheduled.forEach((expected, index) => {
          if (detections[index] !== null || now < expected || now > expected + DETECTION_WINDOW_MS || peak < PEAK_THRESHOLD) return;
          detections[index] = Math.max(0, now - expected);
        });
        if (detections.every((value) => value !== null)) { finish(); return; }
        frame = window.requestAnimationFrame(observe);
      };
      frame = window.requestAnimationFrame(observe);
      timeout = window.setTimeout(finish, CLICK_OFFSETS.at(-1) * 1000 + DETECTION_WINDOW_MS + 100);
    } catch {
      await cleanup(); cleanupRef.current = () => {}; setRunning(false); setMessage('Calibration could not start. No timing adjustment was applied.');
    }
  }

  return (
    <section aria-label="Studio latency calibration" className="border-t border-vx-border bg-vx-base/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Recording timing</p><h2 className="mt-1 font-vx text-xl font-black">Measure round-trip latency</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-vx-fg-muted">Three scheduled speaker clicks are measured through the selected microphone. Use speakers rather than headphones and keep the room quiet.</p></div><button type="button" onClick={prepare} disabled={running} className="min-h-11 rounded-full border border-vx-border px-4 text-sm font-bold disabled:opacity-50">Prepare calibration input</button></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"><label className="text-xs font-bold text-vx-fg-muted">Calibration audio input<select aria-label="Calibration audio input" value={inputId} onChange={(event) => setInputId(event.target.value)} disabled={!inputs.length || running} className="mt-1 min-h-11 w-full rounded-xl border border-vx-border bg-vx-panel px-3 text-vx-fg disabled:opacity-50"><option value="">No audio input</option>{inputs.map((inputItem) => <option key={inputItem.id} value={inputItem.id}>{inputItem.label}</option>)}</select></label><button type="button" onClick={calibrate} disabled={!inputId || running} className="min-h-11 rounded-full bg-vx-accent px-5 text-sm font-bold text-vx-accent-ink disabled:opacity-50">{running ? 'Measuring…' : 'Run click measurement'}</button></div>
      <p role="status" className="mt-3 text-xs text-vx-fg-muted">{message}</p>
      {result && <div className="mt-3 rounded-2xl border border-vx-accent/40 bg-vx-accent/10 p-3"><strong className="font-vx text-2xl">{result.milliseconds.toFixed(1)} ms</strong><span className="ml-2 text-xs text-vx-fg-muted">{result.detected}/{result.expected} clicks detected</span></div>}
      <p className="mt-3 text-xs leading-5 text-vx-fg-muted">Session-only diagnostic: this reports the observed acoustic input delay. It does not shift, align or persist recorded takes and cannot distinguish device buffering from speaker-to-microphone travel time.</p>
    </section>
  );
}
