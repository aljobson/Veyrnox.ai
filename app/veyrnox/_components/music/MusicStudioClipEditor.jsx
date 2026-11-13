'use client';

import { useEffect, useRef, useState } from 'react';
import { encodeAudioBufferAsWav } from '../../_lib/performanceStudio';

const MAX_PREVIEW_SECONDS = 60;

function bounded(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function fadeGain(progress, curve) {
  const value = bounded(progress, 0, 1, 0);
  if (curve === 'exponential') return value ** 2.5;
  if (curve === 'logarithmic') return Math.sqrt(value);
  return value;
}

function sampleAt(data, position) {
  const left = Math.max(0, Math.min(data.length - 1, Math.floor(position)));
  const right = Math.min(data.length - 1, left + 1);
  const fraction = Math.max(0, Math.min(1, position - left));
  return data[left] + (data[right] - data[left]) * fraction;
}

async function sourceBytes(sourceUrl) {
  if (sourceUrl.startsWith('data:')) {
    const comma = sourceUrl.indexOf(',');
    if (comma < 0) throw new Error('invalid_data_url');
    const metadata = sourceUrl.slice(5, comma); const payload = sourceUrl.slice(comma + 1);
    if (metadata.endsWith(';base64')) {
      const binary = window.atob(payload); const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return bytes.buffer;
    }
    return new TextEncoder().encode(decodeURIComponent(payload)).buffer;
  }
  const response = await fetch(sourceUrl, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('source_read_failed');
  return response.arrayBuffer();
}

export function MusicStudioClipEditor({ sourceAudioRef, sourceTitle, duration }) {
  const clipLimit = Math.max(0.01, Math.min(MAX_PREVIEW_SECONDS, Number(duration) || MAX_PREVIEW_SECONDS));
  const [trimStart, setTrimStart] = useState(0); const [trimEnd, setTrimEnd] = useState(MAX_PREVIEW_SECONDS);
  const [fadeIn, setFadeIn] = useState(0); const [fadeOut, setFadeOut] = useState(0); const [fadeCurve, setFadeCurve] = useState('linear');
  const [reverse, setReverse] = useState(false); const [semitones, setSemitones] = useState(0); const [cents, setCents] = useState(0);
  const [rendering, setRendering] = useState(false); const [message, setMessage] = useState('Rendering starts only after you choose Render local clip preview.'); const [preview, setPreview] = useState(null);
  const urlRef = useRef('');

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  async function renderPreview() {
    const audio = sourceAudioRef.current; const sourceUrl = audio?.currentSrc || audio?.src;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!sourceUrl || !Context) { setMessage('This browser cannot decode the current clip for a local preview.'); return; }
    setRendering(true); setMessage('Decoding and rendering locally…');
    let context;
    try {
      context = new Context();
      const decoded = await context.decodeAudioData(await sourceBytes(sourceUrl));
      const available = decoded.length / decoded.sampleRate;
      const startSeconds = bounded(trimStart, 0, Math.max(0, available - 1 / decoded.sampleRate), 0);
      const requestedEnd = bounded(Math.min(trimEnd, startSeconds + MAX_PREVIEW_SECONDS), startSeconds + 1 / decoded.sampleRate, available, available);
      const startFrame = Math.floor(startSeconds * decoded.sampleRate); const endFrame = Math.max(startFrame + 1, Math.floor(requestedEnd * decoded.sampleRate));
      const pitchRate = 2 ** ((bounded(semitones, -12, 12, 0) + bounded(cents, -100, 100, 0) / 100) / 12);
      const outputLength = Math.max(1, Math.floor((endFrame - startFrame) / pitchRate));
      const output = context.createBuffer(decoded.numberOfChannels, outputLength, decoded.sampleRate);
      const outputSeconds = outputLength / decoded.sampleRate;
      const fadeInFrames = Math.min(outputLength, Math.floor(bounded(fadeIn, 0, outputSeconds, 0) * decoded.sampleRate));
      const fadeOutFrames = Math.min(outputLength, Math.floor(bounded(fadeOut, 0, outputSeconds, 0) * decoded.sampleRate));
      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
        const input = decoded.getChannelData(channel); const rendered = output.getChannelData(channel);
        for (let index = 0; index < outputLength; index += 1) {
          const position = reverse ? endFrame - 1 - index * pitchRate : startFrame + index * pitchRate;
          let gain = 1;
          if (fadeInFrames > 0 && index < fadeInFrames) gain *= fadeGain(index / fadeInFrames, fadeCurve);
          if (fadeOutFrames > 0 && index >= outputLength - fadeOutFrames) gain *= fadeGain((outputLength - 1 - index) / fadeOutFrames, fadeCurve);
          rendered[index] = sampleAt(input, position) * gain;
        }
      }
      const wav = encodeAudioBufferAsWav(output); const file = new Blob([wav], { type: 'audio/wav' });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(file); urlRef.current = url;
      setPreview({ url, duration: outputSeconds, start: startSeconds, end: requestedEnd, pitchRate, reverse, fadeCurve });
      setMessage(`Rendered ${outputSeconds.toFixed(2)} seconds of PCM WAV locally. The immutable song is unchanged.`);
    } catch {
      setMessage('The current clip could not be decoded or rendered locally. The immutable song is unchanged.');
    } finally {
      await context?.close?.(); setRendering(false);
    }
  }

  const shownEnd = Math.min(trimEnd, clipLimit);
  return (
    <section aria-label="Studio clip settings" className="border-t border-vx-border bg-vx-panel/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Audio 1 clip settings</p><h2 className="mt-1 font-vx text-xl font-black">Render a local clip preview</h2><p className="mt-2 max-w-2xl text-xs leading-5 text-vx-fg-muted">Trim, reverse, tune and fade up to 60 seconds of the current clip into a new tab-local PCM WAV. This never replaces the immutable song.</p></div><button type="button" onClick={renderPreview} disabled={rendering} className="min-h-11 rounded-full bg-vx-accent px-4 text-sm font-bold text-vx-accent-ink disabled:opacity-50">{rendering ? 'Rendering…' : 'Render local clip preview'}</button></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs font-bold text-vx-fg-muted">Trim start · seconds<input aria-label="Clip trim start" type="number" min="0" max={Math.max(0, shownEnd - 0.01)} step="0.01" value={Math.min(trimStart, Math.max(0, shownEnd - 0.01))} onChange={(event) => setTrimStart(bounded(event.target.value, 0, Math.max(0, shownEnd - 0.01), 0))} className="mt-1 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-3 text-vx-fg" /></label>
        <label className="text-xs font-bold text-vx-fg-muted">Trim end · seconds<input aria-label="Clip trim end" type="number" min="0.01" max={clipLimit} step="0.01" value={shownEnd} onChange={(event) => setTrimEnd(bounded(event.target.value, 0.01, clipLimit, clipLimit))} className="mt-1 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-3 text-vx-fg" /></label>
        <label className="text-xs font-bold text-vx-fg-muted">Semitones · {semitones > 0 ? '+' : ''}{semitones}<input aria-label="Clip pitch semitones" type="range" min="-12" max="12" step="1" value={semitones} onChange={(event) => setSemitones(Number(event.target.value))} className="mt-3 w-full" /></label>
        <label className="text-xs font-bold text-vx-fg-muted">Cents · {cents > 0 ? '+' : ''}{cents}<input aria-label="Clip pitch cents" type="range" min="-100" max="100" step="1" value={cents} onChange={(event) => setCents(Number(event.target.value))} className="mt-3 w-full" /></label>
        <label className="text-xs font-bold text-vx-fg-muted">Fade in · {fadeIn.toFixed(2)} s<input aria-label="Clip fade in" type="range" min="0" max={clipLimit} step="0.05" value={Math.min(fadeIn, clipLimit)} onChange={(event) => setFadeIn(Number(event.target.value))} className="mt-3 w-full" /></label>
        <label className="text-xs font-bold text-vx-fg-muted">Fade out · {fadeOut.toFixed(2)} s<input aria-label="Clip fade out" type="range" min="0" max={clipLimit} step="0.05" value={Math.min(fadeOut, clipLimit)} onChange={(event) => setFadeOut(Number(event.target.value))} className="mt-3 w-full" /></label>
        <label className="text-xs font-bold text-vx-fg-muted">Fade shape<select aria-label="Clip fade curve" value={fadeCurve} onChange={(event) => setFadeCurve(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-vx-border bg-vx-base px-3 text-vx-fg"><option value="linear">Linear</option><option value="exponential">Exponential</option><option value="logarithmic">Logarithmic</option></select></label>
        <label className="flex min-h-11 items-center gap-2 self-end rounded-xl border border-vx-border bg-vx-base px-3 text-sm font-bold"><input type="checkbox" checked={reverse} onChange={(event) => setReverse(event.target.checked)} /> Reverse rendered clip</label>
      </div>
      <p role="status" className="mt-3 text-xs text-vx-fg-muted">{message}</p>
      {preview && <div className="mt-4 rounded-2xl border border-vx-border bg-vx-base p-3"><p className="text-xs text-vx-fg-muted">{sourceTitle} · source {preview.start.toFixed(2)}–{preview.end.toFixed(2)} s · {preview.reverse ? 'reversed' : 'forward'} · {preview.pitchRate.toFixed(3)}× linked pitch/speed · {preview.fadeCurve} fades</p><audio controls src={preview.url} className="mt-3 w-full" aria-label="Rendered clip preview" /><a href={preview.url} download="veyrnox-studio-local-clip.wav" className="mt-3 inline-flex min-h-11 items-center rounded-full border border-vx-border px-4 text-sm font-bold">Download rendered WAV</a></div>}
      <p className="mt-3 text-xs leading-5 text-vx-fg-muted">Bounded local subset: resampling makes pitch and speed change together. No pitch-preserving time stretch, formant control, warp markers, quantize, clip loop flags, lyrics/styles/stems info, project save or transport replacement.</p>
    </section>
  );
}
