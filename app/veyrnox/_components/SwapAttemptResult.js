'use client';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { gatewayFetch } from '../_lib/gateway.js';
import { markJobSettled } from '../_lib/jobHistory.js';
import { JobAssetPreview } from './JobAssetPreview.js';

const controlClass = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-vx-border px-4 py-2 text-vx-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent';

// The finished video plays where it was asked for. The signed link is read fresh and never stored with the attempt.
export function SwapAttemptResult({ jobId }) {
  const { t } = useI18n();
  const [job, setJob] = useState(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => { setFailed(false); setAttempt(value => value + 1); }, []);
  useEffect(() => {
    const controller = new AbortController();
    gatewayFetch(`/jobs/${jobId}`, { signal: controller.signal }).then(next => {
      if (controller.signal.aborted) return;
      if (next?.state !== 'succeeded' || !next.asset_url) { setFailed(true); return; }
      setJob(next);
      markJobSettled(jobId, 'succeeded');
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [jobId, attempt]);
  if (failed) return <button type="button" className={controlClass} onClick={retry}>{t('presets.swap.check')}</button>;
  if (!job) return <div aria-hidden="true" className="vx-shimmer mx-auto aspect-[9/16] max-h-[70vh] rounded-xl bg-vx-panel" />;
  return <div className="relative mx-auto aspect-[9/16] max-h-[70vh] overflow-hidden rounded-xl bg-black" data-swap-result><JobAssetPreview job={job} /></div>;
}
