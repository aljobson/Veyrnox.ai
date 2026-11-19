'use client';
import { assertBeatWritable, BEAT_READ_ONLY_MESSAGE } from '../../../_lib/music/beat/beatCompatibility.mjs';
import { parseCloudBeat, errorState } from '../../../_lib/music/beat/beatCloudRules.mjs';
import { BEAT_ACTIONS } from '../../../_lib/music/beat/beatActionLabels.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

import { useEffect, useRef, useState } from 'react';
import { onSessionChange } from '../../../../lib/authClient.js';
import { listVersions, getVersion } from '../../../_lib/music/beat/beatCloud.js';
import { restoreVersion } from '../../../_lib/music/beat/beatOps.mjs';
import { versionReason, versionTime } from '../../../_lib/music/beat/beatVersionLabels.mjs';
import { action, button } from './beatStyles';
export default function BeatVersionsPanel({ beatId, project, sync }) {
  const { t, locale } = useI18n();
  const dialog = useRef(null), [rows, setRows] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => onSessionChange(() => { setRows([]); setError(''); dialog.current?.close(); }), []);
  async function load() {
    const token = sync.options();
    setError('');
    if (!token?.userId) { setRows([]); setError(t('app.music.beat.status.s57')); return; }
    setBusy(true);
    try {
      const result = await listVersions(beatId, token);
      if (sync.current(token)) setRows(result.versions);
    } catch { if (sync.current(token)) setError(navigator.onLine ? t('app.music.beat.status.s58') : t('app.music.beat.status.s59')); }
    finally { setBusy(false); }
  }
  async function restore(row) {
    const token = sync.options(); setBusy(true); setError('');
    try {
      assertBeatWritable(project.current?.current || project.doc);
      await project.finishRecording();
      const result = await getVersion(beatId, row.id, token);
      if (!sync.current(token)) return;
      const doc = parseCloudBeat(result.doc_json, beatId);
      assertBeatWritable(doc);
      if (project.edit(current => restoreVersion(current, doc), { label: BEAT_ACTIONS.a38 })) dialog.current.close();
    } catch (error) { if (sync.current(token)) setError(t(errorState(error) === 'read_only' ? BEAT_READ_ONLY_MESSAGE : errorState(error) === 'update_required' ? 'app.music.beat.compat.updateRequired' : 'app.music.beat.status.s60')); }
    finally { setBusy(false); }
  }
  return <>
    <button data-beat-read className={button} onClick={() => { dialog.current.showModal(); void load(); }}>{t('app.music.beat.ui.versions')}</button>
    <dialog ref={dialog} aria-labelledby="beat-versions-title" className="m-auto max-h-[80vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-vx-border bg-vx-panel p-6 text-vx-fg backdrop:bg-vx-base/80">
      <header className="flex items-center justify-between gap-4"><h2 id="beat-versions-title" className="text-xl font-bold">{t('app.music.beat.ui.versions')}</h2><button data-beat-read className={button} onClick={() => dialog.current.close()}>{t('app.music.beat.close')}</button></header>
      <button className={action} title={project.readOnly ? t(BEAT_READ_ONLY_MESSAGE) : undefined} disabled={project.readOnly || busy || sync.busy || !sync.userId || Boolean(sync.conflict)} onClick={async () => { await sync.checkpoint(); await load(); }}>{t('app.music.beat.ui.save.version.now')}</button>
      {busy && <p role="status">{t('app.music.beat.ui.loading.versions')}</p>}
      {error && <p role="alert">{error} <button className={button} onClick={load}>{t('app.music.beat.ui.retry')}</button></p>}
      {!busy && !error && !rows.length && <p>{t('app.music.beat.ui.no.saved.versions.yet')}</p>}
      <ul className="space-y-3">{rows.map(row => <li key={row.id} className="space-y-2 border-b border-vx-border py-3">
        <p>{row.title}</p><p className="text-sm text-vx-fg-muted">{versionTime(row.saved_at, new Date(), t, locale === 'en' ? undefined : locale)}{t('app.music.beat.ui.revision')}{row.revision} · {versionReason(row.reason, t)}</p>
        <button className={button} title={project.readOnly ? t(BEAT_READ_ONLY_MESSAGE) : undefined} disabled={project.readOnly || busy} onClick={() => restore(row)}>{t('app.music.beat.ui.restore')}</button>
      </li>)}</ul>
    </dialog>
  </>;
}
