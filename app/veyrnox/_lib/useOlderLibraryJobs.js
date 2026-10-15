'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { gatewayFetch } from './gateway';
import { getStoredUserId } from '../../lib/authClient';
import { jobsPagePath } from '../../../lib/jobListCursor';

export function useOlderLibraryJobs({ actor, nextCursor, setNextCursor, setRows, setVisible, hydrateFromHistory, pageSize }) {
  const request = useRef(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    request.current = null; setLoading(false); setError('');
    return () => { request.current = null; };
  }, [actor]);
  const loadOlder = useCallback(async () => {
    if (!actor || !nextCursor || request.current) return;
    const pending = { actor };
    request.current = pending; setLoading(true); setError('');
    const current = () => request.current === pending && getStoredUserId() === actor;
    try {
      const page = await gatewayFetch(jobsPagePath(nextCursor, pageSize * 2));
      if (!current()) return;
      if (!Array.isArray(page.jobs) || (page.next && jobsPagePath(page.next) === jobsPagePath(nextCursor))) throw new Error('invalid_page');
      setRows((prev) => {
        const seen = new Set(prev.map((r) => r.job_id));
        const older = page.jobs.filter((j) => !seen.has(j.job_id)).map((j) => ({
          ...hydrateFromHistory({ job_id: j.job_id, model_id: j.model_id, credits: j.credits }),
          name: j.label, prompt: j.label, submitted_at: Date.parse(j.created_at) || undefined,
          state: j.state, refunded: j.refunded, error_code: j.error_code, has_asset: j.has_asset, held: j.held,
          asset_expires_at: j.asset_expires_at,
        }));
        return [...prev, ...older];
      });
      setVisible((v) => v + pageSize * 2); setNextCursor(page.next || null);
    } catch (e) {
      if (current()) setError(e.status === 429
        ? `Too many requests. Wait ${e.retryAfter || 60} seconds, then try Load older again.`
        : 'Older jobs could not be loaded. Your current items are unchanged. Try Load older again.');
    } finally {
      if (current()) { request.current = null; setLoading(false); }
    }
  }, [actor, nextCursor, setNextCursor, setRows, setVisible, hydrateFromHistory, pageSize]);
  return { loadOlder, loadingOlder: loading, olderError: error };
}
