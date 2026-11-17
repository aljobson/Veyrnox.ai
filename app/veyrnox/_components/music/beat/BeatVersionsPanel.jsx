'use client';
import { useEffect, useRef, useState } from 'react';
import { onSessionChange } from '../../../../lib/authClient.js';
import { listVersions, getVersion } from '../../../_lib/music/beat/beatCloud.js';
import { validateBeat, migrateBeat } from '../../../_lib/music/beat/beatDocument.mjs';
import { restoreVersion } from '../../../_lib/music/beat/beatOps.mjs';
import { reconcileBeatTakes } from '../../../_lib/music/beat/beatTakeStore.js';
import { versionReason, versionTime } from '../../../_lib/music/beat/beatVersionLabels.mjs';
import { action, button } from './beatStyles';
export default function BeatVersionsPanel({ beatId, project, sync }) {
  const dialog = useRef(null), [rows, setRows] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => onSessionChange(() => { setRows([]); setError(''); dialog.current?.close(); }), []);
  async function load() {
    const token = sync.options();
    setError('');
    if (!token?.userId) { setRows([]); setError('Sign in to see saved versions.'); return; }
    setBusy(true);
    try {
      const result = await listVersions(beatId, token);
      if (sync.current(token)) setRows(result.versions);
    } catch { if (sync.current(token)) setError(navigator.onLine ? 'Could not load versions. Retry.' : 'You are offline. Connect to load versions.'); }
    finally { setBusy(false); }
  }
  async function restore(row) {
    const token = sync.options(); setBusy(true); setError('');
    try {
      await project.finishRecording();
      const result = await getVersion(beatId, row.id, token);
      if (!sync.current(token)) return;
      const doc = JSON.parse(result.doc_json);
      if (!validateBeat(doc).ok || doc.id !== beatId) throw new Error('Invalid version');
      await reconcileBeatTakes(doc);
      if (!sync.current(token)) return;
      if (project.edit(current => restoreVersion(current, migrateBeat(doc)), { label: 'restore version' })) dialog.current.close();
    } catch { if (sync.current(token)) setError('Could not restore this version. Retry.'); }
    finally { setBusy(false); }
  }
  return <>
    <button className={button} onClick={() => { dialog.current.showModal(); void load(); }}>Versions</button>
    <dialog ref={dialog} aria-labelledby="beat-versions-title" className="m-auto max-h-[80vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-vx-border bg-vx-panel p-6 text-vx-fg backdrop:bg-vx-base/80">
      <header className="flex items-center justify-between gap-4"><h2 id="beat-versions-title" className="text-xl font-bold">Versions</h2><button className={button} onClick={() => dialog.current.close()}>Close</button></header>
      <button className={action} disabled={busy || sync.busy || !sync.userId || Boolean(sync.conflict)} onClick={async () => { await sync.checkpoint(); await load(); }}>Save version now</button>
      {busy && <p role="status">Loading versions…</p>}
      {error && <p role="alert">{error} <button className={button} onClick={load}>Retry</button></p>}
      {!busy && !error && !rows.length && <p>No saved versions yet</p>}
      <ul className="space-y-3">{rows.map(row => <li key={row.id} className="space-y-2 border-b border-vx-border py-3">
        <p>{row.title}</p><p className="text-sm text-vx-fg-muted">{versionTime(row.saved_at)} · revision {row.revision} · {versionReason(row.reason)}</p>
        <button className={button} disabled={busy} onClick={() => restore(row)}>Restore</button>
      </li>)}</ul>
    </dialog>
  </>;
}
