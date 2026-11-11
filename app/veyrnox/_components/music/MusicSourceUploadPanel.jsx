'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';
import { encodeAudioBufferAsWav } from '../../_lib/performanceStudio';

const RECORDING_LIMIT_SECONDS = 60;

function sourceKey(file) {
  return file ? `${file.name}:${file.type}:${file.size}:${file.lastModified}` : '';
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

export function MusicSourceUploadPanel({ enabled, selectedId, onSelectionChange }) {
  const [sources, setSources] = useState([]);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const attemptRef = useRef(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const stopRef = useRef(null);

  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (stopRef.current) window.clearTimeout(stopRef.current);
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.ondataavailable = null;
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const result = await gatewayFetch('/music/sources', { promptOnAuth: false });
      setSources(Array.isArray(result.sources) ? result.sources : []);
    } catch (reason) {
      setError(reason?.code === 'sources_not_open'
        ? 'Owned sources are not enabled in this environment.'
        : 'Owned sources could not be loaded.');
    }
  }, [enabled]);

  function chooseFile(event) {
    const next = event.target.files?.[0] || null;
    setFile(next);
    setError('');
    setNotice('');
    if (attemptRef.current?.fingerprint !== sourceKey(next)) attemptRef.current = null;
  }

  function stopRecording() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (stopRef.current) window.clearTimeout(stopRef.current);
    timerRef.current = null;
    stopRef.current = null;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    setRecording(false);
  }

  async function startRecording() {
    setError(''); setNotice(''); setFile(null); attemptRef.current = null;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('This browser cannot record audio here. Upload an MP3 or WAV instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const choices = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
      const mimeType = choices.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data?.size) chunksRef.current.push(event.data); };
      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' });
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (!AudioContext) throw new Error('audio_context_unavailable');
          const context = new AudioContext();
          const decoded = await context.decodeAudioData(await blob.arrayBuffer());
          const wav = encodeAudioBufferAsWav(decoded);
          await context.close();
          const next = new File([wav], 'veyrnox-recording.wav', { type: 'audio/wav' });
          setFile(next);
          setNotice('Recording prepared as WAV. Confirm your rights before uploading it privately.');
        } catch {
          setError('This recording could not be prepared. Try again or upload an MP3 or WAV.');
        }
      };
      setRecordSeconds(0);
      setRecording(true);
      const startedAt = Date.now();
      timerRef.current = window.setInterval(() => setRecordSeconds(Math.min(RECORDING_LIMIT_SECONDS, Math.ceil((Date.now() - startedAt) / 1000))), 250);
      stopRef.current = window.setTimeout(stopRecording, RECORDING_LIMIT_SECONDS * 1000);
      recorder.start(250);
    } catch {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setRecording(false);
      setError('Microphone access was not available. Allow it in your browser, or upload an MP3 or WAV.');
    }
  }

  async function upload() {
    if (!file || !rightsConfirmed || busy) return;
    setBusy('uploading');
    setError('');
    setNotice('');
    const fingerprint = sourceKey(file);
    const attempt = attemptRef.current?.fingerprint === fingerprint
      ? attemptRef.current
      : { fingerprint, idempotencyKey: `source.${crypto.randomUUID()}` };
    attemptRef.current = attempt;
    try {
      const reserved = await gatewayFetch('/music/sources', {
        method: 'POST',
        body: JSON.stringify({
          action: 'reserve',
          content_type: file.type,
          filename: file.name,
          idempotency_key: attempt.idempotencyKey,
          rights_confirmed: true,
          size_bytes: file.size,
        }),
      });
      let source = reserved.source;
      if (!source) {
        const response = await fetch(reserved.upload_url, {
          method: 'PUT',
          headers: { ...(reserved.headers || {}), 'Content-Type': reserved.content_type },
          body: file,
        });
        // A replayed reservation signs the same immutable key. If the first
        // completion acknowledgement was lost, If-None-Match correctly
        // returns 412 because the exact bytes are already present. Continue
        // to server inspection instead of trapping the owner in a retry loop.
        if (!response.ok && !(reserved.idempotent === true && response.status === 412)) {
          throw new Error('storage_upload_failed');
        }
        const completed = await gatewayFetch('/music/sources', {
          method: 'POST',
          body: JSON.stringify({ action: 'complete', id: reserved.id }),
        });
        source = completed.source;
      }
      attemptRef.current = null;
      setSources((current) => [source, ...current.filter((item) => item.id !== source.id)]);
      onSelectionChange(source.id);
      setFile(null);
      setRightsConfirmed(false);
      setNotice('Private source verified and attached. It remains unusable for generation until a compatible model is admitted.');
    } catch (reason) {
      const code = reason?.code || reason?.message;
      const messages = {
        source_duration_invalid: 'This recording is longer than your current plan allows.',
        source_duration_unavailable: 'The recording duration could not be verified.',
        source_type_not_supported: 'Choose an MP3 or WAV file.',
        source_size_invalid: 'Choose a source no larger than 20 MB.',
        rights_confirmation_required: 'Confirm that you have permission to use both the recording and composition.',
        storage_upload_failed: 'The private upload did not finish. Retry uses the same reservation.',
      };
      setError(messages[code] || 'The source could not be verified. No generation request was made.');
    } finally {
      setBusy('');
    }
  }

  async function remove(id) {
    setBusy(`removing:${id}`);
    setError('');
    try {
      await gatewayFetch('/music/sources', { method: 'DELETE', body: JSON.stringify({ id }) });
      setSources((current) => current.filter((item) => item.id !== id));
      if (selectedId === id) onSelectionChange(null);
      setNotice('Source removed from the active private library.');
    } catch {
      setError('The source could not be removed.');
    } finally {
      setBusy('');
    }
  }

  if (!enabled) return null;

  if (!open) return (
    <section className="rounded-2xl border border-dashed border-vx-border-boost bg-vx-base p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-vx text-lg font-black">Bring owned audio</h3><p className="mt-1 text-xs text-vx-fg-muted">Add a private MP3 or WAV with explicit rights evidence.</p></div><button type="button" onClick={() => { setOpen(true); load(); }} className="min-h-11 rounded-full border border-vx-border px-4 text-sm font-bold">Add owned audio</button></div>
    </section>
  );

  return (
    <section aria-labelledby="owned-source-title" className="rounded-2xl border border-vx-border bg-vx-base p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h3 id="owned-source-title" className="font-vx text-lg font-black">Owned audio source</h3><p className="mt-1 text-xs leading-5 text-vx-fg-muted">MP3 or WAV · up to 20 MB · 8 minutes free or 30 minutes with an active plan.</p></div>
        <button type="button" onClick={() => setOpen(false)} className="min-h-10 rounded-full border border-vx-border px-3 text-xs font-bold text-vx-fg-muted">Close sources</button>
      </div>

      <label className="mt-4 block text-sm font-bold text-vx-fg-body">
        Choose owned audio
        <input type="file" accept="audio/mpeg,audio/wav,.mp3,.wav" onChange={chooseFile} disabled={recording || Boolean(busy)} className="mt-2 block w-full rounded-xl border border-vx-border bg-vx-panel px-3 py-2 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-vx-accent file:px-3 file:py-2 file:font-bold file:text-vx-accent-ink disabled:opacity-50" />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={recording ? stopRecording : startRecording} disabled={Boolean(busy)} className="min-h-11 rounded-full border border-vx-border px-4 text-sm font-bold disabled:opacity-40">{recording ? 'Stop recording' : 'Record with microphone'}</button>
        <span className="text-xs text-vx-fg-muted">{recording ? `Recording ${formatDuration(recordSeconds)} / 1:00` : 'Microphone permission is requested only after you press Record.'}</span>
      </div>
      {file ? <p className="mt-2 break-all text-xs text-vx-fg-muted">Selected: {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</p> : null}
      <label className="mt-3 flex items-start gap-3 text-xs leading-5 text-vx-fg-body">
        <input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} className="mt-1 h-4 w-4 accent-vx-accent" />
        <span>I own or have permission to use both this recording and its underlying composition for private generation.</span>
      </label>
      <button type="button" onClick={upload} disabled={!file || !rightsConfirmed || Boolean(busy)} className="mt-3 min-h-11 rounded-full bg-vx-accent px-4 text-sm font-bold text-vx-accent-ink disabled:cursor-not-allowed disabled:opacity-40">{busy === 'uploading' ? 'Verifying private source…' : 'Upload and verify'}</button>

      {sources.length ? (
        <fieldset className="mt-5"><legend className="text-sm font-bold">Ready sources</legend><div className="mt-2 space-y-2">
          {sources.map((source) => <div key={source.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-vx-border bg-vx-panel p-3">
            <label className="flex min-w-0 flex-1 items-center gap-3 text-sm"><input type="radio" name="music-owned-source" checked={selectedId === source.id} onChange={() => onSelectionChange(source.id)} className="h-4 w-4 accent-vx-accent" /><span className="min-w-0"><strong className="block truncate">{source.filename}</strong><span className="text-xs text-vx-fg-muted">{formatDuration(source.duration_seconds)} · rights v1</span></span></label>
            <button type="button" onClick={() => remove(source.id)} disabled={Boolean(busy)} className="min-h-10 rounded-full border border-vx-border px-3 text-xs font-bold text-vx-fg-muted disabled:opacity-40">Remove</button>
          </div>)}
        </div></fieldset>
      ) : <p className="mt-4 text-xs text-vx-fg-muted">No verified owned audio yet.</p>}
      {selectedId ? <button type="button" onClick={() => onSelectionChange(null)} className="mt-3 text-xs font-bold text-vx-fg-muted underline">Detach source</button> : null}
      {error ? <p role="alert" className="mt-3 text-xs text-vx-danger">{error}</p> : null}
      {notice ? <p role="status" className="mt-3 text-xs text-vx-fg-body">{notice}</p> : null}
    </section>
  );
}
