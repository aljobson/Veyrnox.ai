'use client';

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
  ['csam', 'Sexual content involving a child'],
  ['intimate_image', 'An intimate image of someone'],
  ['real_person', 'A real person shown without consent'],
  ['violence', 'Violence or threats'],
  ['hate', 'Hate or harassment'],
  ['fraud', 'Fraud or a scam'],
  ['copyright', 'Copyright or someone else’s work'],
  ['other', 'Something else'],
];

export default function Page() {
  return <><AppNav /><Main className="max-w-[720px] mx-auto px-4 sm:px-8 py-10"><Suspense fallback={null}><ReportForm /></Suspense></Main></>;
}

function ReportForm() {
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
      setError(e.code === 'no_token' || e.code === 'unauthenticated' ? 'Sign in to send a report.' : e.status === 429 ? 'Too many reports. Wait a while and try again.' : 'Your report could not be sent. Please retry.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div role="status">
        <h1 className="text-3xl font-black mb-4">Thank you</h1>
        <p className="text-vx-fg-body">A person will review your report. If it concerns a child, it is looked at first and may be passed to the Internet Watch Foundation. We do not reply to reports.</p>
        <Link href="/app/library" className="mt-6 inline-block text-sm underline">Back to Library</Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-5" aria-label="Report content">
      <h1 className="text-3xl font-black">Report content</h1>
      <p className="text-vx-fg-body">
        {subject.kind === 'job' && 'You are reporting one of your generations. '}
        {subject.kind === 'cinema_title' && 'You are reporting a Cinema title. '}
        If someone is in immediate danger, contact the police first.
      </p>
      <fieldset className="space-y-2">
        <legend className="text-sm font-bold mb-2">What is wrong with it?</legend>
        {CATEGORIES.map(([value, label]) => (
          <label key={value} className="flex items-center gap-3 text-sm">
            <input type="radio" name="category" value={value} checked={category === value} onChange={() => setCategory(value)} required />
            {label}
          </label>
        ))}
      </fieldset>
      <label className="block text-sm">
        Anything we should know{subject.kind === 'other' ? ' (what and where)' : ' (optional)'}
        <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000} rows={4} required={subject.kind === 'other'} minLength={subject.kind === 'other' ? 10 : 0}
          className="mt-2 w-full rounded-lg border border-vx-border bg-vx-panel p-3 text-sm" />
      </label>
      <p className="text-xs text-vx-fg-muted">Do not attach or paste the content. Do not include other people&apos;s personal details beyond what is needed.</p>
      {error && <p role="alert" className="text-vx-danger text-sm">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !valid}>{busy ? 'Sending…' : 'Send report'}</Button>
        <Link href="/app/library" className="self-center text-sm underline">Cancel</Link>
      </div>
    </form>
  );
}
