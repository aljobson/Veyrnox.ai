'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gatewayFetch } from '../../_lib/gateway';
import { MusicDistributionDialog } from './MusicDistributionDialog';
import { MusicPublicationDialog } from './MusicPublicationDialog';
import { MusicCropDialog } from './MusicCropDialog';
import { MusicRenderDialog } from './MusicRenderDialog';
import { MusicCoverDialog } from './MusicCoverDialog';
import { MusicStemDialog } from './MusicStemDialog';
import { MusicTargetStemDialog } from './MusicTargetStemDialog';
import { MusicTrackAddDialog } from './MusicTrackAddDialog';
import { MusicExtendDialog } from './MusicExtendDialog';
import { MusicReplaceSectionDialog } from './MusicReplaceSectionDialog';
import { MusicAddSectionDialog } from './MusicAddSectionDialog';
import { MusicReuseDialog } from './MusicReuseDialog';
import { MusicSongActions } from './MusicSongActions';

const OPERATION_LABELS = {
  generation: 'Original generation',
  cover: 'Cover branch',
  extend: 'Extended branch',
  speed: 'Speed variation',
  fade: 'Faded version',
  reuse: 'Reused direction',
  crop: 'Cropped version',
  replace_section: 'Replaced section',
  add_section: 'Added section',
  remaster: 'Remastered version',
  lyric_edit: 'Lyric revision',
  reorder: 'Reordered sections',
};

function operationLabel(value) {
  return OPERATION_LABELS[value] || 'Version branch';
}

export function MusicServerSongDetail({ id }) {
  const [song, setSong] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [distributionMode, setDistributionMode] = useState(null);
  const lineageRef = useRef(null);
  const actionsTriggerRef = useRef(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSong(await gatewayFetch(`/music/songs/${id}`));
    } catch (reason) {
      setError(reason?.code === 'not_found'
        ? 'This private version is unavailable or belongs to another account.'
        : 'The private version could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const versions = useMemo(() => {
    if (Array.isArray(song?.versions) && song.versions.length) return song.versions;
    if (!song?.version_id) return [];
    return [{
      id: song.version_id,
      version_number: song.current_version?.version_number || 1,
      operation: song.current_version?.operation || 'generation',
      parent_version_id: song.current_version?.parent_version_id || null,
      is_current: true,
      created_at: song.current_version?.created_at || song.created_at,
    }];
  }, [song]);
  const lineage = Array.isArray(song?.lineage) ? song.lineage : [];

  const focusLineage = useCallback(() => {
    lineageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    lineageRef.current?.focus({ preventScroll: true });
  }, []);

  const closeDistribution = useCallback(() => {
    setDistributionMode(null);
    window.setTimeout(() => actionsTriggerRef.current?.focus(), 0);
  }, []);

  const crop = song?.provenance?.crop;
  const fade = song?.provenance?.fade;
  const speed = song?.provenance?.speed;
  const reorder = song?.provenance?.reorder;
  const remaster = song?.provenance?.remaster;
  const canonicalCrop = crop && song?.provenance?.render_state === 'canonical';
  const playbackUrl = crop && !canonicalCrop && Number.isFinite(Number(crop.start_seconds)) && Number.isFinite(Number(crop.end_seconds))
    ? `${song.audio_url}#t=${Number(crop.start_seconds)},${Number(crop.end_seconds)}` : song?.audio_url;

  useEffect(() => {
    if (!song || window.location.hash !== '#lineage') return;
    const timer = window.setTimeout(focusLineage, 0);
    return () => window.clearTimeout(timer);
  }, [focusLineage, song]);

  if (loading) return <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6" aria-busy="true"><div className="vx-shimmer h-96 rounded-2xl bg-vx-panel" /></div>;
  if (!song) return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <section role="alert" className="rounded-2xl border border-vx-border bg-vx-panel p-8"><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-danger">Private version unavailable</p><h1 className="mt-3 font-vx text-4xl font-black">This version cannot be opened.</h1><p className="mt-4 text-vx-fg-body">{error}</p><div className="mt-6 flex flex-wrap gap-3"><button type="button" onClick={load} className="min-h-11 rounded-full border border-vx-border px-5 font-bold">Retry</button><Link href="/app/music/library" className="inline-flex min-h-11 items-center rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink">Open Music Library</Link></div></section>
    </div>
  );
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <Link href="/app/music/library" className="text-sm font-bold text-vx-fg-muted underline-offset-4 hover:text-vx-fg hover:underline">← Music Library</Link>
      <article className="mt-6 overflow-hidden rounded-2xl border border-vx-border bg-vx-panel shadow-2xl">
        <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-2">
          <div className="grid min-h-72 place-items-center rounded-2xl border border-vx-border bg-vx-panel-raised"><div className="text-center"><span aria-hidden="true" className="font-vx text-8xl font-black text-vx-accent">♪</span><p className="mt-3 font-vx-mono text-xs uppercase tracking-widest text-vx-fg-muted">Private server version</p></div></div>
          <div className="min-w-0 self-center">
            <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-vx-accent/15 px-3 py-1 text-xs font-bold text-vx-accent">Ready</span><span className="rounded-full border border-vx-border px-3 py-1 text-xs text-vx-fg-muted">Private</span></div>
            <div className="mt-4 flex items-start gap-3"><h1 className="min-w-0 flex-1 break-words font-vx text-4xl font-black tracking-tight sm:text-5xl">{song.title}</h1><MusicSongActions songId={song.id} jobId={song.job_id} title={song.title} actions={song.actions} onViewLineage={focusLineage} onShare={() => setDistributionMode('share')} onDownload={() => setDistributionMode('download')} onPublish={() => setDistributionMode('publish')} onCover={() => setDistributionMode('cover')} onExtend={() => setDistributionMode('extend')} onReplace={() => setDistributionMode('replace')} onAddSection={() => setDistributionMode('add-section')} onReuse={() => setDistributionMode('reuse')} onStems={() => setDistributionMode('stems')} onTargetStem={() => setDistributionMode('target-stem')} onAddTrack={() => setDistributionMode('add-track')} onCrop={() => setDistributionMode('crop')} onRender={() => setDistributionMode('render')} externalTriggerRef={actionsTriggerRef} /></div>
            <dl className="mt-6 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2"><div className="rounded-2xl bg-vx-base p-3"><dt className="text-vx-fg-muted">Created</dt><dd className="mt-1 text-vx-fg">{new Date(song.created_at).toLocaleDateString()}</dd></div><div className="rounded-2xl bg-vx-base p-3"><dt className="text-vx-fg-muted">Visibility</dt><dd className="mt-1 capitalize text-vx-fg">{String(song.visibility || 'private').replace('_', ' ')}</dd></div></dl>
          </div>
        </div>
        <div className="border-t border-vx-border p-6 sm:p-8"><audio className="w-full" controls preload="metadata" src={playbackUrl} aria-label={`Play ${song.title}`} />{crop ? <p className="mt-2 text-xs text-vx-fg-muted">{canonicalCrop ? `Rendered WAV master from ${Number(crop.start_seconds).toFixed(1)}s–${Number(crop.end_seconds).toFixed(1)}s · the original remains in version history.` : `Preview range ${Number(crop.start_seconds).toFixed(1)}s–${Number(crop.end_seconds).toFixed(1)}s · export requires a rendered master.`}</p> : null}{fade ? <p className="mt-2 text-xs text-vx-fg-muted">Rendered WAV master · {Number(fade.fade_in_seconds).toFixed(1)}s fade in · {Number(fade.fade_out_seconds).toFixed(1)}s fade out · source preserved in history.</p> : null}{speed ? <p className="mt-2 text-xs text-vx-fg-muted">Rendered WAV master at {Number(speed.speed_ratio).toFixed(2)}× speed and linked pitch · source preserved in history.</p> : null}{reorder ? <p className="mt-2 text-xs text-vx-fg-muted">Rendered WAV master · split at {Number(reorder.split_seconds).toFixed(1)}s and moved section 2 before section 1 · source preserved in history.</p> : null}{remaster ? <p className="mt-2 text-xs text-vx-fg-muted">Remastered WAV · DC-corrected with linked gain to {Number(remaster.target_peak_dbfs).toFixed(0)} dBFS peak · source preserved in history.</p> : null}</div>
        <section id="lineage" ref={lineageRef} tabIndex={-1} aria-labelledby="lineage-title" className="border-t border-vx-border p-6 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-vx-accent sm:p-8">
          <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Recoverable history</p>
          <h2 id="lineage-title" className="mt-2 font-vx text-2xl font-black">Version lineage</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-vx-fg-muted">Every creative branch is a separate record. Earlier audio stays intact until you explicitly remove it.</p>
          <ol className="mt-6 space-y-3">
            {versions.map((version) => (
              <li key={version.id} className="rounded-2xl border border-vx-border bg-vx-base p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-vx font-black text-vx-fg">Version {version.version_number}</span>
                  {version.is_current ? <span className="rounded-full bg-vx-accent/15 px-2 py-1 text-xs font-bold text-vx-accent">Current</span> : null}
                  <span className="rounded-full border border-vx-border px-2 py-1 text-xs text-vx-fg-muted">{operationLabel(version.operation)}</span>
                </div>
                <p className="mt-2 text-xs text-vx-fg-muted">{new Date(version.created_at || song.created_at).toLocaleString()}</p>
                {version.parent_version_id ? <p className="mt-2 break-all text-xs text-vx-fg-faint">Parent version: {version.parent_version_id}</p> : <p className="mt-2 text-xs text-vx-fg-faint">No parent version · original branch</p>}
              </li>
            ))}
          </ol>
          {lineage.length ? (
            <div className="mt-6">
              <h3 className="font-vx text-lg font-black">Source links</h3>
              <ul className="mt-3 space-y-2">
                {lineage.map((edge) => <li key={edge.id} className="rounded-xl border border-vx-border bg-vx-panel-raised p-3 text-sm text-vx-fg-body"><strong className="text-vx-fg">{edge.source_title}</strong> · version {edge.source_version_number} → {operationLabel(versions.find((version) => version.id === edge.output_version_id)?.operation)}</li>)}
              </ul>
            </div>
          ) : <p className="mt-6 rounded-xl border border-dashed border-vx-border p-4 text-sm text-vx-fg-muted">This is an original generation with no source version.</p>}
        </section>
      </article>
      {distributionMode === 'publish' ? <MusicPublicationDialog song={song} onClose={closeDistribution} /> : null}
      {distributionMode === 'cover' ? <MusicCoverDialog song={song} onClose={closeDistribution} onSaved={load} /> : null}
      {distributionMode === 'extend' ? <MusicExtendDialog song={song} onClose={closeDistribution} onSaved={load} /> : null}
      {distributionMode === 'replace' ? <MusicReplaceSectionDialog song={song} onClose={closeDistribution} onSaved={load} /> : null}
      {distributionMode === 'add-section' ? <MusicAddSectionDialog song={song} onClose={closeDistribution} onSaved={load} /> : null}
      {distributionMode === 'reuse' ? <MusicReuseDialog song={song} onClose={closeDistribution} /> : null}
      {distributionMode === 'stems' ? <MusicStemDialog song={song} onClose={closeDistribution} /> : null}
      {distributionMode === 'target-stem' ? <MusicTargetStemDialog song={song} onClose={closeDistribution} /> : null}
      {distributionMode === 'add-track' ? <MusicTrackAddDialog song={song} onClose={closeDistribution} /> : null}
      {distributionMode === 'crop' ? <MusicCropDialog song={song} onClose={closeDistribution} onSaved={load} /> : null}
      {distributionMode === 'render' ? <MusicRenderDialog song={song} onClose={closeDistribution} onSaved={load} /> : null}
      {distributionMode && !['publish', 'cover', 'extend', 'replace', 'add-section', 'reuse', 'stems', 'target-stem', 'add-track', 'crop', 'render'].includes(distributionMode) ? <MusicDistributionDialog mode={distributionMode} song={song} onClose={closeDistribution} /> : null}
    </div>
  );
}
