'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { action, button, input } from './beatStyles';

export default function BeatExportDialog({ doc, editTrackId, announce, finalize, librarySave = false }) {
  const dialog = useRef(null), mounted = useRef(true), running = useRef(false), controller = useRef(null);
  const snapshot = useRef(null), modules = useRef(null), prepared = useRef(null), rendered = useRef(null), saveAttempt = useRef(null);
  const [loops, setLoops] = useState(1), [kind, setKind] = useState('song'), [range, setRange] = useState('song');
  const [output, setOutput] = useState('mix'), [bitDepth, setBitDepth] = useState(16);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState('');
  const [title, setTitle] = useState(''), [rights, setRights] = useState(false), [sources, setSources] = useState(null);
  const [opened, setOpened] = useState(false), [saved, setSaved] = useState(null), [hasDownload, setHasDownload] = useState(false);
  const [online, setOnline] = useState(true);
  const [exportDoc, setExportDoc] = useState(null);
  function status(message) { if (mounted.current) { setProgress(message); announce(message); } }
  function failure(message) { if (mounted.current) { setProgress(''); setError(message); announce(message); } }
  useEffect(() => {
    mounted.current = true;
    const update = () => { setOnline(navigator.onLine !== false); if (navigator.onLine === false && librarySave) announce('Saving to Music needs a connection. You can still download the WAV.'); };
    update(); window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { mounted.current = false; controller.current?.abort(); window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, [announce, librarySave]);
  useEffect(() => {
    if (!opened || !modules.current) return;
    try { setSources(modules.current.sources.mixdownSources(snapshot.current, { range })); setError(''); }
    catch (e) { setSources(null); setError(e.message); announce(e.message); }
  }, [opened, range, announce]);
  async function open() {
    snapshot.current = structuredClone(finalize?.() || doc);
    setExportDoc(snapshot.current);
    prepared.current = null; rendered.current = null; saveAttempt.current = null;
    setTitle(snapshot.current.title); setRights(false); setSaved(null); setHasDownload(false); setRange('song'); setError('');
    dialog.current.showModal(); setBusy(true); running.current = true; status('Loading export tools…');
    try {
      const [mixdown, wav, plan, sources, save, instruments] = await Promise.all([
        import('../../../_lib/music/beat/beatMixdown.js'), import('../../../_lib/music/beat/beatWav.mjs'),
        import('../../../_lib/music/beat/beatExport.mjs'), import('../../../_lib/music/beat/beatMixdownSources.mjs'),
        import('../../../_lib/music/beat/beatMixdownSave.js'), import('../../../../../lib/musicInstruments.js'),
      ]);
      if (!mounted.current) return;
      modules.current = { mixdown, wav, plan, sources, save, instruments }; setOpened(true);
      try { setSources(sources.mixdownSources(snapshot.current, { range: 'song' })); } catch (e) { failure(e.message); }
      status('Ready to export');
    } catch { failure("Couldn't load export tools. Close this dialog and try again."); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  const phone = () => matchMedia('(pointer: coarse)').matches && ((navigator.deviceMemory ?? 4) <= 4 || innerWidth < 768);
  async function render(depth, soloTrackId) {
    const { mixdown, wav, plan } = modules.current, doc = snapshot.current;
    const options = { range, output: 'mix', bitDepth: depth, phone: phone() }, planned = plan.planExport(doc, options);
    const signature = `${range}:${depth}:${soloTrackId || 'mix'}`;
    if (rendered.current?.signature === signature) return rendered.current.bytes;
    rendered.current = null; setHasDownload(false);
    if (!prepared.current) {
      const buffers = await mixdown.loadSongBuffers(doc, status, range);
      prepared.current = buffers;
      const missing = [...buffers.values()].filter(b => b.missing).length;
      if (missing) throw new Error(`${missing} ${missing === 1 ? 'sound is' : 'sounds are'} missing and will be silent. Choose Download or Save again to continue.`);
    }
    const bytes = await plan.assembleExport(planned, async chunk => {
      status(`Rendering ${Math.ceil(Math.min(chunk.endSec, planned.seconds))} of ${Math.ceil(planned.seconds)} seconds…`);
      return mixdown.renderSong(doc, { buffers: prepared.current, range, soloTrackId, ...chunk });
    }, wav.createWavWriter(planned));
    // A stem is delivered immediately and never retained alongside the next stem.
    if (!soloTrackId) { rendered.current = { signature, bytes }; setHasDownload(true); }
    return bytes;
  }
  function deliver(bytes, filename) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    const link = document.createElement('a'); link.href = url; link.download = filename;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000); status(`${filename} saved`);
  }
  async function run(save = false) {
    if (running.current || !modules.current) return;
    running.current = true; setBusy(true); setError('');
    const { mixdown, plan, instruments, save: saver } = modules.current;
    try {
      if (save) {
        if (!online) throw Object.assign(new Error(saver.SAVE_OFFLINE_MESSAGE), { code: 'network_error' });
        const planned = plan.planExport(snapshot.current, { range, phone: phone() });
        if (44 + planned.frames * 4 > 26_214_400) throw Object.assign(new Error(saver.MIXDOWN_LIMIT_MESSAGE), { code: 'mixdown_size_invalid' });
        const bytes = await render(16);
        const payload = `${range}:${title.normalize('NFKC').trim()}:${rights}`;
        if (saveAttempt.current?.payload !== payload) saveAttempt.current = { payload, key: crypto.randomUUID() };
        controller.current = new AbortController();
        const result = await saver.saveMixdownToLibrary({ doc: { ...snapshot.current, title }, range, wavBytes: bytes,
          rightsConfirmed: rights, idempotencyKey: saveAttempt.current.key, signal: controller.current.signal, progress: status });
        setSaved({ ...result, title: title.trim() }); status(`${title.trim()} saved to Music`);
      } else if (kind === 'pattern') {
        status('Rendering pattern…');
        const result = await mixdown.renderBeat(snapshot.current, loops, editTrackId);
        deliver(instruments.encodeWav(result.samples, result.sampleRate), plan.exportFilename(snapshot.current.title));
      } else if (output === 'stems') {
        const planned = plan.planExport(snapshot.current, { range, output, bitDepth, phone: phone() });
        for (const track of planned.tracks.filter(t => t.audible)) {
          status(`Rendering ${track.name}…`); deliver(await render(bitDepth, track.id), track.filename);
          // Let the previous Blob's URL release before allocating the next stem.
          await new Promise(resolve => setTimeout(resolve, 1100));
        }
      } else deliver(await render(bitDepth), plan.exportFilename(snapshot.current.title));
    } catch (e) {
      if (['reservation_closed', 'reservation_expired', 'idempotency_conflict'].includes(e.code)) saveAttempt.current = null;
      const known = e instanceof RangeError || /missing|too long|too much|600 seconds/.test(e.message);
      failure(save && e.code ? saver.mixdownSaveError(e) : known ? e.message : save ? saver.mixdownSaveError(e) : "Couldn't render this mix. Try again.");
    } finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  const displayed = exportDoc || doc, empty = !displayed.tracks.some(t => t.regions.length);
  const fraction = progress.match(/(\d+) of (\d+)/), percent = progress.match(/Uploading (\d+)%/);
  const progressValue = percent ? Number(percent[1]) : fraction ? Number(fraction[1]) / Number(fraction[2]) * 100 : 0;
  const tracks = opened ? displayed.tracks.map(t => ({ ...t,
    audible: !t.mute && (!displayed.tracks.some(t => t.solo) || t.solo) && t.gain > 0 })) : [];
  return <>
    <button className={action} onClick={open}>Download WAV</button>
    <dialog ref={dialog} aria-labelledby="export-title" className="m-auto max-h-full w-full max-w-md overflow-y-auto rounded-2xl border border-vx-border bg-vx-panel p-5 text-vx-fg backdrop:bg-vx-base/80"
      onCancel={e => { if (busy) e.preventDefault(); }} onClose={() => { prepared.current = null; rendered.current = null; setOpened(false); }}>
      <h2 id="export-title" className="text-xl font-bold">Export beat</h2>
      <p className="my-3 text-sm text-vx-fg-muted">WAV with a 1.5 second tail and no metronome.</p>
      <fieldset disabled={busy} className="space-y-3">
        <label className="flex flex-col gap-1">Export<select className={input} value={kind} onChange={e => setKind(e.target.value)}><option value="song">Song · stereo</option><option value="pattern">Pattern loops · mono</option></select></label>
        {kind === 'pattern' ? <label className="flex flex-col gap-1">Loops<select className={input} value={loops} onChange={e => setLoops(Number(e.target.value))}>{[1, 2, 4, 8].map(n => <option key={n}>{n}</option>)}</select></label> : <>
          <label className="flex flex-col gap-1">Range<select className={input} value={range} onChange={e => { setRange(e.target.value); setSaved(null); }}><option value="song">Whole song</option><option value="cycle" disabled={!displayed.cycle.on}>Cycle range</option></select></label>
          {!displayed.cycle.on && <p className="text-sm text-vx-fg-muted">Turn Cycle on to export a cycle range.</p>}
          <label className="flex flex-col gap-1">Output<select className={input} value={output} onChange={e => setOutput(e.target.value)}><option value="mix">Mix</option><option value="stems">Stems</option></select></label>
          <label className="flex flex-col gap-1">Bit depth<select className={input} value={bitDepth} onChange={e => setBitDepth(Number(e.target.value))}><option value={16}>16-bit</option><option value={24}>24-bit</option></select></label>
          {output === 'stems' && <ul aria-label="Stem tracks">{tracks.map(t => <li key={t.id} className="py-2"><span role="group" aria-label={t.name} aria-disabled={!t.audible}>{t.name}{!t.audible && ' — Muted in the mix'}</span></li>)}</ul>}
          {librarySave && <section className="space-y-3 border-t border-vx-border pt-4" aria-label="Save to Music library">
            <label className="flex flex-col gap-1">Song title<input className={input} maxLength={80} value={title} onChange={e => { setTitle(e.target.value); setSaved(null); }} aria-invalid={!title.trim()} /></label>
            {!title.trim() && <p className="text-vx-danger">Enter a song title (1–80 characters).</p>}
            {sources?.hasTakes && <label className="flex min-h-11 items-center gap-3"><input className="h-6 w-6 accent-vx-accent focus-visible:ring-2 focus-visible:ring-vx-accent" type="checkbox" checked={rights} onChange={e => setRights(e.target.checked)} />I have permission to use the recorded or imported audio in this mix.</label>}
            {sources?.hasTakes && !rights && <p className="text-sm text-vx-fg-muted">Confirm permission before saving.</p>}
            <p className="text-sm text-vx-fg-muted">Save uses the mix at 16-bit, 48 kHz stereo.</p>
            {!online && <p>Saving to Music needs a connection. You can still download the WAV.</p>}
            <button className={action} disabled={empty || !online || !sources || !title.trim() || title.normalize('NFKC').trim().length > 80 || (sources.hasTakes && !rights) || !!saved} onClick={() => run(true)}>Save to Music library</button>
          </section>}
        </>}
      </fieldset>
      {empty && kind === 'song' && <p className="my-3">Add something to the song first</p>}
      {busy && <div className="my-3" aria-busy="true"><progress aria-label={progress} value={progressValue} max={100} className="w-full accent-vx-accent" /></div>}
      <p className="my-3" role="status">{progress}</p>
      {error && <p className="my-3 text-vx-danger">{error}</p>}
      {saved && <Link className={`${button} inline-flex items-center`} href={`/app/music/songs/${saved.song_id}`}>Open in Music</Link>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button className={action} disabled={busy || !opened || (kind === 'song' && empty)} onClick={() => run()}>Download</button>
        {error && hasDownload && <button className={button} disabled={busy} onClick={() => deliver(rendered.current.bytes, modules.current.plan.exportFilename(snapshot.current.title))}>Download rendered WAV instead</button>}
        <button className={button} disabled={busy} onClick={() => dialog.current.close()}>Close</button>
      </div>
    </dialog>
  </>;
}
