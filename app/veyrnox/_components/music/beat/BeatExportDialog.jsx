'use client';
import { beatErrorMessage, beatFailure } from '../../../_lib/music/beat/beatErrors.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

import { mixTailSeconds, patternTailSeconds } from '../../../_lib/music/beat/beatMixRules.mjs';
import { mixdownSaveAttempt } from '../../../_lib/music/beat/beatSaveAttempt.mjs';
import { trackContributes, patternTrack } from '../../../_lib/music/beat/beatEvents.mjs';
import { gatewayFetch } from '../../../_lib/gateway.js';
import { exportAvailabilityGuard } from '../../../_lib/music/beat/beatAssetAvailability.mjs';
import { assetState, markAssetHeld } from '../../../_lib/music/beat/beatAssets.js';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { action, button, input } from './beatStyles';

export default function BeatExportDialog({ doc, editTrackId, announce, finalize, librarySave = false, compact = false }) {
  const { t } = useI18n();
  const dialog = useRef(null), mounted = useRef(true), running = useRef(false), controller = useRef(null);
  const snapshot = useRef(null), modules = useRef(null), prepared = useRef(null), rendered = useRef(null), saveAttempt = useRef(null);
  const [loops, setLoops] = useState(1), [kind, setKind] = useState('song'), [range, setRange] = useState('song');
  const [output, setOutput] = useState('mix'), [bitDepth, setBitDepth] = useState(16);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState(''), [progressValue, setProgressValue] = useState(0);
  const [title, setTitle] = useState(''), [rights, setRights] = useState(false), [sources, setSources] = useState(null);
  const [opened, setOpened] = useState(false), [saved, setSaved] = useState(null), [hasDownload, setHasDownload] = useState(false);
  const [online, setOnline] = useState(true);
  const [exportDoc, setExportDoc] = useState(null);
  // The bar is driven by a number from the producer, never parsed out of the translated text.
  function status(message, fraction) { if (mounted.current) { setProgress(message); setProgressValue(Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) * 100 : 0); announce(message); } }
  function failure(message) { if (mounted.current) { setProgress(''); setProgressValue(0); setError(message); announce(message); } }
  useEffect(() => {
    mounted.current = true;
    const update = () => { setOnline(navigator.onLine !== false); if (navigator.onLine === false && librarySave) announce(t('app.music.beat.ui.saving.to.music.needs.a.connection.you.can.still.download.the.wav')); };
    update(); window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { mounted.current = false; controller.current?.abort(); window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, [announce, librarySave, t]);
  useEffect(() => {
    if (!opened || !modules.current) return;
    try { setSources(modules.current.sources.mixdownSources(snapshot.current, { range })); setError(''); }
    catch (e) { setSources(null); setError(beatErrorMessage(e, 'render', t)); announce(beatErrorMessage(e, 'render', t)); }
  }, [opened, range, announce, t]);
  async function open() {
    snapshot.current = structuredClone(await finalize?.() || doc);
    setExportDoc(snapshot.current);
    prepared.current = null; rendered.current = null; saveAttempt.current = null;
    setTitle(snapshot.current.title); setRights(false); setSaved(null); setHasDownload(false); setRange('song'); setError('');
    dialog.current.showModal(); setBusy(true); running.current = true; status(t('app.music.beat.status.s19'));
    try {
      const [mixdown, wav, plan, sources, save, instruments] = await Promise.all([
        import('../../../_lib/music/beat/beatMixdown.js'), import('../../../_lib/music/beat/beatWav.mjs'),
        import('../../../_lib/music/beat/beatExport.mjs'), import('../../../_lib/music/beat/beatMixdownSources.mjs'),
        import('../../../_lib/music/beat/beatMixdownSave.js'), import('../../../../../lib/musicInstruments.js'),
      ]);
      if (!mounted.current) return;
      modules.current = { mixdown, wav, plan, sources, save, instruments }; setOpened(true);
      try { setSources(sources.mixdownSources(snapshot.current, { range: 'song' })); } catch (e) { failure(beatErrorMessage(e, 'render', t)); }
      status(t('app.music.beat.status.s20'));
    } catch { failure(t('app.music.beat.status.s21')); }
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
      const buffers = await mixdown.loadSongBuffers(doc, status, range, t);
      prepared.current = buffers;
      const missing = [...buffers.values()].filter(b => b.missing).length;
      if (missing) throw beatFailure(missing === 1 ? 'recovery-r87' : 'recovery-r88', { count: missing });
    }
    const bytes = await plan.assembleExport(planned, async chunk => {
      const done = Math.ceil(Math.min(chunk.endSec, planned.seconds)), total = Math.ceil(planned.seconds);
      status(t('app.music.beat.status.s22', { p0: done, p1: total }), done / total);
      return mixdown.renderSong(doc, { buffers: prepared.current, range, soloTrackId, ...chunk });
    }, wav.createWavWriter(planned));
    // A stem is delivered immediately and never retained alongside the next stem.
    if (!soloTrackId) { rendered.current = { signature, bytes }; setHasDownload(true); }
    return bytes;
  }
  async function deliver(bytes, filename, confirm) {
    await confirm();
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    const link = document.createElement('a'); link.href = url; link.download = filename;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000); status(t('app.music.beat.status.s23', { p0: filename }));
  }
  async function run(save = false) {
    if (running.current || !modules.current) return;
    running.current = true; setBusy(true); setError('');
    const { mixdown, plan, instruments, save: saver } = modules.current;
    const confirm = exportAvailabilityGuard(snapshot.current, { request: gatewayFetch, state: assetState, markHeld: markAssetHeld });
    try {
      if (save) {
        if (!online) throw Object.assign(new Error(saver.SAVE_OFFLINE_MESSAGE), { code: 'network_error' });
        const planned = plan.planExport(snapshot.current, { range, phone: phone() });
        if (44 + planned.frames * 4 > 26_214_400) throw Object.assign(new Error(saver.MIXDOWN_LIMIT_MESSAGE), { code: 'mixdown_size_invalid' });
        const bytes = await render(16);
        const payload = `${range}:${title.normalize('NFKC').trim()}:${rights}`;
        saveAttempt.current = mixdownSaveAttempt(saveAttempt.current, payload, await saver.wavSha256(bytes));
        controller.current = new AbortController();
        const result = await saver.saveMixdownToLibrary({ doc: { ...snapshot.current, title }, range, wavBytes: bytes,
          rightsConfirmed: rights, idempotencyKey: saveAttempt.current.key, signal: controller.current.signal, progress: status, t, beforePost: () => confirm({ range }) });
        setSaved({ ...result, title: title.trim() }); status(t('app.music.beat.status.s24', { p0: title.trim() }));
      } else if (kind === 'pattern') {
        status(t('app.music.beat.status.s25'));
        const result = await mixdown.renderBeat(snapshot.current, loops, editTrackId);
        await deliver(instruments.encodeWav(result.samples, result.sampleRate), plan.exportFilename(snapshot.current.title), () => confirm({ pattern: true }));
      } else if (output === 'stems') {
        const planned = plan.planExport(snapshot.current, { range, output, bitDepth, phone: phone() });
        for (const track of planned.tracks.filter(t => t.audible)) {
          status(t('app.music.beat.status.s26', { p0: track.name })); await deliver(await render(bitDepth, track.id), track.filename, () => confirm({ range, soloTrackId: track.id }));
          // Let the previous Blob's URL release before allocating the next stem.
          await new Promise(resolve => setTimeout(resolve, 1100));
        }
      } else await deliver(await render(bitDepth), plan.exportFilename(snapshot.current.title), () => confirm({ range }));
    } catch (e) {
      if (['reservation_closed', 'reservation_expired', 'idempotency_conflict'].includes(e.code)) saveAttempt.current = null;
      if (['asset_held', 'asset_unconfirmed'].includes(e.code)) { prepared.current = null; rendered.current = null; setHasDownload(false); failure(beatErrorMessage(e, 'render', t)); return; }

      failure(e.displayCode ? beatErrorMessage(e, 'render', t) : save ? saver.mixdownSaveError(e, t) : beatErrorMessage(e, 'render', t));
    } finally { running.current = false; if (mounted.current) setBusy(false); }
  }
  const titleInvalid = !title.trim() || title.normalize('NFKC').trim().length > 80;
  const displayed = exportDoc || doc, empty = !displayed.tracks.some(t => t.regions.length);
  const tracks = opened ? displayed.tracks.map(t => ({ ...t,
    audible: trackContributes(displayed, t.id, 'song') })) : [];
  return <>
    <button data-beat-tip="export" className={compact ? `${button} grid place-items-center px-0` : action}
      aria-label={t('app.music.beat.ui.download.wav')} title={compact ? t('app.music.beat.ui.download.wav') : undefined} onClick={open}>
      {compact ? <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12 M7 10l5 5 5-5 M5 20h14" /></svg> : t('app.music.beat.ui.download.wav')}
    </button>
    <dialog ref={dialog} aria-labelledby="export-title" className="m-auto max-h-full w-full max-w-md overflow-y-auto rounded-2xl border border-vx-border bg-vx-panel p-5 text-vx-fg backdrop:bg-vx-base/80"
      onCancel={e => { if (busy) e.preventDefault(); }} onClose={() => { prepared.current = null; rendered.current = null; setOpened(false); }}>
      <h2 id="export-title" className="text-xl font-bold">{t('app.music.beat.ui.export.beat')}</h2>
      <p className="my-3 text-sm text-vx-fg-muted">{t('app.music.beat.ui.wav.with.a')}{(kind === 'pattern' ? patternTailSeconds(displayed, patternTrack(displayed, editTrackId)) : mixTailSeconds(displayed)).toFixed(1)}{t('app.music.beat.ui.second.tail.and.no.metronome')}</p>
      <fieldset disabled={busy} className="space-y-3">
        <label className="flex flex-col gap-1">{t('app.music.beat.ui.export')}<select className={input} value={kind} onChange={e => setKind(e.target.value)}><option value="song">{t('app.music.beat.ui.song.stereo')}</option><option value="pattern">{t('app.music.beat.ui.pattern.loops.mono')}</option></select></label>
        {kind === 'pattern' ? <label className="flex flex-col gap-1">{t('app.music.beat.ui.loops')}<select className={input} value={loops} onChange={e => setLoops(Number(e.target.value))}>{[1, 2, 4, 8].map(n => <option key={n}>{n}</option>)}</select></label> : <>
          <label className="flex flex-col gap-1">{t('app.music.beat.ui.range')}<select className={input} value={range} onChange={e => { setRange(e.target.value); setSaved(null); }}><option value="song">{t('app.music.beat.ui.whole.song')}</option><option value="cycle" disabled={!displayed.cycle.on}>{t('app.music.beat.ui.cycle.range')}</option></select></label>
          {!displayed.cycle.on && <p className="text-sm text-vx-fg-muted">{t('app.music.beat.ui.turn.cycle.on.to.export.a.cycle.range')}</p>}
          <label className="flex flex-col gap-1">{t('app.music.beat.ui.output')}<select className={input} value={output} onChange={e => setOutput(e.target.value)}><option value="mix">{t('app.music.beat.ui.mix')}</option><option value="stems">{t('app.music.beat.ui.stems')}</option></select></label>
          <label className="flex flex-col gap-1">{t('app.music.beat.ui.bit.depth')}<select className={input} value={bitDepth} onChange={e => setBitDepth(Number(e.target.value))}><option value={16}>{t('app.music.beat.ui.16.bit')}</option><option value={24}>{t('app.music.beat.ui.24.bit')}</option></select></label>
          {output === 'stems' && <ul aria-label={t('app.music.beat.ui.stem.tracks')}>{tracks.map(beatTrack => <li key={beatTrack.id} className="py-2"><span role="group" aria-label={beatTrack.name} aria-disabled={!beatTrack.audible}>{beatTrack.name}{!beatTrack.audible && t('app.music.beat.ui.muted.in.the.mix')}</span></li>)}</ul>}
          {librarySave && <section className="space-y-3 border-t border-vx-border pt-4" aria-label={t('app.music.beat.ui.save.to.music.library')}>
            <label className="flex flex-col gap-1">{t('app.music.beat.ui.song.title')}<input className={input} maxLength={80} value={title} onChange={e => { setTitle(e.target.value); setSaved(null); }} aria-invalid={titleInvalid} aria-describedby="beat-export-title-error" /></label>
            {titleInvalid && <p id="beat-export-title-error" className="text-vx-danger">{t('app.music.beat.ui.enter.a.song.title.1.80.characters')}</p>}
            {sources?.hasTakes && <label className="flex min-h-11 items-center gap-3"><input className="h-6 w-6 accent-vx-accent focus-visible:ring-2 focus-visible:ring-vx-accent" type="checkbox" checked={rights} onChange={e => setRights(e.target.checked)} />{t('app.music.beat.ui.i.have.permission.to.use.the.recorded.or.imported.audio.in.this.mix')}</label>}
            {sources?.hasTakes && !rights && <p className="text-sm text-vx-fg-muted">{t('app.music.beat.ui.confirm.permission.before.saving')}</p>}
            <p className="text-sm text-vx-fg-muted">{t('app.music.beat.ui.save.uses.the.mix.at.16.bit.48.khz.stereo')}</p>
            {!online && <p>{t('app.music.beat.ui.saving.to.music.needs.a.connection.you.can.still.download.the.wav')}</p>}
            <button className={action} disabled={empty || !online || !sources || !title.trim() || title.normalize('NFKC').trim().length > 80 || (sources.hasTakes && !rights) || !!saved} onClick={() => run(true)}>{t('app.music.beat.ui.save.to.music.library')}</button>
          </section>}
        </>}
      </fieldset>
      {empty && kind === 'song' && <p className="my-3">{t('app.music.beat.ui.add.something.to.the.song.first')}</p>}
      {busy && <div className="my-3" aria-busy="true"><progress aria-label={progress} value={progressValue} max={100} className="w-full accent-vx-accent" /></div>}
      <p className="my-3" role="status">{progress}</p>
      {error && <p className="my-3 text-vx-danger">{error}</p>}
      {saved && <Link className={`${button} inline-flex items-center`} href={`/app/music/songs/${saved.song_id}`}>{t('app.music.beat.ui.open.in.music')}</Link>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button className={action} disabled={busy || !opened || (kind === 'song' && empty)} onClick={() => run()}>{t('app.music.beat.ui.download')}</button>
        {error && hasDownload && <button className={button} disabled={busy} onClick={() => run()}>{t('app.music.beat.ui.download.rendered.wav.instead')}</button>}
        <button className={button} disabled={busy} onClick={() => dialog.current.close()}>{t('app.music.beat.close')}</button>
      </div>
    </dialog>
  </>;
}
