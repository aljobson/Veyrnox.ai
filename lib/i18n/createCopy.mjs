import { tOr } from './translate.mjs';

// Only render this result. The job's code, refund flag and canonical copy stay intact.
export function failedCreationCopy(t, locale, job, english) {
  if (locale === 'en') return english;
  const known = t.messages?.[`app.create.error.${job.error_code}`];
  const copy = typeof known === 'string' ? tOr(t, `app.create.error.${job.error_code}`, english) : t('app.data.failed');
  return job.refunded === true ? copy : copy.replace(t('app.data.refunded'), t('app.data.refundPending'));
}
