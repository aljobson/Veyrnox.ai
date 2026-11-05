'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { gatewayFetch } from '../../_lib/gateway.js';
import { onSocialBrandChange, getSocialBrandRevision, getSocialBrandSnapshot, assertSocialBrandSnapshot } from '../../../lib/socialBrandSelection.js';

const refreshListeners = new Set();
let refreshRevision = 0;
const subscribeRefresh = listener => { refreshListeners.add(listener); return () => refreshListeners.delete(listener); };
const getRefreshRevision = () => refreshRevision;
const refresh = () => { refreshRevision += 1; for (const listener of refreshListeners) listener(); };

export const useSocialBrandRevision = () => useSyncExternalStore(onSocialBrandChange, getSocialBrandRevision, () => 0);
export function usePublishBrandKit(withWorkspaces = false) {
  const revision = useSocialBrandRevision();
  const attempt = useSyncExternalStore(subscribeRefresh, getRefreshRevision, () => 0);
  const [record, setRecord] = useState(null);
  useEffect(() => {
    let active = true;
    const snapshot = getSocialBrandSnapshot();
    Promise.resolve().then(async () => {
      if (!active) return;
      const data = await gatewayFetch('/social/brand-kit', {}, false, snapshot);
      // The server lists only workspaces the link RPC accepts (editor-level roles).
      const workspaces = withWorkspaces && data.canLink ? data.workspaces || [] : [];
      assertSocialBrandSnapshot(snapshot);
      if (active) setRecord({ revision, attempt, snapshot, status: 'ready', data, workspaces });
    }).catch(error => {
      try { assertSocialBrandSnapshot(snapshot); } catch { return; }
      if (active) setRecord({ revision, attempt, snapshot, status: error?.status === 404 ? 'hidden' : 'error' });
    });
    return () => { active = false; };
  }, [revision, attempt, withWorkspaces]);
  return { ...(record?.revision === revision && record?.attempt === attempt ? record : { status: 'loading' }), reload: refresh };
}
