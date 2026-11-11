'use client';

import Link from 'next/link';
import { MusicAudioPlayer } from './MusicAudioPlayer';

const LABEL = {
  queued: 'Queued',
  composing: 'Composing',
  mastering: 'Mastering',
  ready: 'Ready',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function tone(status) {
  if (status === 'ready') return 'bg-vx-accent/15 text-vx-accent';
  if (status === 'failed' || status === 'cancelled') return 'bg-vx-danger/15 text-vx-danger';
  return 'bg-vx-warn/15 text-vx-warn';
}

export function MusicCandidateCard({ song, onCancel, library = false }) {
  const active = ['queued', 'composing', 'mastering'].includes(song.status);
  return (
    <article data-testid={`music-candidate-${song.label}`} data-status={song.status} className="rounded-2xl border border-vx-border bg-vx-panel p-4 shadow-lg">
      <div className="flex min-w-0 items-start gap-3">
        <div aria-hidden="true" className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-vx-border bg-vx-panel-raised font-vx text-2xl font-black text-vx-accent">
          {song.label}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {song.status === 'ready' ? (
              <Link href={`/app/music/songs/${song.id}`} className="truncate font-bold text-vx-fg underline-offset-4 hover:underline">{song.title}</Link>
            ) : <h3 className="truncate font-bold text-vx-fg">{song.title}</h3>}
            <span className={`rounded-full px-2 py-1 text-xs font-bold ${tone(song.status)}`}>{LABEL[song.status]}</span>
          </div>
          <p className="mt-1 truncate text-sm text-vx-fg-muted">{song.styles || song.prompt}</p>
          {active && (
            <div className="mt-3">
              <div className="h-1.5 overflow-hidden rounded-full bg-vx-border" role="progressbar" aria-label={`Version ${song.label} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={song.progress}>
                <span className="block h-full rounded-full bg-vx-warn transition-[width]" style={{ width: `${song.progress}%` }} />
              </div>
              <p className="mt-2 text-xs text-vx-fg-muted">Version {song.label} progresses independently.</p>
            </div>
          )}
          {song.status === 'ready' && !library && <MusicAudioPlayer songId={song.id} title={`${song.title}, version ${song.label}`} compact />}
          {(song.status === 'failed' || song.status === 'cancelled') && (
            <p className="mt-3 text-sm font-semibold text-vx-danger">{song.refunded ? '5 credits returned to the preview balance.' : 'Refund pending.'}</p>
          )}
        </div>
        {active && onCancel ? (
          <button type="button" onClick={() => onCancel(song.id)} aria-label={`Cancel ${song.title}, version ${song.label}`} className="vx-press min-h-10 rounded-full border border-vx-border px-3 text-xs font-bold text-vx-fg-muted hover:border-vx-danger hover:text-vx-danger">
            Cancel
          </button>
        ) : null}
      </div>
    </article>
  );
}
