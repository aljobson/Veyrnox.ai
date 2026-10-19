'use client';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { FIRST_POLL_MS, STATUS_PATH, nextPollDelay, readStatus } from '../_lib/serviceStatus';

// "Something is happening" strip, shown on every page while the database
// provider is failing (ADR-0160). It asks /api/status, our own endpoint, so a
// browser that cannot reach us at all says nothing rather than blaming
// Supabase. While it shows, <html data-service="degraded"> lets any screen
// switch off what cannot work. Nothing renders (and nothing is saved) when
// all is well.
export default function ServiceStatusBanner() {
  const { t } = useI18n();
  const [status, setStatus] = useState('ok');

  useEffect(() => {
    let timer;
    let stopped = false;
    let current = 'ok';

    const schedule = (ms) => {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(check, ms);
    };
    async function check() {
      if (document.hidden) return; // visibilitychange resumes it
      try {
        const res = await fetch(STATUS_PATH, { cache: 'no-store', credentials: 'omit' });
        if (res.ok) {
          current = readStatus(await res.json());
          if (!stopped) setStatus(current);
        }
      } catch { /* we cannot reach our own site: not news about Supabase */ }
      schedule(nextPollDelay(current));
    }
    const resume = () => { if (!document.hidden) check(); };

    schedule(FIRST_POLL_MS);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (status === 'degraded') root.dataset.service = 'degraded';
    else delete root.dataset.service;
    return () => { delete root.dataset.service; };
  }, [status]);

  if (status !== 'degraded') return null;
  return (
    <div data-print="hide" role="status" aria-live="polite" className="bg-vx-warn text-vx-base">
      <div className="max-w-[1300px] mx-auto px-4 sm:px-6 py-2 text-[13px] text-center">
        <strong className="font-extrabold">{t('status.degraded.label')}</strong>
        {' '}
        <span>{t('status.degraded.message')}</span>
      </div>
    </div>
  );
}
