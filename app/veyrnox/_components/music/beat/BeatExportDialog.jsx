'use client';
import { useEffect, useRef, useState } from 'react';
import { encodeWav } from '../../../../../lib/musicInstruments.js';
import { renderBeat, renderSong, loadSongBuffers } from '../../../_lib/music/beat/beatMixdown.js';
import { encodeWavChannels } from '../../../_lib/music/beat/beatWav.mjs';
import { action, button, input } from './beatStyles';

export default function BeatExportDialog({ doc, editTrackId, announce, finalize }) {
  const dialog = useRef(null);
  const mounted = useRef(true);
  const [loops, setLoops] = useState(1);
  const [kind, setKind] = useState('song');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const snapshot = useRef(null);
  const [prepared, setPrepared] = useState(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function download() {
    const doc = snapshot.current;
    setBusy(true); setError('');
    try {
      let buffers;
      if (kind === 'song') {
        buffers = prepared?.doc === doc ? prepared.buffers : await loadSongBuffers(doc, setProgress);
        const missing = [...buffers.values()].filter((b) => b.missing).length;
        if (missing && prepared?.doc !== doc) {
          setPrepared({ doc, buffers }); setError(`${missing} ${missing === 1 ? 'sound is' : 'sounds are'} missing and will be silent. Choose Download again to continue.`);
          return;
        }
      }
      setProgress('Rendering WAV…');
      const result = kind === 'song' ? await renderSong(doc, { buffers }) : await renderBeat(doc, loops, editTrackId);
      const wav = kind === 'song' ? encodeWavChannels(result.channels, result.sampleRate)
        : encodeWav(result.samples, result.sampleRate);
      if (!mounted.current) return;
      const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      const link = document.createElement('a');
      link.href = url; link.download = `${doc.title.normalize('NFKC').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 80) || 'Beat'}.wav`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setPrepared(null); announce('Export done. Your WAV has downloaded.'); dialog.current.close();
    } catch (failure) {
      if (mounted.current) { const message = `Could not export WAV. ${failure.message}`; setError(message); announce(message); }
    } finally { if (mounted.current) setBusy(false); }
  }
  return <>
    <button className={action} onClick={() => { snapshot.current = finalize?.() || doc; setPrepared(null); setError(''); dialog.current.showModal(); }}>Download WAV</button>
    <dialog ref={dialog} aria-labelledby="export-title" className="m-auto w-full max-w-sm rounded-2xl border border-vx-border bg-vx-panel p-5 text-vx-fg backdrop:bg-vx-base/80" onCancel={(e) => { if (busy) e.preventDefault(); }} onClose={() => setPrepared(null)}>
      <h2 id="export-title" className="text-xl font-bold">Download WAV</h2><p className="my-3 text-sm text-vx-fg-muted">Export with a 1.5 second tail and no metronome. Song uses the cycle range when Cycle is on.</p>
      <label className="flex items-center gap-3">Export<select className={input} value={kind}
        disabled={busy} onChange={(e) => setKind(e.target.value)}>
        <option value="song">Song · stereo</option><option value="pattern">Pattern loops · mono</option>
      </select></label>
      {kind === 'pattern' && <label className="flex items-center gap-3">Loops<select className={input} value={loops} disabled={busy} onChange={(e) => setLoops(Number(e.target.value))}>{[1, 2, 4, 8].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>}
      {busy && <div className="my-3" aria-busy="true"><p>{progress}</p><progress aria-label="Rendering WAV" className="w-full accent-vx-accent" /></div>}
      {error && <p className="my-3">{error}</p>}
      <div className="mt-4 flex gap-2"><button className={action} disabled={busy} onClick={download}>Download</button><button className={button} disabled={busy} onClick={() => dialog.current.close()}>Cancel</button></div>
    </dialog>
  </>;
}
