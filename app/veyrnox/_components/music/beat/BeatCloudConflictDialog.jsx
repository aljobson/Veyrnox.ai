'use client';
import { useEffect, useRef } from 'react';
import { action, button } from './beatStyles';
export default function BeatCloudConflictDialog({ sync }) {
  const dialog = useRef(null), open = Boolean(sync.conflict);
  useEffect(() => { if (open) dialog.current.showModal(); else dialog.current.close(); }, [open]);
  return <dialog ref={dialog} aria-labelledby="beat-conflict-title" onCancel={() => sync.later()}
    className="m-auto w-full max-w-lg space-y-4 rounded-2xl border border-vx-border bg-vx-panel p-6 text-vx-fg backdrop:bg-vx-base/80">
    <h2 id="beat-conflict-title" className="text-xl font-bold">Choose which beat to keep open</h2>
    <p>The account version changed. The other version will be saved in Versions.</p>
    {sync.detail && <p role="alert">{sync.detail}</p>}
    <div className="flex flex-wrap gap-3">
      <button className={`${action} min-h-11`} disabled={sync.busy} onClick={() => sync.resolve('mine')}>Keep mine</button>
      <button className={`${button} min-h-11`} disabled={sync.busy} onClick={() => sync.resolve('theirs')}>Load theirs</button>
    </div>
    {sync.busy && <p role="status">Saving your changes and takes to your account…</p>}
    <p className="text-sm text-vx-fg-muted">Press Escape to decide later. Your beat stays on this device.</p>
  </dialog>;
}
