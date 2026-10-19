'use client';
import { useI18n } from '../../../../../components/I18nProvider';

/**
 * Report content (ADR-0083): a generation of your own that came out wrong,
 * a Cinema title, or anything else. Posts to /api/v1/reports. Reached from
 * Report on a Library card (?job=<id>) or from the account page.
 */

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { Button } from '../../../_components/Button';
import { gatewayFetch } from '../../../_lib/gateway';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORIES = [
  ['csam', 'app.account.report.category.csam'],
  ['intimate_image', 'app.account.report.category.intimate_image'],
  ['real_person', 'app.account.report.category.real_person'],
  ['violence', 'app.account.report.category.violence'],
  ['hate', 'app.account.report.category.hate'],
  ['fraud', 'app.account.report.category.fraud'],
  ['copyright', 'app.account.report.category.copyright'],
  ['other', 'app.account.report.category.other'],
];

export default function Page() {
  return <><AppNav /><Main className="max-w-[720px] mx-auto px-4 sm:px-8 py-10"><Suspense fallback={null}><ReportForm /></Suspense></Main></>;
}

function ReportForm() {
  const { t } = useI18n();
  const params = useSearchParams();
  const job = params.get('job');
  const title = params.get('title');
  const subject = job && UUID_RE.test(job) ? { kind: 'job', id: job } : title && UUID_RE.test(title) ? { kind: 'cinema_title', id: title } : { kind: 'other', id: null };
  const [category, setCategory] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const valid = !!category && details.length <= 2000 && (subject.kind !== 'other' || details.trim().length >= 10);

  async function submit(event) {
    event.preventDefault();
    if (!valid) return;
    setBusy(true); setError('');
    try {
      await gatewayFetch('/reports', { method: 'POST', body: JSON.stringify({ subject_kind: subject.kind, subject_id: subject.id, category, details: details.trim() }) });
      setDone(true);
    } catch (e) {
      setError(e.code === 'no_token' || e.code === 'unauthenticated' ? t("app.account.report.signIn") : e.status === 429 ? t("app.account.report.limited") : t("app.account.report.failed"));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div role="status">
        <h1 data-testid="report-thanks" className="text-3xl font-black mb-4">{t("app.account.report.thanks")}</h1>
        <p className="text-vx-fg-body">{t("app.account.report.review")}</p>
        <Link href="/app/library" className="mt-6 inline-block text-sm underline">{t("app.account.report.back")}</Link>
      </div>
    );
  }
  return (
    <form data-testid="content-report" onSubmit={submit} className="space-y-5" aria-label={t("app.account.report")}>
      <h1 className="text-3xl font-black">{t("app.account.report")}</h1>
      <p className="text-vx-fg-body">
        {subject.kind === 'job' && t('app.account.report.job')}
        {subject.kind === 'cinema_title' && t('app.account.report.cinema')}{t("app.account.report.danger")}</p>
      <fieldset className="space-y-2">
        <legend className="text-sm font-bold mb-2">{t("app.account.report.question")}</legend>
        {CATEGORIES.map(([value, label]) => (
          <label key={value} className="flex items-center gap-3 text-sm">
            <input data-testid={`report-category-${value}`} type="radio" name="category" value={value} checked={category === value} onChange={() => setCategory(value)} required />
            {t(label)}
          </label>
        ))}
      </fieldset>
      <label className="block text-sm">{t("app.account.report.details")}{subject.kind === 'other' ? t("app.account.report.where") : ` ${t("cinema.socialCinema.optional")}`}
        <textarea data-testid="report-details" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000} rows={4} required={subject.kind === 'other'} minLength={subject.kind === 'other' ? 10 : 0}
          className="mt-2 w-full rounded-lg border border-vx-border bg-vx-panel p-3 text-sm" />
      </label>
      <p className="text-xs text-vx-fg-muted">{t("app.account.report.privacy")}</p>
      {error && <p role="alert" className="text-vx-danger text-sm">{error}</p>}
      <div className="flex gap-2">
        <Button data-testid="send-report" type="submit" disabled={busy || !valid}>{busy ? t("app.publish.inbox.sending") : t("cinema.comments.sendReport")}</Button>
        <Link href="/app/library" className="self-center text-sm underline">{t("cinema.creatorWorkspace.cancel")}</Link>
      </div>
    </form>
  );
}
