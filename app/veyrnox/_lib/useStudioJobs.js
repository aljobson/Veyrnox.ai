'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { gatewayFetch, notifyBalanceChanged } from './gateway';
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
  useEffect(() => { unreachable.current = onUnreachable; }, [onUnreachable]);

  const generating = jobs.some((j) => isPending(j.state));
  const pendingKey = jobs.filter((j) => isPending(j.state)).map((j) => j.job_id).join(',');

  // A new click's first accepted job replaces the last click's (settled) jobs;
  // the rest of its batch is appended. Until then the old result stays shown.
  const startJobs = useCallback((job) => setJobs([job]), []);
  const addJob = useCallback((job) => setJobs((prev) => [...prev, job]), []);
  const clearJobs = useCallback(() => setJobs([]), []);

  useEffect(() => {
    if (!pendingKey) return undefined;
    const ids = pendingKey.split(',');
    const patch = (id, fields) => setJobs((prev) => prev.map((j) => (j.job_id === id ? { ...j, ...fields } : j)));
    let failures = 0;
    let busy = false;
    let stopped = false;

    async function pollOne(id) {
      const next = await gatewayFetch(`/jobs/${id}`);
      patch(id, next);
      if (next.state !== 'succeeded' && next.state !== 'failed') return;
      markJobSettled(id, next.state);
      notifyBalanceChanged();
      if (next.state === 'succeeded') {
        const asset = await gatewayFetch(`/jobs/${id}/asset`);
        patch(id, { asset_url: asset.url, mime_type: asset.mime_type });
      }
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

  return { jobs, generating, startJobs, addJob, clearJobs };
}
