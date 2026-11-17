'use client';
import { beatFailure } from '../../../_lib/music/beat/beatErrors.mjs';
import { useI18n } from '../../../../../components/I18nProvider';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getStoredUserId, onSessionChange } from '../../../../lib/authClient.js';
import { listCloudBeats, getCloudBeat, removeCloudBeat } from '../../../_lib/music/beat/beatCloud.js';
import { migrateBeat, validateBeat } from '../../../_lib/music/beat/beatDocument.mjs';
import * as store from '../../../_lib/music/beat/beatStore.js';
export function useBeatAccountList(cloud, router, announce, refreshDevice) {
  const { t } = useI18n();
  const [rows, setRows] = useState([]), [message, setMessage] = useState('');
  const lifetime = useRef(null);
  const [loaded, setLoaded] = useState(!cloud);
  const refresh = useCallback(async () => {
    const token = lifetime.current;
    if (!token?.userId) { setLoaded(true); return; }
    setLoaded(false);
    const current = () => lifetime.current === token && token.userId === getStoredUserId() && !token.signal.aborted;
    try {
      setMessage(t('app.music.beat.status.s66'));
      const result = await listCloudBeats(token);
      if (current()) { setRows(result.projects); setMessage(''); setLoaded(true); }
    } catch { if (current()) { setMessage(t('app.music.beat.status.s67')); setLoaded(true); } }
  }, [t]);
  useEffect(() => {
    if (!cloud) return;
    let controller;
    function session() {
      const userId = getStoredUserId();
      if (lifetime.current?.userId === userId) return;
      controller?.abort(); controller = new AbortController();
      lifetime.current = { userId, signal: controller.signal };
      setRows([]); setMessage(userId ? '' : t('app.music.beat.status.s68')); void refresh();
    }
    session(); const unsubscribe = onSessionChange(session);
    return () => { controller?.abort(); lifetime.current = null; unsubscribe(); };
  }, [cloud, refresh, t]);
  async function open(row) {
    const token = lifetime.current;
    try {
      const result = await getCloudBeat(row.beat_id, token);
      if (lifetime.current !== token || token.signal.aborted) return;
      const parsed = JSON.parse(result.doc_json);
      if (!validateBeat(parsed).ok || parsed.id !== row.beat_id) throw beatFailure('recovery-r12');
      const doc = migrateBeat(parsed), saved = await store.createBeat(doc, { userId: token.userId, projectId: result.project.id, revision: result.project.revision, syncedUpdatedAt: doc.updatedAt });
      if (lifetime.current !== token || token.signal.aborted) return;
      if (saved.error) { announce(saved.error === 'limit' ? t('app.music.beat.ui.this.device.has.50.beats.delete.one.to.make.room') : t('app.music.beat.status.s69')); await refreshDevice(); return; }
      router.push(`/app/music/beats/${doc.id}`);
    } catch { if (lifetime.current === token) announce(t('app.music.beat.status.s70')); }
  }
  async function remove(row) {
    if (!window.confirm(t('app.music.beat.status.s71', { p0: row.title }))) return;
    const token = lifetime.current;
    try {
      await removeCloudBeat(row.beat_id, row.revision, token);
      if (lifetime.current !== token || token.signal.aborted) return;
      announce(t('app.music.beat.status.s72')); await refresh();
    } catch { if (lifetime.current === token) { announce(t('app.music.beat.status.s73')); await refresh(); } }
  }
  return { rows, loaded, message, refresh, open, remove, userId: () => lifetime.current?.userId };
}
