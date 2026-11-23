'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { gatewayFetch, notifyBalanceChanged } from './gateway';
import { getSession, onSessionChange } from '../../lib/authClient';
import { useResultPresence } from './resultPresence';
import { markJobSettled } from './jobHistory';

// Consecutive failed poll ticks before we stop and tell the user (~1 minute
// at 2s). Offline or against a 500 the shimmer used to spin forever, and each
// failed call re-dispatched veyrnox:auth-required, so a dismissed sign-in
// modal reappeared every 2 seconds. Give up like TopUpPacks does.
export const POLL_GIVE_UP_AFTER = 30;
const POLL_MS = 2000;

const isPending = (state) => state === 'queued' || state === 'running';

/**
 * The studio's jobs: [{ job_id, state, credits, model_id, error_code?, asset_url?, mime_type? }].
 * Every in-flight job is polled from ONE interval.
 */
export function useStudioJobs({ onUnreachable }) {
  const [jobs, setJobs] = useState([]);
  const unreachable = useRef(onUnreachable);
  const assetReads = useRef(new Map());
  const stopAssetReads = useCallback(() => {
    for (const read of assetReads.current.values()) { read.controller.abort(); clearTimeout(read.timer); }
    assetReads.current.clear();
  }, []);
  useEffect(() => stopAssetReads, [stopAssetReads]);
  useEffect(() => { unreachable.current = onUnreachable; }, [onUnreachable]);

  useResultPresence(jobs.map(j => j.job_id));
  useEffect(() => {
    let owner = getSession()?.user?.id;
    return onSessionChange(session => {
      if (owner !== session?.user?.id) { owner = session?.user?.id; stopAssetReads(); setJobs([]); }
    });
  }, [stopAssetReads]);
  const retryAsset = useCallback(id => {
    const read = assetReads.current.get(id);
    read?.controller.abort(); clearTimeout(read?.timer);
    assetReads.current.delete(id);
    setJobs(prev => prev.map(j => j.job_id === id ? { ...j, asset_error: false } : j));
  }, []);
  useEffect(() => {
    const reads = assetReads.current;
    const active = new Set(jobs.map(j => j.job_id));
    for (const [id, read] of reads) if (!active.has(id)) {
      read.controller.abort(); clearTimeout(read.timer); reads.delete(id);
    }
    // Each id owns its request and retry timer. Another job finishing must not
    // restart this read, nor consume one of its three actual failure attempts.
    for (const job of jobs) {
      const id = job.job_id;
      if (job.state !== 'succeeded' || job.asset_url || job.asset_error || reads.has(id)) continue;
      const read = { controller: new AbortController(), failures: 0, status: 'loading', timer: null };
      reads.set(id, read);
      const live = () => reads.get(id) === read && !read.controller.signal.aborted;
      const patch = fields => { if (live()) setJobs(prev => prev.map(j => j.job_id === id ? { ...j, ...fields } : j)); };
      async function fetchAsset() {
        if (!live()) return;
        patch({ asset_loading: true });
        try {
          const asset = await gatewayFetch(`/jobs/${id}/asset`, { signal: read.controller.signal });
          if (!live()) return;
          if (!asset?.url) throw Error('asset_unavailable');
          read.status = 'ready';
          patch({ asset_url: asset.url, mime_type: asset.mime_type, asset_loading: false });
        } catch (error) {
          if (!live()) return;
          if (error?.name !== 'AbortError') read.failures++;
          if (read.failures >= 3) {
            read.status = 'error';
            patch({ asset_loading: false, asset_error: true });
          } else read.timer = setTimeout(fetchAsset, 1000 * Math.max(1, read.failures));
        }
      }
      void fetchAsset();
    }
  }, [jobs]);

  const generating = jobs.some((j) => isPending(j.state));
  const pendingKey = jobs.filter((j) => isPending(j.state)).map((j) => j.job_id).join(',');

  // A new click's first accepted job replaces the last click's (settled) jobs;
  // the rest of its batch is appended. Until then the old result stays shown.
  const startJobs = useCallback((job) => { stopAssetReads(); setJobs([job]); }, [stopAssetReads]);
  const addJob = useCallback((job) => setJobs((prev) => [...prev, job]), []);
  const clearJobs = useCallback(() => { stopAssetReads(); setJobs([]); }, [stopAssetReads]);

  useEffect(() => {
    if (!pendingKey) return undefined;
    const ids = pendingKey.split(',');
    const patch = (id, fields) => setJobs((prev) => prev.map((j) => (j.job_id === id ? { ...j, ...fields } : j)));
    let failures = 0;
    let busy = false;
    let stopped = false;

    async function pollOne(id) {
      const next = await gatewayFetch(`/jobs/${id}`);
      if (stopped || !['queued', 'running', 'succeeded', 'failed'].includes(next.state)) return;
      patch(id, next);
      void markJobSettled(id, next.state, next.error_code, next.credits, next.refunded);
      if (next.state !== 'succeeded' && next.state !== 'failed') return;
      notifyBalanceChanged();

    }

    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      let failed = false;
      // A settled job changes pendingKey, which restarts this effect; the
      // stopped check keeps the old tick from polling ids the new one owns.
      for (const id of ids) {
        if (stopped) break;
        try {
          await pollOne(id);
        } catch (e) {
          failed = true;
          console.error('[create/poll] failed', e);
        }
      }
      busy = false;
      failures = failed ? failures + 1 : 0;
      if (failures >= POLL_GIVE_UP_AFTER && !stopped) {
        stopped = true;
        clearInterval(timer);
        unreachable.current?.();
      }
    }, POLL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, [pendingKey]);

  const results = useMemo(() => jobs.map(j => ({ ...j, retryAsset: () => retryAsset(j.job_id) })), [jobs, retryAsset]);
  return { jobs: results, generating, startJobs, addJob, clearJobs };
}
