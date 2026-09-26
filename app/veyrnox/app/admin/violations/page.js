'use client';

/**
 * Content violations: the operator surface over /api/v1/admin/violations and
 * /api/v1/admin/users/lookup (ADR-0058 decision 7, tier table in
 * docs/agents/incident-response.md).
 *
 * Look a user up by email, user id or job id; see their standing (Frozen,
 * Rights Attestation, strikes) and last 25 generations; record a Content
 * Warning against the account or a Takedown against one job. A takedown
 * removes the asset at once and the third one Freezes the account, so every
 * action asks for a reason and confirms before it is sent. The record below
 * is the append-only account_actions log, newest first.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { AccountBoundary } from '../../../_components/AccountBoundary';
import { MfaPanel } from '../../../_components/MfaPanel';
import { Button } from '../../../_components/Button';
import { Chip } from '../../../_components/Chip';
import { gatewayFetch } from '../../../_lib/gateway';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const when = (iso) => (iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—');

export default function Page() {
  return <><AppNav /><AccountBoundary><Violations /></AccountBoundary></>;
}

function Violations() {
  const [query, setQuery] = useState('');
  const [lookup, setLookup] = useState(null);      // { user, jobs }
  const [record, setRecord] = useState([]);        // account_actions rows
  const [recordLoaded, setRecordLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);

  const loadRecord = useCallback(async (userId) => {
    const version = ++generation.current;
    try {
      const data = await gatewayFetch(`/admin/violations${userId ? `?user_id=${encodeURIComponent(userId)}` : ''}`);
      if (version === generation.current) { setRecord(data.violations || []); setRecordLoaded(true); }
    } catch (e) {
      if (version === generation.current) setError(message(e.code));
    }
  }, []);

  useEffect(() => { loadRecord(null); return () => { generation.current++; }; }, [loadRecord]);

  async function find(event) {
    event?.preventDefault();
    const q = query.trim();
    if (!q) return;
    setBusy(true); setError(''); setLookup(null);
    const key = UUID_RE.test(q) ? 'user_id' : 'email';
    try {
      let data;
      try {
        data = await gatewayFetch(`/admin/users/lookup?${key}=${encodeURIComponent(q)}`);
      } catch (e) {
        // A UUID that is not a user may be a job id.
        if (key === 'user_id' && e.code === 'user_not_found') data = await gatewayFetch(`/admin/users/lookup?job_id=${encodeURIComponent(q)}`);
        else throw e;
      }
      setLookup(data);
      await loadRecord(data.user.id);
    } catch (e) {
      setError(message(e.code));
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (!lookup) return loadRecord(null);
    try {
      const data = await gatewayFetch(`/admin/users/lookup?user_id=${encodeURIComponent(lookup.user.id)}`);
      setLookup(data);
      await loadRecord(data.user.id);
    } catch (e) { setError(message(e.code)); }
  }

  return (
    <main id="main" className="mx-auto max-w-4xl px-4 py-10 pb-32 sm:px-8">
      <Link href="/app/admin" className="text-sm underline">Back to operations</Link>
      <Chip tone="danger" className="mt-5 mb-3">ADMIN · CONTENT</Chip>
      <h1 className="text-3xl font-black tracking-[-0.02em]">Content violations</h1>
      <p className="my-5 text-vx-fg-body max-w-[640px]">
        A <b>warning</b> is recorded against the account and removes nothing. A <b>takedown</b> removes that generation&apos;s
        asset immediately; the third takedown freezes the account. Every action names you, the reason and the job, and
        cannot be edited. Process: <code className="font-vx-mono text-xs">docs/agents/incident-response.md</code>.
      </p>
      <MfaPanel />

      <form onSubmit={find} className="mt-6 flex flex-wrap items-end gap-3" aria-label="Find a user">
        <label className="grow min-w-[260px]">
          <span className="block font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">EMAIL, USER ID OR JOB ID</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" spellCheck={false}
            className="mt-1 w-full rounded-lg border border-vx-border bg-vx-panel p-3 text-sm font-vx-mono focus:outline-none focus:border-vx-accent" />
        </label>
        <Button type="submit" disabled={busy || !query.trim()}>{busy ? 'Looking…' : 'Find'}</Button>
        {lookup && <Button type="button" variant="ghost" onClick={() => { setLookup(null); setQuery(''); loadRecord(null); }}>Clear</Button>}
      </form>
      {error && <p role="alert" className="mt-4 text-vx-danger">{error}</p>}

      {lookup && <UserCard user={lookup.user} onDone={refresh} />}
      {lookup && <Jobs jobs={lookup.jobs} user={lookup.user} onDone={refresh} />}

      <Record rows={record} loaded={recordLoaded} scoped={!!lookup} />
    </main>
  );
}

function UserCard({ user, onDone }) {
  const [warning, setWarning] = useState(false);
  return (
    <section className="mt-8 rounded-2xl border border-vx-border bg-vx-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-bold truncate">{user.email}</h2>
          <div className="mt-1 font-vx-mono text-[11px] text-vx-fg-muted break-all">{user.id}</div>
          <div className="mt-2 text-xs text-vx-fg-muted">
            Joined {when(user.created_at)} · Rights attestation {user.rights_attested_at ? `${when(user.rights_attested_at)} (${user.rights_attestation_version})` : 'none yet'}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {user.frozen_at && <Chip tone="danger">Frozen {when(user.frozen_at)}</Chip>}
          <Chip tone={user.takedowns >= 2 ? 'danger' : user.takedowns ? 'warn' : 'neutral'} noGlyph>{user.takedowns} takedown{user.takedowns === 1 ? '' : 's'}</Chip>
          <Chip tone="neutral" noGlyph>{user.warnings} warning{user.warnings === 1 ? '' : 's'}</Chip>
        </div>
      </div>
      {!warning && <Button className="mt-4" size="sm" variant="ghost" onClick={() => setWarning(true)}>Record a warning</Button>}
      {warning && <ActionForm tier="warning" userId={user.id} onCancel={() => setWarning(false)} onDone={() => { setWarning(false); onDone(); }} />}
    </section>
  );
}

function Jobs({ jobs, user, onDone }) {
  const [open, setOpen] = useState(null); // job_id with the takedown form open
  return (
    <section className="mt-6">
      <h2 className="text-lg font-black tracking-[-0.02em] mb-3">Last {jobs.length} generation{jobs.length === 1 ? '' : 's'}</h2>
      <div className="rounded-[10px] border border-vx-border bg-vx-panel overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[1fr_170px_90px_130px_150px] px-5 py-3 border-b border-vx-border font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">
            <div>JOB</div><div>MODEL</div><div>STATE</div><div>ASSET</div><div className="text-right">ACTION</div>
          </div>
          {jobs.length === 0 && <div className="px-5 py-4 text-sm text-vx-fg-muted">No generations.</div>}
          {jobs.map((j) => (
            <div key={j.job_id} className="border-b border-vx-border/60 last:border-b-0">
              <div className="grid grid-cols-[1fr_170px_90px_130px_150px] items-center px-5 py-3">
                <div className="min-w-0">
                  <div className="font-vx-mono text-[11px] break-all">{j.job_id}</div>
                  <div className="text-xs text-vx-fg-muted">{when(j.created_at)}{j.consent_attested_at ? ' · consent recorded' : ''}</div>
                </div>
                <div className="text-sm truncate">{j.model_id}</div>
                <div className="font-vx-mono text-xs">{String(j.state).toLowerCase()}</div>
                <div className="text-xs">
                  {j.taken_down ? <Chip tone="danger" noGlyph>Taken down</Chip> : j.has_asset ? <Chip tone="accent" noGlyph>Served</Chip> : <span className="text-vx-fg-muted">none</span>}
                </div>
                <div className="text-right">
                  {!j.taken_down && j.has_asset && open !== j.job_id && (
                    <Button size="sm" variant="danger" onClick={() => setOpen(j.job_id)}>Take down</Button>
                  )}
                </div>
              </div>
              {open === j.job_id && (
                <div className="px-5 pb-4">
                  <ActionForm tier="takedown" userId={user.id} jobId={j.job_id} strikes={user.takedowns}
                    onCancel={() => setOpen(null)} onDone={() => { setOpen(null); onDone(); }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ActionForm({ tier, userId, jobId = null, strikes = 0, onCancel, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const attempt = useRef(null);
  const willFreeze = tier === 'takedown' && strikes >= 2;

  async function submit(event) {
    event.preventDefault();
    const body = JSON.stringify({ user_id: userId, job_id: jobId, tier, reason: reason.trim() });
    if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
    setBusy(true); setError('');
    try {
      const r = await gatewayFetch('/admin/violations', { method: 'POST', body, headers: { 'idempotency-key': attempt.current.key } });
      setResult(r);
    } catch (e) {
      setError(message(e.code)); setBusy(false);
    }
  }

  if (result) {
    return (
      <div role="status" className="mt-3 rounded-lg border border-vx-border p-4 text-sm">
        Recorded {result.tier}{result.assets_removed ? `, ${result.assets_removed} asset${result.assets_removed === 1 ? '' : 's'} removed` : ''}.
        {' '}{result.takedowns} takedown{result.takedowns === 1 ? '' : 's'} on this account{result.frozen ? '; the account is now frozen.' : '.'}
        <div className="mt-3"><Button size="sm" onClick={onDone}>Done</Button></div>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="mt-3 rounded-lg border border-vx-border p-4 space-y-3" aria-label={`Record a ${tier}`}>
      <label className="block text-sm">
        Reason for the {tier}
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={500} rows={2}
          className="mt-2 w-full rounded-lg border border-vx-border bg-vx-panel p-3 text-sm" />
      </label>
      <p className="text-xs text-vx-fg-muted">
        Recorded with your email in the append-only account log{jobId ? ' against this job' : ''}. Do not paste the content itself or other people&apos;s details.
        {tier === 'takedown' && ' The asset is removed the moment this is saved.'}
        {willFreeze && ' This is the third takedown: the account will be frozen.'}
      </p>
      {error && <p role="alert" className="text-vx-danger text-sm">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant={tier === 'takedown' ? 'danger' : 'primary'} disabled={busy || reason.trim().length < 3}>
          {busy ? 'Saving…' : willFreeze ? 'Take down and freeze' : tier === 'takedown' ? 'Take down' : 'Record warning'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );
}

function Record({ rows, loaded, scoped }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-black tracking-[-0.02em] mb-3">{scoped ? 'Record for this account' : 'Recent record, all accounts'}</h2>
      <div className="rounded-[10px] border border-vx-border bg-vx-panel overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-[150px_110px_1fr_1fr_170px] px-5 py-3 border-b border-vx-border font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">
            <div>WHEN</div><div>ACTION</div><div>ACCOUNT</div><div>REASON</div><div>BY</div>
          </div>
          {loaded && rows.length === 0 && <div className="px-5 py-4 text-sm text-vx-fg-muted">Nothing recorded.</div>}
          {rows.map((r) => (
            <div key={r.id} className="grid grid-cols-[150px_110px_1fr_1fr_170px] items-start px-5 py-3 border-b border-vx-border/60 last:border-b-0 text-sm">
              <div className="font-vx-mono text-xs">{when(r.created_at)}</div>
              <div><Chip tone={r.action === 'warning' ? 'warn' : 'danger'} noGlyph>{r.action}</Chip></div>
              <div className="min-w-0">
                <div className="truncate">{r.email}</div>
                {r.job_id && <div className="font-vx-mono text-[10px] text-vx-fg-muted break-all">{r.model_id || 'job'} · {r.job_id}</div>}
              </div>
              <div className="whitespace-pre-wrap break-words pr-3">{r.reason}</div>
              <div className="text-xs text-vx-fg-muted truncate">{r.actor}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function message(code) {
  return ({
    no_token: 'Sign in with an administrator account.',
    unauthenticated: 'Sign in with an administrator account.',
    not_admin: 'This account is not an administrator.',
    mfa_required: 'Unlock this session with your authenticator above, then try again.',
    user_not_found: 'No account matches that email, user id or job id.',
    job_not_found: 'That job does not exist.',
    job_not_owned: 'That job belongs to a different account. Refresh and try again.',
    email_invalid: 'That does not look like an email address.',
    lookup_invalid: 'Enter one email, user id or job id.',
    reason_invalid: 'Give a reason of 3 to 500 characters.',
    rate_limited: 'Too many requests. Wait a minute and try again.',
  })[code] || 'The violations record is unavailable right now. Please retry.';
}
