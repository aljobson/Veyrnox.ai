'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { gatewayFetch } from '../_lib/gateway.js';
import { fetchTemplate } from '../_lib/useTemplates.js';
import { readSwapResult, resultAspect } from '../_lib/swapResult.mjs';
import { useResultPresence } from '../_lib/resultPresence.js';
import { JobAssetPreview } from './JobAssetPreview.js';

const controlClass = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-vx-border px-4 py-2 text-vx-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent';

// The finished video plays where it was asked for. The signed link is read fresh and never stored with the attempt.
export function SwapAttemptResult({ jobId, aspect, templateId }) {
  const { t } = useI18n();
  const [job, setJob] = useState(null);
  const metadataReady = useRef(false);
  const [ratio, setRatio] = useState(resultAspect(aspect));
  useResultPresence([jobId]);
  useEffect(() => {
    let live = true;
    if (!aspect && templateId) fetchTemplate(templateId)
      .then(template => { if (live && !metadataReady.current) setRatio(resultAspect(template?.clip?.aspectRatio)); })
      .catch(() => { /* Keep the default aspect until the video's metadata arrives. */ });
    return () => { live = false; };
  }, [aspect, templateId]);
  const [failed, setFailed] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => { setFailed(null); setAttempt(value => value + 1); }, []);
  useEffect(() => {
    const controller = new AbortController();
    readSwapResult(jobId, gatewayFetch, controller.signal).then(next => {
      if (!controller.signal.aborted) { setFailed(null); setJob(next); }
    }).catch(error => { if (!controller.signal.aborted) setFailed(error.code === 'asset_unavailable' ? 'asset' : 'result'); });
    return () => controller.abort();
  }, [jobId, attempt]);
  if (failed) return <div><p role="status" className="mb-4">{t(failed === 'asset' ? 'public.jobs.assetUnavailable' : 'public.jobs.resultUnconfirmed')}</p><div className="flex flex-wrap gap-4"><button type="button" className={controlClass} onClick={retry}>{t('presets.swap.check')}</button><a href="/app/library" className={controlClass}>{t('presets.swap.library')}</a></div></div>;
  if (!job || job.job_id !== jobId) return <div aria-hidden="true" className="vx-shimmer mx-auto rounded-xl bg-vx-panel" style={{ aspectRatio: ratio, width: `min(100%, ${70 * ratio}vh)` }} />;
  return <div className="relative mx-auto overflow-hidden rounded-xl bg-vx-panel" style={{ aspectRatio: ratio, width: `min(100%, ${70 * ratio}vh)` }} data-swap-result><JobAssetPreview job={job} onLoadedMetadata={event => { const video = event.currentTarget; if (video.videoWidth && video.videoHeight) { metadataReady.current = true; setRatio(video.videoWidth / video.videoHeight); } }} /></div>;
}
