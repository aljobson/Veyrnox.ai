'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getStoredUserId, onSessionChange } from '../../../../lib/authClient.js';
import { listCloudBeats, getCloudBeat, removeCloudBeat } from '../../../_lib/music/beat/beatCloud.js';
import { migrateBeat, validateBeat } from '../../../_lib/music/beat/beatDocument.mjs';
import * as store from '../../../_lib/music/beat/beatStore.js';
export function useBeatAccountList(cloud, router, announce, refreshDevice) {
  const [rows, setRows] = useState([]), [message, setMessage] = useState('');
  const lifetime = useRef(null);
  const refresh = useCallback(async () => {
    const token = lifetime.current;
    if (!token?.userId) return;
    const current = () => lifetime.current === token && token.userId === getStoredUserId() && !token.signal.aborted;
    try {
      setMessage('Loading account beats…');
      const result = await listCloudBeats(token);
      if (current()) { setRows(result.projects); setMessage(''); }
    } catch { if (current()) setMessage('Could not load account beats. Connect to the internet and Retry.'); }
  }, []);
  useEffect(() => {
    if (!cloud) return;
    let controller;
    function session() {
      const userId = getStoredUserId();
      if (lifetime.current?.userId === userId) return;
      controller?.abort(); controller = new AbortController();
      lifetime.current = { userId, signal: controller.signal };
      setRows([]); setMessage(userId ? '' : 'Sign in to see beats in your account.'); void refresh();
    }
    session(); const unsubscribe = onSessionChange(session);
    return () => { controller?.abort(); lifetime.current = null; unsubscribe(); };
  }, [cloud, refresh]);
  async function open(row) {
    const token = lifetime.current;
    try {
      const result = await getCloudBeat(row.beat_id, token);
      if (lifetime.current !== token || token.signal.aborted) return;
      const parsed = JSON.parse(result.doc_json);
      if (!validateBeat(parsed).ok || parsed.id !== row.beat_id) throw new Error('Invalid beat');
      const doc = migrateBeat(parsed), saved = await store.createBeat(doc, { userId: token.userId, projectId: result.project.id, revision: result.project.revision, syncedUpdatedAt: doc.updatedAt });
      if (lifetime.current !== token || token.signal.aborted) return;
      if (saved.error) { announce(saved.error === 'limit' ? 'This device has 50 beats. Delete one to make room.' : 'This beat is already on this device. Open its device copy.'); await refreshDevice(); return; }
      router.push(`/app/music/beats/${doc.id}`);
    } catch { if (lifetime.current === token) announce('Could not open the account beat. Retry.'); }
  }
  async function remove(row) {
    if (!window.confirm(`Remove “${row.title}” from your account? Its versions and takes will also be removed.`)) return;
    const token = lifetime.current;
    try {
      await removeCloudBeat(row.beat_id, row.revision, token);
      if (lifetime.current !== token || token.signal.aborted) return;
      announce('Removed from your account. Device copies stay on their devices.'); await refresh();
    } catch { if (lifetime.current === token) { announce('Could not remove this beat. Refresh and try again.'); await refresh(); } }
  }
  return { rows, message, refresh, open, remove, userId: () => lifetime.current?.userId };
}
