'use client';

/**
 * The appeals queue (ADR-0083, Ofcom ICU D1/D2/D10): what the user contests,
 * what the operator recorded and why, and a decision that is written once.
 * Upholding takes the strike out of the count, recomputes the hold and lifts
 * a content freeze when fewer than three strikes remain. Reads and writes
 * /api/v1/admin/appeals; the Idempotency-Key per attempt means a lost
 * response and a resubmit decide once.
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

export default function Page() {
  return <><AppNav /><Main><AccountBoundary><Appeals /></AccountBoundary></Main></>;
}

function Appeals() {
  const [status, setStatus] = useState('open');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const generation = useRef(0);

  const load = useCallback(async (which) => {
    const version = ++generation.current;
    setError('');
    try {
      const data = await gatewayFetch(`/admin/appeals?status=${encodeURIComponent(which)}&limit=100`);
      if (version === generation.current) setRows(data.appeals || []);
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
      <Chip tone="danger" className="mt-5 mb-3">ADMIN · APPEALS</Chip>
      <h1 className="text-3xl font-black tracking-[-0.02em]">Content appeals</h1>
      <p className="my-5 text-vx-fg-body max-w-[640px]">
        A user can contest a warning, a takedown or the freeze a third takedown causes. Read their statement next to the
        reason that was recorded, then decide once. <b>Upholding</b> removes the strike from the count, shortens or ends the
        generation hold and lifts a content freeze when fewer than three strikes remain; deleted files are not restored.
        <b> Rejecting</b> records why. The user is emailed either way, without your reason.
      </p>
      <MfaPanel />

      <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Appeal status">
        {['open', 'upheld', 'rejected'].map((s) => (
          <Button key={s} size="sm" variant={status === s ? 'primary' : 'ghost'} role="tab" aria-selected={status === s} onClick={() => { setRows(null); setStatus(s); }}>
            {s[0].toUpperCase() + s.slice(1)}
          </Button>
        ))}
      </div>
      {error && <p role="alert" className="mt-4 text-vx-danger">{error}</p>}
      {rows === null && !error && <p className="mt-6 text-sm text-vx-fg-muted">Loading…</p>}
      {rows && rows.length === 0 && <p className="mt-6 text-sm text-vx-fg-muted">No {status} appeals.</p>}
      <div className="mt-6 space-y-4">
        {(rows || []).map((a) => <AppealCard key={a.id} appeal={a} onDone={() => load(status)} />)}
      </div>
    </div>
  );
}

function AppealCard({ appeal: a, onDone }) {
  const [decision, setDecision] = useState(null); // 'upheld' | 'rejected' | null
  return (
    <section className="rounded-2xl border border-vx-border bg-vx-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-bold truncate">{a.email}</h2>
          <div className="mt-1 font-vx-mono text-[11px] text-vx-fg-muted break-all">{a.user_id}</div>
          <div className="mt-2 text-xs text-vx-fg-muted">Appealed {when(a.submitted_at)} · {a.standing_takedowns} standing takedown{a.standing_takedowns === 1 ? '' : 's'}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip tone={a.action === 'warning' ? 'warn' : 'danger'} noGlyph>{a.action}</Chip>
          {a.frozen_at && <Chip tone="danger">Frozen</Chip>}
          {a.status !== 'open' && <Chip tone={a.status === 'upheld' ? 'accent' : 'neutral'} noGlyph>{a.status}</Chip>}
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-vx-border p-3">
          <dt className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">RECORDED {when(a.action_at)} BY {String(a.action_actor || '').toUpperCase()}</dt>
          <dd className="mt-1 whitespace-pre-wrap wrap-break-word">{a.action_reason}</dd>
          {a.job_id && <dd className="mt-1 font-vx-mono text-[10px] text-vx-fg-muted break-all">{a.model_id || 'job'} · {a.job_id}</dd>}
          {a.hold_until && <dd className="mt-1 text-xs text-vx-fg-muted">Hold until {when(a.hold_until)}</dd>}
        </div>
        <div className="rounded-lg border border-vx-border p-3">
          <dt className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">THE USER SAYS</dt>
          <dd className="mt-1 whitespace-pre-wrap wrap-break-word">{a.statement}</dd>
        </div>
      </dl>

      {a.status !== 'open' && (
        <p className="mt-3 text-xs text-vx-fg-muted">Decided {when(a.decided_at)} by {a.decided_by}: {a.decision_reason}</p>
      )}
      {a.status === 'open' && !decision && (
        <div className="mt-4 flex gap-2">
          <Button size="sm" onClick={() => setDecision('upheld')}>Uphold appeal</Button>
          <Button size="sm" variant="danger" onClick={() => setDecision('rejected')}>Reject appeal</Button>
          <Link href={`/app/admin/users?user=${encodeURIComponent(a.user_id)}`} className="self-center text-xs underline">Open account</Link>
        </div>
      )}
      {decision && <DecisionForm appeal={a} decision={decision} onCancel={() => setDecision(null)} onDone={() => { setDecision(null); onDone(); }} />}
    </section>
  );
}

function DecisionForm({ appeal, decision, onCancel, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const attempt = useRef(null);

  async function submit(event) {
    event.preventDefault();
    const body = JSON.stringify({ appeal_id: appeal.id, decision, reason: reason.trim() });
    if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
    setBusy(true); setError('');
    try {
      const r = await gatewayFetch('/admin/appeals', { method: 'POST', body, headers: { 'idempotency-key': attempt.current.key } });
      setResult(r);
    } catch (e) {
      setError(message(e.code)); setBusy(false);
    }
  }

  if (result) {
    return (
      <div role="status" className="mt-3 rounded-lg border border-vx-border p-4 text-sm">
        Appeal {result.status}. {result.standing_takedowns} standing takedown{result.standing_takedowns === 1 ? '' : 's'}
        {result.unfrozen ? '; the account has been unfrozen' : ''}{result.hold_until ? `; generation held until ${when(result.hold_until)}` : ''}.
        {result.email === 'sent' && <p className="mt-2 text-vx-fg-muted">The user has been emailed.</p>}
        {result.email === 'failed' && <p role="alert" className="mt-2 text-vx-danger">The email to the user failed. The decision stands; tell them yourself.</p>}
        {result.email === 'skipped' && <p className="mt-2 text-vx-warn">No email was sent: email sending is not configured.</p>}
        <div className="mt-3"><Button size="sm" onClick={onDone}>Done</Button></div>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="mt-3 rounded-lg border border-vx-border p-4 space-y-3" aria-label={`${decision === 'upheld' ? 'Uphold' : 'Reject'} this appeal`}>
      <label className="block text-sm">
        Why the appeal is {decision}
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={500} rows={2}
          className="mt-2 w-full rounded-lg border border-vx-border bg-vx-panel p-3 text-sm" />
      </label>
      <p className="text-xs text-vx-fg-muted">
        Recorded with your email in the append-only account log. The user is told the outcome, never this text.
        {decision === 'upheld' && appeal.action === 'takedown' && ' The strike stops counting; the files stay deleted.'}
      </p>
      {error && <p role="alert" className="text-vx-danger text-sm">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant={decision === 'rejected' ? 'danger' : 'primary'} disabled={busy || reason.trim().length < 3}>
          {busy ? 'Saving…' : decision === 'upheld' ? 'Uphold and reverse' : 'Reject appeal'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );
}

function message(code) {
  return ({
    no_token: 'Sign in with an administrator account.',
    unauthenticated: 'Sign in with an administrator account.',
    not_admin: 'This account is not an administrator.',
    mfa_required: 'Unlock this session with your authenticator above, then try again.',
    appeal_not_found: 'That appeal no longer exists. Refresh the list.',
    appeal_decided: 'This appeal was already decided. Refresh the list.',
    reason_invalid: 'Give a reason of 3 to 500 characters.',
    rate_limited: 'Too many requests. Wait a minute and try again.',
  })[code] || 'The appeals queue is unavailable right now. Please retry.';
}
