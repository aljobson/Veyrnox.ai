'use client';

import { useEffect, useRef, useState } from 'react';
import { encodeAudioBufferAsWav } from '../../_lib/performanceStudio';

const LIMIT_SECONDS = 60;
const MAX_SESSION_TAKES = 5;

function takeClock(value) {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function inputConstraint(deviceId) {
  return deviceId ? { audio: { deviceId: { exact: deviceId } } } : { audio: true };
}

export function MusicStudioRecorder({ tempo, signature, sourceAudioRef }) {
  const [inputs, setInputs] = useState([]);
  const [inputId, setInputId] = useState('');
  const [leadMode, setLeadMode] = useState('none');
  const [leadBars, setLeadBars] = useState(1);
  const [state, setState] = useState('idle');
  const [message, setMessage] = useState('Microphone access starts only after you choose Prepare input.');
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [leadBeats, setLeadBeats] = useState(0);
  const [takes, setTakes] = useState([]);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const recordTimerRef = useRef(null);
  const limitTimerRef = useRef(null);
  const leadTimerRef = useRef(null);
  const clickContextRef = useRef(null);
  const startPositionRef = useRef(0);
  const takeUrlsRef = useRef([]);

  function clearTimers() {
    window.clearInterval(recordTimerRef.current);
    window.clearTimeout(limitTimerRef.current);
    window.clearInterval(leadTimerRef.current);
    recordTimerRef.current = null;
    limitTimerRef.current = null;
    leadTimerRef.current = null;
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  useEffect(() => () => {
    clearTimers();
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.ondataavailable = null;
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    stopStream();
    clickContextRef.current?.close?.();
    takeUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  async function prepareInput() {
    setMessage('Requesting microphone permission…');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setState('error');
      setMessage('This browser cannot record audio in Studio. The song and existing versions are unchanged.');
      return;
    }
    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      permissionStream.getTracks().forEach((track) => track.stop());
      const devices = typeof navigator.mediaDevices.enumerateDevices === 'function'
        ? await navigator.mediaDevices.enumerateDevices()
        : [];
      const found = devices.filter((device) => device.kind === 'audioinput').map((device, index) => ({
        id: device.deviceId,
        label: device.label || `Microphone ${index + 1}`,
      }));
      const available = found.length ? found : [{ id: '', label: 'Default microphone' }];
      setInputs(available);
      setInputId((current) => available.some((input) => input.id === current) ? current : available[0].id);
      setState('ready');
      setMessage('Input ready. Wear headphones to avoid recording the project playback.');
    } catch {
      setState('error');
      setMessage('Microphone permission was denied or no input is available. Nothing was recorded.');
    }
  }

  function playCountClick(context, accented) {
    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = accented ? 1_100 : 760;
      gain.gain.setValueAtTime(0.05, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.05);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.06);
    } catch {}
  }

  async function decodeTake(recorder) {
    try {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
      if (!blob.size) throw new Error('empty_recording');
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) throw new Error('audio_context_unavailable');
      const context = new Context();
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      const wav = encodeAudioBufferAsWav(decoded);
      const duration = decoded.length / decoded.sampleRate;
      await context.close();
      const file = new Blob([wav], { type: 'audio/wav' });
      const url = URL.createObjectURL(file);
      takeUrlsRef.current.push(url);
      setTakes((current) => {
        const next = [...current, {
          id: crypto.randomUUID(),
          url,
          duration,
          position: startPositionRef.current,
          filename: `veyrnox-studio-take-${current.length + 1}.wav`,
        }];
        const retained = next.slice(-MAX_SESSION_TAKES);
        next.slice(0, Math.max(0, next.length - MAX_SESSION_TAKES)).forEach((take) => {
          URL.revokeObjectURL(take.url);
          takeUrlsRef.current = takeUrlsRef.current.filter((value) => value !== take.url);
        });
        return retained;
      });
      setState('ready');
      setMessage('PCM WAV take added locally. It is not uploaded or saved with this song.');
    } catch {
      setState('error');
      setMessage('The browser recording could not be decoded as a WAV. The song is unchanged.');
    } finally {
      stopStream();
    }
  }

  function startRecorder(stream) {
    try {
      const choices = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
      const mimeType = choices.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      startPositionRef.current = Number(sourceAudioRef.current?.currentTime) || 0;
      recorder.ondataavailable = (event) => { if (event.data?.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => decodeTake(recorder);
      setLeadBeats(0);
      setRecordSeconds(0);
      setState('recording');
      setMessage(`Recording from ${takeClock(startPositionRef.current)} · ${LIMIT_SECONDS}-second maximum.`);
      const startedAt = Date.now();
      recordTimerRef.current = window.setInterval(() => setRecordSeconds(Math.min(LIMIT_SECONDS, Math.ceil((Date.now() - startedAt) / 1_000))), 250);
      limitTimerRef.current = window.setTimeout(stopRecording, LIMIT_SECONDS * 1_000);
      recorder.start(250);
    } catch {
      stopStream();
      setState('error');
      setMessage('This browser could not start its audio recorder. The song is unchanged.');
    }
  }

  async function beginRecording() {
    if (state !== 'ready') return;
    setMessage('Opening the selected microphone…');
    try {
      const stream = await navigator.mediaDevices.getUserMedia(inputConstraint(inputId));
      streamRef.current = stream;
      if (leadMode === 'none') {
        startRecorder(stream);
        return;
      }
      const beatsPerBar = signature === '3/4' ? 3 : signature === '6/8' ? 6 : 4;
      const totalBeats = leadBars * beatsPerBar;
      let beat = 0;
      setState('arming');
      setLeadBeats(totalBeats);
      setMessage(`${leadMode === 'count-in' ? 'Count-in' : 'Pre-roll'} · ${leadBars} ${leadBars === 1 ? 'bar' : 'bars'} before capture.`);
      if (leadMode === 'pre-roll') {
        try { await sourceAudioRef.current?.play(); } catch {}
      } else {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (Context) {
          clickContextRef.current ||= new Context();
          await clickContextRef.current.resume?.();
          playCountClick(clickContextRef.current, true);
        }
      }
      beat += 1;
      setLeadBeats(totalBeats - beat);
      leadTimerRef.current = window.setInterval(() => {
        if (beat >= totalBeats) {
          window.clearInterval(leadTimerRef.current);
          leadTimerRef.current = null;
          startRecorder(stream);
          return;
        }
        if (leadMode === 'count-in' && clickContextRef.current) playCountClick(clickContextRef.current, beat % beatsPerBar === 0);
        beat += 1;
        setLeadBeats(totalBeats - beat);
      }, 60_000 / tempo);
    } catch {
      stopStream();
      setState('error');
      setMessage('The selected microphone is unavailable. Choose Prepare input to refresh the device list.');
    }
  }

  function cancelLeadIn() {
    clearTimers();
    sourceAudioRef.current?.pause();
    stopStream();
    setLeadBeats(0);
    setState('ready');
    setMessage('Lead-in cancelled. Nothing was recorded.');
  }

  function stopRecording() {
    clearTimers();
    if (recorderRef.current?.state === 'recording') {
      setState('processing');
      setMessage('Preparing a local PCM WAV take…');
      recorderRef.current.stop();
    }
  }

  function removeTake(id) {
    setTakes((current) => {
      const removed = current.find((take) => take.id === id);
      if (removed) {
        URL.revokeObjectURL(removed.url);
        takeUrlsRef.current = takeUrlsRef.current.filter((value) => value !== removed.url);
      }
      return current.filter((take) => take.id !== id);
    });
  }

  const busy = ['arming', 'recording', 'processing'].includes(state);
  return (
    <section aria-label="Studio audio recording" className="border-t border-vx-border bg-vx-base/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Local audio take lane</p><h2 className="mt-1 font-vx text-xl font-black">Record without changing the song</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-vx-fg-muted">Permission begins on intent. Takes stay in this tab, use your current playhead as a label, and are not latency-corrected or mixed into the project.</p></div>
        <button type="button" onClick={prepareInput} disabled={busy} className="min-h-11 rounded-full border border-vx-border px-4 text-sm font-bold disabled:opacity-40">{inputs.length ? 'Refresh inputs' : 'Prepare input'}</button>
      </div>
      {inputs.length ? <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-bold text-vx-fg-muted">Audio input<select aria-label="Audio input" value={inputId} onChange={(event) => setInputId(event.target.value)} disabled={busy} className="mt-1 min-h-11 w-full rounded-xl border border-vx-border bg-vx-panel px-3 text-vx-fg">{inputs.map((input) => <option key={input.id || 'default'} value={input.id}>{input.label}</option>)}</select></label>
        <label className="text-xs font-bold text-vx-fg-muted">Lead-in mode<select aria-label="Lead-in mode" value={leadMode} onChange={(event) => setLeadMode(event.target.value)} disabled={busy} className="mt-1 min-h-11 w-full rounded-xl border border-vx-border bg-vx-panel px-3 text-vx-fg"><option value="none">None</option><option value="count-in">Count-in clicks</option><option value="pre-roll">Project pre-roll</option></select></label>
        <label className="text-xs font-bold text-vx-fg-muted">Lead-in bars<select aria-label="Lead-in bars" value={leadBars} onChange={(event) => setLeadBars(Number(event.target.value))} disabled={busy || leadMode === 'none'} className="mt-1 min-h-11 w-full rounded-xl border border-vx-border bg-vx-panel px-3 text-vx-fg disabled:opacity-50"><option value="1">1 bar</option><option value="2">2 bars</option><option value="4">4 bars</option></select></label>
      </div> : null}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {state === 'arming' ? <button type="button" onClick={cancelLeadIn} className="min-h-11 rounded-full border border-vx-danger/60 px-4 font-bold text-vx-danger">Cancel lead-in</button>
          : state === 'recording' ? <button type="button" onClick={stopRecording} className="min-h-11 rounded-full bg-red-500 px-5 font-bold text-white">Stop recording</button>
            : <button type="button" onClick={beginRecording} disabled={state !== 'ready'} className="min-h-11 rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink disabled:opacity-40">Record audio take</button>}
        {state === 'arming' ? <span className="font-vx-mono text-sm" aria-live="polite">{leadBeats} beats remaining</span> : null}
        {state === 'recording' ? <span className="font-vx-mono text-sm text-red-300" aria-live="polite">● {takeClock(recordSeconds)} / 1:00</span> : null}
        <p role={state === 'error' ? 'alert' : 'status'} className="min-w-0 flex-1 text-sm text-vx-fg-muted">{message}</p>
      </div>
      {takes.length ? <div className="mt-5" aria-label="Recorded take lanes"><h3 className="text-sm font-black">Session take lanes</h3><ol className="mt-2 space-y-2">{takes.map((take, index) => <li key={take.id} className="grid gap-3 rounded-2xl border border-vx-border bg-vx-panel p-3 sm:grid-cols-[1fr_auto] sm:items-center"><div><strong>Take {index + 1}</strong><span className="ml-2 text-xs text-vx-fg-muted">at {takeClock(take.position)} · {takeClock(take.duration)} WAV</span><audio controls src={take.url} className="mt-2 h-9 w-full max-w-md" /></div><div className="flex flex-wrap gap-2"><a href={take.url} download={take.filename} className="inline-flex min-h-10 items-center rounded-full border border-vx-border px-3 text-xs font-bold">Download WAV take</a><button type="button" onClick={() => removeTake(take.id)} className="min-h-10 rounded-full border border-vx-danger/40 px-3 text-xs font-bold text-vx-danger">Remove local take</button></div></li>)}</ol></div> : null}
    </section>
  );
}
