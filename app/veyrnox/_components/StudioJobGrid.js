'use client';
import { JobAssetPreview } from './JobAssetPreview';
import { STATE_UI } from '../_lib/studioStates';
import { failedJobCopy } from '../_lib/createErrors';

// The studio canvas when one click made 2–4 images: one tile per job.
export function StudioJobGrid({ jobs, aspect }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {jobs.map((job, i) => {
        const ui = STATE_UI[job.state] || STATE_UI.running;
        const pending = job.state === 'queued' || job.state === 'running';
        return (
          <div
            key={job.job_id}
            className={`relative rounded-2xl border border-vx-border bg-vx-panel overflow-hidden ${pending ? 'vx-shimmer' : ''}`}
            style={{ aspectRatio: aspect.replace(':', '/') }}
          >
            {job.asset_url ? (
              <JobAssetPreview job={job} />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-center px-4">
                <div>
                  <div className={`font-vx-mono text-[10px] tracking-[0.14em] ${ui.tone === 'danger' ? 'text-vx-danger' : 'text-vx-accent'}`}>
                    <span aria-hidden="true">{ui.glyph}</span> {ui.label} · {i + 1}/{jobs.length}
                  </div>
                  {job.state === 'failed' && (
                    <div className="mt-2 text-xs text-vx-fg-body">
                      {failedJobCopy(job)}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
