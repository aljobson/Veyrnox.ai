'use client';
import Link from 'next/link';
import { JobAssetPreview } from '../JobAssetPreview';
import { StudioJobGrid } from '../StudioJobGrid';
import { failedJobCopy } from '../../_lib/createErrors';
import { jobStateUi } from '../../_lib/studioStates';

const labels = { image: 'image', video: 'video', audio: 'audio' };

export function MediaCanvas({ kind, media }) {
  const { jobs, generating, model, aspect, clearJobs } = media;
  const job = jobs.length === 1 ? jobs[0] : null;
  const label = labels[kind] || 'media';

  if (!jobs.length) {
    return (
      <div className="mx-auto flex h-full max-w-[760px] flex-col items-center justify-center px-4 py-12 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full border border-vx-border text-2xl text-vx-accent" aria-hidden="true">
          {kind === 'video' ? '▷' : kind === 'audio' ? '◖' : '▧'}
        </div>
        <h1 className="vx-display mt-5 text-[32px]">Create {label} in Chat</h1>
        <p className="mt-2 max-w-xl text-vx-fg-muted">Choose a model and the controls it supports below. The displayed price includes the selected length and quantity, and every finished result is saved to your Library.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[760px] space-y-3 px-4 py-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-vx-mono text-[10px] uppercase tracking-[0.14em] text-vx-fg-muted">{model?.name || 'Generation'}</p>
          <h1 className="mt-1 text-xl font-black">{generating ? `Creating ${label}` : job?.state === 'failed' ? 'Generation failed' : `${label[0].toUpperCase()}${label.slice(1)} ready`}</h1>
        </div>
        {!generating && <button type="button" onClick={clearJobs} className="rounded-full border border-vx-border px-3 py-1.5 text-xs font-semibold text-vx-fg-muted hover:text-vx-fg">Clear result</button>}
      </div>

      {jobs.length > 1 ? <StudioJobGrid jobs={jobs} aspect={aspect || '1:1'} /> : (
        <div className={`relative overflow-hidden rounded-2xl border border-vx-border bg-vx-panel ${generating ? 'vx-shimmer' : ''}`}
          style={kind === 'audio' ? { minHeight: '12rem' } : { aspectRatio: (aspect || '1:1').replace(':', '/') }}>
          {job?.asset_url ? <JobAssetPreview job={job} /> : (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
              <div>
                <p className={`font-vx-mono text-[11px] uppercase tracking-[0.14em] ${job?.state === 'failed' ? 'text-vx-danger' : 'text-vx-accent'}`}>
                  <span aria-hidden="true">{jobStateUi(job).glyph}</span> {jobStateUi(job).label}
                </p>
                {job?.state === 'failed'
                  ? <p className="mt-2 text-sm text-vx-fg-body">{failedJobCopy(job)}</p>
                  : <><p className="mt-3 text-4xl font-black">…</p><p className="mt-2 text-xs text-vx-fg-muted">You can switch back to Chat while this runs.</p></>}
              </div>
            </div>
          )}
        </div>
      )}
      {!generating && jobs.some((item) => item.state === 'succeeded') && (
        <p className="text-right text-xs text-vx-fg-muted">Saved automatically · <Link href="/app/library" className="text-vx-accent hover:underline">Open Library</Link></p>
      )}
    </div>
  );
}
