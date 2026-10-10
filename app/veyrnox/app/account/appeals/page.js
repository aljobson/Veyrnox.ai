'use client';

/**
 * What was recorded against this account, and the way to contest it
 * (ADR-0083). Reads /api/v1/appeals: warnings, removals and a content
 * freeze, each with its appeal state; the operator's reason is never sent.
 * One appeal per action; the outcome arrives by email.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { AccountBoundary } from '../../../_components/AccountBoundary';
import { Button } from '../../../_components/Button';
import { Chip } from '../../../_components/Chip';
import { gatewayFetch } from '../../../_lib/gateway';

const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
const LABEL = { warning: 'Warning', takedown: 'Content removed', freeze: 'Account frozen' };

export default function Page() {
  return <><AppNav /><Main className="max-w-[900px] mx-auto px-4 sm:px-8 py-10"><AccountBoundary><Appeals /></AccountBoundary></Main></>;
}

function Appeals() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const generation = useRef(0);

  const load = useCallback(async () => {
    const version = ++generation.current;
    try {
      const d = await gatewayFetch('/appeals');
      if (version === generation.current) setData(d);
    } catch (e) {
      if (version === generation.current) setError(e.code === 'no_token' || e.code === 'unauthenticated' ? 'Sign in to see your account record.' : 'Your account record is unavailable right now. Please retry.');
    }
  }, []);

  // A request counter, not a DOM node: the cleanup must bump the live value.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); return () => { generation.current++; }; }, [load]);

  return (
    <>
      <Link href="/app/account" className="text-sm underline">Back to account</Link>
      <h1 className="text-3xl font-black mt-4 mb-2">Content decisions and appeals</h1>
      <p className="text-vx-fg-body mb-6 max-w-[640px]">
        Decisions we have made about content on your account under the <a href="/legal/aup" className="underline">Acceptable Use Policy</a>.
        If you think one is wrong, appeal it here. A person reviews every appeal and you will hear back by email.
        A removal that is reversed stops counting against your account; deleted files cannot be restored.
      </p>
      {data?.hold_until && (
        <p role="status" className="mb-6 rounded-lg border border-vx-border bg-vx-panel p-4 text-sm">
          Generating is paused on your account until {when(data.hold_until)}. Your library, downloads and credits are unaffected.
        </p>
      )}
      {error && <p role="alert" className="text-vx-danger text-sm">{error}</p>}
      {data && data.sanctions.length === 0 && <p className="text-sm text-vx-fg-muted">Nothing has been recorded against your account.</p>}
      <div className="space-y-4">
        {(data?.sanctions || []).map((s) => <Sanction key={s.action_id} sanction={s} onDone={load} />)}
      </div>
    </>
  );
}

function Sanction({ sanction: s, onDone }) {
  const [open, setOpen] = useState(false);
  const [statement, setStatement] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const valid = statement.trim().length >= 10 && statement.length <= 2000;

  async function submit(event) {
    event.preventDefault();
    if (!valid) return;
    setBusy(true); setError('');
    try {
      await gatewayFetch('/appeals', { method: 'POST', body: JSON.stringify({ action_id: s.action_id, statement: statement.trim() }) });
      setOpen(false); setStatement('');
      onDone();
    } catch (e) {
      setError(e.code === 'statement_invalid' ? 'Write 10 to 2000 characters.' : e.status === 429 ? 'Too many requests. Wait a minute and try again.' : 'Your appeal could not be sent. Please retry.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-vx-border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold">{LABEL[s.action] || s.action}</h2>
          <div className="text-xs text-vx-fg-muted mt-1">{when(s.created_at)}{s.model_id ? ` · ${s.model_id}` : ''}{s.hold_until && new Date(s.hold_until) > new Date() ? ` · generating paused until ${when(s.hold_until)}` : ''}</div>
        </div>
        {s.appeal_status === 'open' && <Chip tone="neutral" noGlyph>Appeal under review</Chip>}
        {s.appeal_status === 'upheld' && <Chip tone="accent" noGlyph>Appeal successful</Chip>}
        {s.appeal_status === 'rejected' && <Chip tone="warn" noGlyph>Appeal not successful</Chip>}
      </div>
      {!s.appeal_status && !open && <Button className="mt-4" size="sm" variant="ghost" onClick={() => setOpen(true)}>Appeal this decision</Button>}
      {open && (
        <form onSubmit={submit} className="mt-4 space-y-3" aria-label="Appeal this decision">
          <label className="block text-sm">
            Tell us why you think this decision was wrong
            <textarea value={statement} onChange={(e) => setStatement(e.target.value)} required minLength={10} maxLength={2000} rows={4}
              className="mt-2 w-full rounded-lg border border-vx-border bg-vx-panel p-3 text-sm" />
          </label>
          <p className="text-xs text-vx-fg-muted">You can appeal each decision once. Do not include other people&apos;s personal details.</p>
          {error && <p role="alert" className="text-vx-danger text-sm">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy || !valid}>{busy ? 'Sending…' : 'Send appeal'}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          </div>
        </form>
      )}
    </section>
  );
}
