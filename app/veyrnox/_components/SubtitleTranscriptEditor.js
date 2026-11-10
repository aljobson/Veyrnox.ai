'use client';

import { useMemo, useState } from 'react';
import {
  MAX_SUBTITLE_CUES,
  cuesFromReviewedScript,
  subtitleFileName,
  subtitlesSrt,
  subtitlesVtt,
  validateSubtitleCues,
} from '../_lib/subtitleTranscript';

const field = 'w-full rounded-lg border border-vx-border bg-vx-base px-3 py-2 text-xs text-vx-fg focus:border-vx-accent focus:outline-hidden';

function downloadText(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SubtitleTranscriptEditor({ script, language, maxSeconds = 40, disabled = false }) {
  const [cues, setCues] = useState([]);
  const [notice, setNotice] = useState('');
  const validation = useMemo(() => validateSubtitleCues(cues, maxSeconds), [cues, maxSeconds]);

  function generate() {
    setCues(cuesFromReviewedScript(script, maxSeconds));
    setNotice('Draft timing created locally. Review every cue before export.');
  }

  function update(id, patch) {
    setCues((current) => current.map((cue) => cue.id === id ? { ...cue, ...patch } : cue));
    setNotice('');
  }

  function addCue() {
    setCues((current) => {
      if (current.length >= MAX_SUBTITLE_CUES) return current;
      const lastEnd = Number(current.at(-1)?.end) || 0;
      const start = Math.min(lastEnd, Math.max(0, maxSeconds - 0.5));
      const end = Math.min(maxSeconds, start + 2);
      return [...current, { id: `cue-${Date.now()}-${current.length}`, start, end, text: '' }];
    });
    setNotice('');
  }

  function exportFile(format) {
    if (!validation.ok) return;
    const isSrt = format === 'srt';
    const text = isSrt ? subtitlesSrt(cues, maxSeconds) : subtitlesVtt(cues, maxSeconds);
    downloadText(text, subtitleFileName(language, format), isSrt ? 'application/x-subrip;charset=utf-8' : 'text/vtt;charset=utf-8');
    setNotice(`${format.toUpperCase()} downloaded. The file is separate from the rendered video.`);
  }

  return (
    <section className="rounded-2xl border border-vx-border bg-vx-panel p-4 sm:p-5" aria-labelledby="subtitle-transcript-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">SUBTITLE FILE</p>
          <h2 id="subtitle-transcript-title" className="mt-1 text-lg font-black">Review transcript and timing</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-vx-fg-muted">Create a local timing draft from your reviewed translation, then edit every cue and export SRT or WebVTT. This does not transcribe, translate, burn captions into the video, upload the transcript, or spend credits.</p>
        </div>
        <span className="rounded-full border border-vx-border px-3 py-1 font-vx-mono text-[9px] font-bold tracking-[0.1em] text-vx-fg-muted">LOCAL ONLY</span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={disabled || !String(script || '').trim()} onClick={generate} className="min-h-10 rounded-full bg-vx-accent px-4 text-xs font-extrabold text-vx-accent-ink disabled:cursor-not-allowed disabled:opacity-40">Create cues from translation</button>
        <button type="button" disabled={disabled || cues.length >= MAX_SUBTITLE_CUES} onClick={addCue} className="min-h-10 rounded-full border border-vx-border px-4 text-xs font-extrabold hover:border-vx-accent disabled:opacity-40">Add cue</button>
        <button type="button" disabled={disabled || !validation.ok} onClick={() => exportFile('srt')} className="min-h-10 rounded-full border border-vx-border px-4 text-xs font-extrabold hover:border-vx-accent disabled:opacity-40">Download SRT</button>
        <button type="button" disabled={disabled || !validation.ok} onClick={() => exportFile('vtt')} className="min-h-10 rounded-full border border-vx-border px-4 text-xs font-extrabold hover:border-vx-accent disabled:opacity-40">Download VTT</button>
      </div>

      {!String(script || '').trim() && <p className="mt-3 text-xs text-vx-fg-muted">Paste a reviewed translation above to create a timing draft, or add cues manually for an owned dubbed track.</p>}
      {cues.length > 0 && (
        <div className="mt-4 space-y-3" role="list" aria-label="Subtitle cues">
          {cues.map((cue, index) => (
            <div key={cue.id} role="listitem" className="rounded-xl border border-vx-border bg-vx-base p-3">
              <div className="grid gap-3 sm:grid-cols-[74px_110px_110px_minmax(0,1fr)_auto] sm:items-start">
                <span className="pt-2 font-vx-mono text-[10px] font-bold text-vx-fg-muted">CUE {index + 1}</span>
                <label className="text-[10px] font-bold text-vx-fg-muted">START (S)<input aria-label={`Cue ${index + 1} start seconds`} type="number" min="0" max={maxSeconds} step="0.1" value={cue.start} disabled={disabled} onChange={(event) => update(cue.id, { start: event.target.value })} className={`${field} mt-1`} /></label>
                <label className="text-[10px] font-bold text-vx-fg-muted">END (S)<input aria-label={`Cue ${index + 1} end seconds`} type="number" min="0" max={maxSeconds} step="0.1" value={cue.end} disabled={disabled} onChange={(event) => update(cue.id, { end: event.target.value })} className={`${field} mt-1`} /></label>
                <label className="text-[10px] font-bold text-vx-fg-muted">CAPTION<textarea aria-label={`Cue ${index + 1} caption`} rows="2" value={cue.text} disabled={disabled} onChange={(event) => update(cue.id, { text: event.target.value })} className={`${field} mt-1 resize-y`} /></label>
                <button type="button" disabled={disabled} onClick={() => setCues((current) => current.filter((item) => item.id !== cue.id))} className="min-h-10 rounded-full border border-vx-border px-3 text-xs font-bold text-vx-fg-muted hover:border-vx-danger hover:text-vx-danger disabled:opacity-40">Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!validation.ok && cues.length > 0 && <p role="alert" className="mt-3 text-xs text-vx-danger">{validation.errors[0]}</p>}
      {notice && <p role="status" className="mt-3 text-xs text-vx-fg-muted">{notice}</p>}
    </section>
  );
}
