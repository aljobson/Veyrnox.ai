'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../../components/I18nProvider';
import { pluralKey } from '../../../../lib/i18n/translate.mjs';
import { gatewayFetch } from '../../_lib/gateway';

const PROBE_INTERVAL_MS = 15_000;

function refusalKey(error) {
  switch (String(error?.code || '')) {
    case 'job_started': return 'started';
    case 'job_finished': return 'finished';
    case 'account_frozen': return 'frozen';
    case 'rate_limited': return 'rateLimited';
    case 'not_found': return 'unavailable';
    default: return 'unsure';
  }
}

function validStatus(value) {
  return value && typeof value.cancellable === 'boolean'
    && Number.isInteger(value.credits) && value.credits >= 0;
}

export function MusicCandidateCancel({ candidate, onCancelled }) {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [note, setNote] = useState(null);
  const busy = useRef(false);
  const settled = useRef(false);
  const probeControl = useRef(null);
  const jobId = candidate?.job_id;
  const queued = candidate?.state === 'queued' && typeof jobId === 'string' && jobId.length > 0;
  const credits = status?.credits > 0
    ? t(pluralKey(t, locale, 'app.music.suno.credits', status.credits), { count: status.credits }) : '';

  useEffect(() => {
    if (!queued) return undefined;
    settled.current = false;
    let stopped = false;
    let timer;
    const schedule = (delay = PROBE_INTERVAL_MS) => {
      window.clearTimeout(timer);
      if (!stopped && !settled.current) timer = window.setTimeout(probe, Math.max(PROBE_INTERVAL_MS, delay));
    };
    const stop = () => { window.clearTimeout(timer); };
    probeControl.current = { schedule, stop };
    const probe = async () => {
      if (stopped || settled.current || busy.current) return;
      try {
        const next = await gatewayFetch(`/jobs/${encodeURIComponent(jobId)}/cancel`);
        if (stopped || settled.current || busy.current) return;
        if (!validStatus(next)) { setStatus(null); return; }
        setStatus(next.cancellable ? next : null);
        if (next.cancellable) setNote(null);
        schedule();
      } catch (error) {
        if (stopped || settled.current || busy.current) return;
        setStatus(null);
        if (error?.code === 'rate_limited') schedule((Number(error.retryAfter) || 60) * 1000);
        else if (!['not_found', 'unauthenticated', 'no_token'].includes(error?.code)) schedule();
      }
    };
    void probe();
    return () => { stopped = true; stop(); if (probeControl.current?.stop === stop) probeControl.current = null; };
  }, [jobId, queued]);

  async function cancel() {
    if (busy.current || !status?.cancellable) return;
    busy.current = true;
    setCancelling(true);
    setNote(null);
    try {
      const result = await gatewayFetch(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
      if (result?.cancelled !== true || !Number.isInteger(result.credits) || result.credits < 0) throw new Error('invalid_cancel');
      settled.current = true;
      probeControl.current?.stop();
      setStatus(null);
      setConfirming(false);
      setNote({ key: result.credits > 0 ? 'cancelledPaidFormatted' : 'cancelledFree', credits: result.credits,
        creditsLabel: result.credits > 0 ? t(pluralKey(t, locale, 'app.music.suno.credits', result.credits), { count: result.credits }) : '' });
      await Promise.resolve(onCancelled?.({ jobId, credits: result.credits })).catch(() => {});
    } catch (error) {
      const key = refusalKey(error);
      setNote({ key });
      setStatus(null);
      setConfirming(false);
      if (['finished', 'unavailable'].includes(key)) {
        settled.current = true;
        probeControl.current?.stop();
      } else {
        const retry = key === 'rateLimited' ? (Number(error?.retryAfter) || 60) * 1000 : PROBE_INTERVAL_MS;
        probeControl.current?.schedule(retry);
      }
      if (key === 'unsure') await Promise.resolve(onCancelled?.({ jobId, uncertain: true })).catch(() => {});
    } finally {
      busy.current = false;
      setCancelling(false);
    }
  }

  if (!queued || (!status?.cancellable && !note)) return null;
  return (
    <div className="mt-4 border-t border-vx-border pt-4">
      {note ? <p role="status" className="text-sm text-vx-fg-body">{t(`app.music.suno.cancel.${note.key}`,
        note.credits === undefined ? undefined : { count: note.credits, credits: note.creditsLabel })}</p> : null}
      {status?.cancellable && !confirming ? (
        <button type="button" className="mt-2 min-h-11 rounded-full border border-vx-danger/60 px-4 text-sm font-bold text-vx-danger" onClick={() => setConfirming(true)}>
          {t('app.music.suno.cancel.action')}
        </button>
      ) : null}
      {status?.cancellable && confirming ? (
        <div role="group" aria-label={t('app.music.suno.cancel.confirmTitle')} className="mt-2 rounded-xl bg-vx-base p-3">
          <p className="text-sm font-bold">{t('app.music.suno.cancel.confirmTitle')}</p>
          <p className="mt-1 text-sm text-vx-fg-body">{status.credits > 0
            ? t('app.music.suno.cancel.confirmPaidFormatted', { count: status.credits, credits })
            : t('app.music.suno.cancel.confirmFree')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={cancelling} className="min-h-11 rounded-full border border-vx-border px-4 text-sm font-bold" onClick={() => setConfirming(false)}>{t('app.music.suno.cancel.keep')}</button>
            <button type="button" disabled={cancelling} aria-busy={cancelling} className="min-h-11 rounded-full bg-vx-danger px-4 text-sm font-bold text-white disabled:opacity-60" onClick={cancel}>
              {t(cancelling ? 'app.music.suno.cancel.cancelling' : 'app.music.suno.cancel.confirm')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
