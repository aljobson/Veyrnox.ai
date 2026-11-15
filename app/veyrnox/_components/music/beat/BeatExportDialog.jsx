'use client';
import { useEffect, useRef, useState } from 'react';
import { encodeWav } from '../../../../../lib/musicInstruments.js';
import { renderBeat } from '../../../_lib/music/beat/beatMixdown.js';
import { action, button, input } from './beatStyles';

export default function BeatExportDialog({ doc, announce }) {
  const dialog = useRef(null);
  const mounted = useRef(true);
  const [loops, setLoops] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function download() {
    setBusy(true); setError('');
    try {
      const { samples, sampleRate } = await renderBeat(doc, loops);
      if (!mounted.current) return;
      const url = URL.createObjectURL(new Blob([encodeWav(samples, sampleRate)], { type: 'audio/wav' }));
      const link = document.createElement('a');
      link.href = url; link.download = `${doc.title.normalize('NFKC').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 80) || 'Beat'}.wav`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      announce('Export done. Your WAV has downloaded.'); dialog.current.close();
    } catch (failure) {
      if (mounted.current) { const message = `Could not export WAV. ${failure.message}`; setError(message); announce(message); }
    } finally { if (mounted.current) setBusy(false); }
  }
  return <>
    <button className={action} onClick={() => dialog.current.showModal()}>Download WAV</button>
    <dialog ref={dialog} aria-labelledby="export-title" className="m-auto w-full max-w-sm rounded-2xl border border-vx-border bg-vx-panel p-5 text-vx-fg backdrop:bg-vx-base/80" onCancel={(e) => { if (busy) e.preventDefault(); }}>
      <h2 id="export-title" className="text-xl font-bold">Download WAV</h2><p className="my-3 text-sm text-vx-fg-muted">Export the current pattern, with its tail. The metronome is left out.</p>
      <label className="flex items-center gap-3">Loops<select className={input} value={loops} disabled={busy} onChange={(e) => setLoops(Number(e.target.value))}>{[1, 2, 4, 8].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      {busy && <div className="my-3" aria-busy="true"><p>Rendering WAV…</p><progress aria-label="Rendering WAV" className="w-full accent-vx-accent" /></div>}
      {error && <p className="my-3">{error}</p>}
      <div className="mt-4 flex gap-2"><button className={action} disabled={busy} onClick={download}>Download</button><button className={button} disabled={busy} onClick={() => dialog.current.close()}>Cancel</button></div>
    </dialog>
  </>;
}
