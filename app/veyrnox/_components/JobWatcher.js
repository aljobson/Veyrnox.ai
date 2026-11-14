'use client';
import { useI18n } from '../../../components/I18nProvider';
import { useEffect } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { getStoredUserId } from '../../lib/authClient';
import { gatewayFetch, notifyBalanceChanged } from '../_lib/gateway';
import { readJobHistory, jobsToWatch, markJobSettled } from '../_lib/jobHistory';

// Background generation: slow models (Kling, AI Avatar, MMAudio) take minutes,
// so a job keeps running when you leave the create page or start another.
// Mounted once for every Veyrnox page; it polls this browser's unsettled
// recent jobs and says when each one lands. Silent when signed out.
const POLL_MS = 5000;

export function JobWatcher() {
  const { t } = useI18n();
  useEffect(() => {
    let stopped = false;
    async function tick() {
      if (stopped || document.hidden || !getStoredUserId()) return;
      for (const job of jobsToWatch(readJobHistory())) {
        let next;
        try { next = await gatewayFetch(`/jobs/${job.job_id}`); } catch { continue; }
        if (next.state !== 'succeeded' && next.state !== 'failed') continue;
        // Re-read: another tab or the create page may have announced it.
        if (!jobsToWatch(readJobHistory()).some((r) => r.job_id === job.job_id)) continue;
        markJobSettled(job.job_id, next.state);
        notifyBalanceChanged();
        const label = job.name || job.prompt || t('public.jobs.default');
        if (next.state === 'succeeded') {
          // Success says what was spent, as a line of the statement does. The
          // figure is the job's own (/jobs/:id `credits`), never worked out here.
          const spent = typeof next.credits === 'number' && next.credits > 0 ? next.credits : null;
          toast.success((toastItem) => (
            <span className="block min-w-0">
              <span className="flex items-baseline gap-2">
                <span className="min-w-0">{t('public.jobs.ready', { label })}</span>
                {spent !== null && (
                  <>
                    <span aria-hidden="true" className="vx-leader flex-1" />
                    <span dir="ltr" className="shrink-0 font-vx-mono font-bold text-vx-money vx-num">{`\u2212${spent}`} cr</span>
                  </>
                )}
              </span>
              <Link href="/app/library" onClick={() => toast.dismiss(toastItem.id)} className="underline">{t('public.vey.action.open_library')}</Link>
            </span>
          ), { duration: 10000 });
        } else {
          // Only claim the refund the ledger has actually made (/jobs/:id
          // `refunded`); otherwise say what is true and what happens next.
          toast.error(
            next.refunded ? t('public.jobs.refunded', { label }) : t('public.jobs.pendingRefund', { label }),
            { duration: 10000 },
          );
        }
      }
    }
    const id = setInterval(tick, POLL_MS);
    return () => { stopped = true; clearInterval(id); };
  }, [t]);
  return null;
}
