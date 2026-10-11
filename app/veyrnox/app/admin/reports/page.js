'use client';

/**
 * User reports of content (ADR-0083): CSAM first, then oldest first. Each
 * links to the account the reported job belongs to, where a warning, a
 * takedown or a CSAM escalation is recorded; resolving here only closes the
 * report with a note. Reads and writes /api/v1/admin/reports.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { AccountBoundary } from '../../../_components/AccountBoundary';
import { MfaPanel } from '../../../_components/MfaPanel';
import { Button } from '../../../_components/Button';
import { Chip } from '../../../_components/Chip';
import { gatewayFetch } from '../../../_lib/gateway';

const when = (iso) => (iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—');
const CATEGORY = {
  csam: 'Child sexual abuse', intimate_image: 'Intimate image', real_person: 'Real person without consent', violence: 'Violence',
  hate: 'Hate', fraud: 'Fraud or scam', copyright: 'Copyright', other: 'Other',
};

export default function Page() {
  return <><AppNav /><Main><AccountBoundary><Reports /></AccountBoundary></Main></>;
}

function Reports() {
  const [status, setStatus] = useState('open');
  const [rows, setRows] = useState(null);
  const [unavailable, setUnavailable] = useState(null);
  const [assetGone, setAssetGone] = useState(0);
  const [error, setError] = useState('');
  const generation = useRef(0);

  const load = useCallback(async (which) => {
    const version = ++generation.current;
    setError('');
    try {
      const data = await gatewayFetch(`/admin/reports?status=${encodeURIComponent(which)}&limit=100`);
      if (version === generation.current) { setRows(data.reports || []); setUnavailable(data.unavailable_scans_24h ?? 0); setAssetGone(data.asset_gone_scans_24h ?? 0); }
    } catch (e) {
      if (version === generation.current) { setRows([]); setError(message(e.code)); }
    }
  }, []);

  // A request counter, not a DOM node: the cleanup must bump the live value.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(status); return () => { generation.current++; }; }, [load, status]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 pb-32 sm:px-8">
      <Link href="/app/admin" className="text-sm underline">Back to operations</Link>
      <Chip tone="danger" className="mt-5 mb-3">ADMIN · REPORTS</Chip>
      <h1 className="text-3xl font-black tracking-[-0.02em]">Content reports</h1>
      <p className="my-5 text-vx-fg-body max-w-[640px]">
        What users reported, child sexual abuse first. A report about a generation links to the account it belongs to:
        record the warning, takedown or escalation there (<code className="font-vx-mono text-xs">docs/agents/csam-escalation.md</code>),
        then close the report here with a note. Reporters are not told the outcome.
      </p>
      <MfaPanel />
      <ScannerAction disarm onDone={() => load(status)} />
      {unavailable !== null && <p className="mt-4 text-sm">Unavailable scans in the last 24 hours: {unavailable}</p>}
      {assetGone > 0 && <p className="mt-2 text-sm">Scans in the last 24 hours skipped, file already gone: {assetGone}</p>}

      <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Report status">
        {['open', 'resolved'].map((s) => (
          <Button key={s} size="sm" variant={status === s ? 'primary' : 'ghost'} role="tab" aria-selected={status === s} onClick={() => { setRows(null); setStatus(s); }}>
            {s[0].toUpperCase() + s.slice(1)}
          </Button>
        ))}
      </div>
      {error && <p role="alert" className="mt-4 text-vx-danger">{error}</p>}
      {rows === null && !error && <p className="mt-6 text-sm text-vx-fg-muted">Loading…</p>}
      {rows && rows.length === 0 && <p className="mt-6 text-sm text-vx-fg-muted">No {status} reports.</p>}
      <div className="mt-6 space-y-4">
        {(rows || []).map((r) => <ReportCard key={r.id} report={r} onDone={() => load(status)} />)}
      </div>
    </div>
  );
}

function ReportCard({ report: r, onDone }) {
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function resolve(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await gatewayFetch('/admin/reports', { method: 'POST', body: JSON.stringify({ report_id: r.id, resolution: resolution.trim() }) });
      onDone();
    } catch (e) {
      setError(message(e.code)); setBusy(false);
    }
  }

  return (
    <section className={`rounded-2xl border bg-vx-panel p-5 ${r.category === 'csam' ? 'border-vx-danger' : 'border-vx-border'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-bold">{CATEGORY[r.category] || r.category}</h2>
          <div className="mt-1 text-xs text-vx-fg-muted">Reported {when(r.created_at)} by {r.source === 'scanner' ? 'Scanner' : r.reporter_email}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip tone={r.category === 'csam' ? 'danger' : 'neutral'} noGlyph>{r.subject_kind.replace('_', ' ')}</Chip>
          {r.status === 'resolved' && <Chip tone="accent" noGlyph>resolved</Chip>}
        </div>
      </div>
      {r.subject_id && (
        <div className="mt-3 text-xs font-vx-mono break-all">
          {r.subject_kind === 'job' ? 'job' : 'title'} {r.subject_id}
          {r.subject_kind === 'job' && r.subject_user_id && (
            <> · <Link href={`/app/admin/violations?user=${encodeURIComponent(r.subject_user_id)}`} className="underline">open account</Link>
              {' '}· {r.subject_model_id || 'unknown model'} · {r.subject_served ? 'still served' : 'not served'}</>
          )}
          {r.subject_kind === 'job' && !r.subject_user_id && ' · no such job'}
        </div>
      )}
      {r.source === 'scanner' && <pre className="mt-3 whitespace-pre-wrap text-xs">{JSON.stringify(r.scores, null, 2)}</pre>}
      {r.source === 'scanner' && r.held && <ScannerAction jobId={r.subject_id} onDone={onDone} />}
      {r.details && <p className="mt-3 text-sm whitespace-pre-wrap wrap-break-word">{r.details}</p>}
      {r.status === 'resolved' && <p className="mt-3 text-xs text-vx-fg-muted">Resolved {when(r.resolved_at)} by {r.resolved_by}: {r.resolution}</p>}
      {r.status === 'open' && !open && <Button className="mt-4" size="sm" variant="ghost" onClick={() => setOpen(true)}>Resolve</Button>}
      {open && (
        <form onSubmit={resolve} className="mt-3 rounded-lg border border-vx-border p-4 space-y-3" aria-label="Resolve this report">
          <label className="block text-sm">
            What was done
            <input value={resolution} onChange={(e) => setResolution(e.target.value)} required minLength={3} maxLength={500}
              className="mt-2 w-full rounded-lg border border-vx-border bg-vx-panel p-3 text-sm" />
          </label>
          {error && <p role="alert" className="text-vx-danger text-sm">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy || resolution.trim().length < 3}>{busy ? 'Saving…' : 'Close report'}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          </div>
        </form>
      )}
    </section>
  );
}

function message(code) {
  return ({
    no_token: 'Sign in with an administrator account.',
    unauthenticated: 'Sign in with an administrator account.',
    not_admin: 'This account is not an administrator.',
    mfa_required: 'Unlock this session with your authenticator above, then try again.',
    report_not_found: 'That report no longer exists. Refresh the list.',
    resolution_invalid: 'Write 3 to 500 characters.',
    rate_limited: 'Too many requests. Wait a minute and try again.',
  })[code] || 'The reports queue is unavailable right now. Please retry.';
}

function ScannerAction({ jobId, disarm = false, onDone }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function view() {
    // Open synchronously to avoid popup blocking; never hand the image an opener.
    const tab = window.open('about:blank', '_blank');
    if (tab) tab.opener = null;
    try {
      const data = await gatewayFetch(`/admin/reports/asset?job_id=${encodeURIComponent(jobId)}`);
      if (tab) tab.location.replace(data.url);
    } catch (e) { tab?.close(); setError(message(e.code)); }
  }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await gatewayFetch('/admin/reports', { method: 'POST', body: JSON.stringify({
        ...(disarm ? { scanner_disarm: true } : { release_job_id: jobId }), reason: reason.trim(),
      }) });
      setReason(''); onDone();
    } catch (e) { setError(message(e.code)); }
    finally { setBusy(false); }
  }
  return <div className="mt-4">
    {!disarm && <Button size="sm" variant="ghost" onClick={view}>View held image</Button>}
    <form onSubmit={submit} className="mt-2 flex flex-wrap gap-2">
      <input aria-label={disarm ? 'Reason for disarming monitoring' : 'Reason for releasing hold'} value={reason} onChange={e => setReason(e.target.value)}
        placeholder="Reason" minLength={3} maxLength={500} required className="rounded border border-vx-border bg-vx-panel p-2 text-sm" />
      <Button size="sm" type="submit" disabled={busy || reason.trim().length < 3}>{disarm ? 'Scanner: disarm monitoring' : 'Release'}</Button>
    </form>
    {error && <p role="alert" className="text-vx-danger">{error}</p>}
  </div>;
}
