'use client';
import Link from 'next/link';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { tOr } from '../../../lib/i18n/translate.mjs';
import { localeTag } from '../../../lib/i18n/locales.mjs';
import { failedCreationCopy } from '../../../lib/i18n/createCopy.mjs';
import { ERROR_COPY, failedJobCopy } from '../_lib/createErrors';
import { jobStateUi } from '../_lib/studioStates';
import { useTemplateGenerate } from '../_lib/useTemplateGenerate';
import { JobAssetPreview } from './JobAssetPreview';

// Generate on the template page, for a template that needs no media (templateGenerate.inlineBlockReason). The price is the
// catalog's (unitCost comes from the live model row), the quote caps the charge, and a failure is refunded by the
// server exactly as on Create. Rights and provider-consent ticks only exist with an upload, and there is none here.
export function TemplateGenerate({ preset, model, prompt, aspect, aspectOptions, durationSeconds, unitCost }) {
  const { t, locale } = useI18n();
  const g = useTemplateGenerate({ preset, model, prompt, aspect, aspectOptions, durationSeconds, unitCost });
  const job = g.jobs[0] || null;
  const failed = job?.state === 'failed';
  const cost = g.quote.total;
  const resultAspect = (job?.aspect_ratio || aspect || '16:9').replace(':', '/');
  const error = g.error;
  return (
    <div data-testid="template-generate">
      {job && (
        <div className={`relative mt-6 overflow-hidden rounded-2xl border border-vx-border bg-vx-panel ${g.generating ? 'vx-shimmer' : ''}`} style={{ aspectRatio: resultAspect, maxHeight: 520 }} role="status">
          {job.asset_url ? <JobAssetPreview job={job} /> : (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
              <div>
                <div className={`font-vx-mono text-[11px] tracking-[0.14em] ${failed ? 'text-vx-danger' : 'text-vx-accent'}`}>
                  <span aria-hidden="true">{jobStateUi(job).glyph}</span> {tOr(t, `app.library.status.${failed && job.refunded !== true ? 'failed_pending' : job.state}`, jobStateUi(job).label)}
                </div>
                {failed && <div className="mt-2 text-sm text-vx-fg-body">{failedCreationCopy(t, locale, job, failedJobCopy(job))}</div>}
                {g.generating && <div className="mt-2 text-xs text-vx-fg-muted">{t('app.create.keepRunning')}</div>}
              </div>
            </div>
          )}
        </div>
      )}
      {error && (
        <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-vx-danger/40 bg-vx-danger/[0.07] px-4 py-3 text-sm text-vx-danger">
          <span aria-hidden="true">✕</span>
          <span>
            {tOr(t, `app.create.error.${error.code}`, ERROR_COPY[error.code] || t('app.create.error.unknown'))}
            {error.retryAfter && t('app.create.retryIn', { seconds: locale === 'en' ? error.retryAfter : Number(error.retryAfter).toLocaleString(localeTag(locale)) })}
          </span>
        </div>
      )}
      <button
        type="button"
        onClick={g.generate}
        disabled={!g.canGenerate}
        aria-busy={g.sending || undefined}
        className="vx-press mt-6 inline-flex w-full items-center justify-between gap-4 rounded-full bg-vx-accent px-6 py-3.5 font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover disabled:opacity-50 sm:w-auto"
      >
        <span>{g.sending ? t('app.publish.inbox.sending') : g.confirming ? t('app.create.confirmPrice', { credits: cost }) : failed ? t('recovery.retry') : t('label.Generate')}</span>
        <span className="font-vx-mono vx-num text-[15px] font-bold">{cost} cr</span>
      </button>
      {g.balance != null && g.quote.payable > g.balance && <p role="status" className="mt-2 text-[13px] text-vx-fg-muted">{tOr(t, 'app.create.error.insufficient_balance', ERROR_COPY.insufficient_balance)}</p>}
      {job?.asset_url && <Link href="/app/library" className="vx-press ms-3 mt-6 inline-flex rounded-full border border-vx-border px-5 py-3 text-sm font-bold hover:border-vx-fg-muted">{t('label.Library')}</Link>}
    </div>
  );
}
