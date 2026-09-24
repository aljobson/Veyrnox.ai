'use client';
import { useEffect, useRef, useState } from 'react';
import { gatewayFetch } from './gateway';
import { createAssetRefresher } from './assetRefresh';

export function useAssetUrl(jobId, sourceUrl) {
  const [state, setState] = useState({ jobId, sourceUrl, url: sourceUrl, loading: false, error: null });
  const active = useRef(null);
  useEffect(() => {
    setState({ jobId, sourceUrl, url: sourceUrl, loading: false, error: null });
    const refresher = createAssetRefresher({
      jobId,
      fetchAsset: (id) => gatewayFetch(`/jobs/${encodeURIComponent(id)}/asset`),
      onChange: (patch) => setState((previous) => ({ ...previous, ...patch })),
    });
    active.current = refresher;
    return () => { refresher.dispose(); active.current = null; };
  }, [jobId, sourceUrl]);
  // Never paint the previous job's URL while the reset effect is pending.
  const current = state.jobId === jobId && state.sourceUrl === sourceUrl
    ? state : { url: sourceUrl, loading: false, error: null };
  return {
    ...current,
    onLoad: () => { active.current?.loaded(); },
    onError: () => { active.current?.refresh(); },
    retry: () => { active.current?.refresh(true); },
  };
}
