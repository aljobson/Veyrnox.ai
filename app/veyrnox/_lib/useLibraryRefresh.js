'use client';

// A creation finished or started on the phone shows here when this tab is looked at again: the first page of the account
// list is read again (at most every REFRESH_MIN_MS) and merged in, never replacing rows already loaded. Favourites are
// read again with it (ADR-0340). Offline or unreachable: the rows already shown stand.
import { useEffect, useRef } from 'react';
import { getStoredUserId } from '../../lib/authClient.js';
import { gatewayFetch } from './gateway';
import { readJobHistory } from './jobHistory';
import { mergeHydrated } from './jobWindow';
import { serverRow } from './libraryRows';

export const REFRESH_MIN_MS = 15000;

export function useLibraryRefresh({ actor, pageSize, setRows, setListLive, syncFavourites }) {
  const last = useRef(0);
  useEffect(() => {
    if (!actor) return undefined;
    const refresh = async () => {
      if (document.visibilityState !== 'visible' || Date.now() - last.current < REFRESH_MIN_MS) return;
      last.current = Date.now();
      try {
        const page = await gatewayFetch(`/jobs?limit=${pageSize}`);
        if (!Array.isArray(page.jobs) || getStoredUserId() !== actor) return;
        const labels = new Map(readJobHistory().map((h) => [h.job_id, h]));
        const fresh = page.jobs.map((j) => serverRow(j, labels.get(j.job_id) || {}));
        setRows((prev) => mergeHydrated(prev, fresh));
        setListLive(true);
      } catch { /* the rows already shown stand */ }
      void syncFavourites();
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => { document.removeEventListener('visibilitychange', refresh); window.removeEventListener('focus', refresh); };
  }, [actor, pageSize, setRows, setListLive, syncFavourites]);
}
