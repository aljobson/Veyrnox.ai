'use client';

/**
 * One account, in full: standing, balance buckets, every ledger row with its
 * reason, the append-only action log, and a reasoned Credit grant
 * (ADR-0083). Reads /api/v1/admin/users/lookup and /api/v1/admin/users/ledger;
 * the grant is a POST to the latter with an Idempotency-Key per attempt, so a
 * lost response and a resubmit move the balance once.
 */

import { useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { AccountBoundary } from '../../../_components/AccountBoundary';
import { MfaPanel } from '../../../_components/MfaPanel';
import { Button } from '../../../_components/Button';
import { Chip } from '../../../_components/Chip';
import { gatewayFetch } from '../../../_lib/gateway';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const nf = new Intl.NumberFormat('en-US');
const when = (iso) => (iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—');
const signed = (n) => (n > 0 ? `+${nf.format(n)}` : nf.format(n));

export default function Page() {
  return <><AppNav /><Main><AccountBoundary><Account /></AccountBoundary></Main></>;
}

function Account() {
  const [query, setQuery] = useState('');
  const [lookup, setLookup] = useState(null);   // { user, jobs }
  const [ledger, setLedger] = useState(null);   // { balance, entries, actions }
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);

  const loadLedger = useCallback(async (userId) => {
    const version = ++generation.current;
    const data = await gatewayFetch(`/admin/users/ledger?user_id=${encodeURIComponent(userId)}&limit=200`);
    if (version === generation.current) setLedger(data);
  }, []);

  async function find(event) {
    event?.preventDefault();
    const q = query.trim();
    if (!q) return;
    setBusy(true); setError(''); setLookup(null); setLedger(null);
    const key = UUID_RE.test(q) ? 'user_id' : 'email';
    try {
      let data;
      try {
        data = await gatewayFetch(`/admin/users/lookup?${key}=${encodeURIComponent(q)}`);
      } catch (e) {
        if (key === 'user_id' && e.code === 'user_not_found') data = await gatewayFetch(`/admin/users/lookup?job_id=${encodeURIComponent(q)}`);
        else throw e;
      }
      setLookup(data);
      await loadLedger(data.user.id);
    } catch (e) {
      setError(message(e.code));
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (!lookup) return;
    try { await loadLedger(lookup.user.id); } catch (e) { setError(message(e.code)); }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 pb-32 sm:px-8">
      <Link href="/app/admin" className="text-sm underline">Back to operations</Link>
      <Chip tone="danger" className="mt-5 mb-3">ADMIN · ACCOUNTS</Chip>
      <h1 className="text-3xl font-black tracking-[-0.02em]">Account ledger</h1>
      <p className="my-5 text-vx-fg-body max-w-[640px]">
        Every credit movement on one account, with the reason the ledger recorded, and the append-only action log.
        A grant adds Pack credits through the ledger with your email and a note that only administrators see; it cannot be edited afterwards.
        Content warnings and takedowns are recorded on the <Link href="/app/admin/violations" className="underline">violations page</Link>.
      </p>
      <MfaPanel />

      <form onSubmit={find} className="mt-6 flex flex-wrap items-end gap-3" aria-label="Find a user">
        <label className="grow min-w-[260px]">
          <span className="block font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">EMAIL, USER ID OR JOB ID</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" spellCheck={false}
            className="mt-1 w-full rounded-lg border border-vx-border bg-vx-panel p-3 text-sm font-vx-mono focus:outline-hidden focus:border-vx-accent" />
        </label>
        <Button type="submit" disabled={busy || !query.trim()}>{busy ? 'Looking…' : 'Find'}</Button>
        {lookup && <Button type="button" variant="ghost" onClick={() => { setLookup(null); setLedger(null); setQuery(''); }}>Clear</Button>}
      </form>
      {error && <p role="alert" className="mt-4 text-vx-danger">{error}</p>}

      {lookup && <Standing user={lookup.user} balance={ledger?.balance} />}
      {lookup && <GrantForm userId={lookup.user.id} onDone={refresh} />}
      {ledger && <Entries rows={ledger.entries} />}
      {ledger && <Actions rows={ledger.actions} />}
    </div>
  );
}

function Standing({ user, balance }) {
  const live = balance && balance.subscription_expires_at && new Date(balance.subscription_expires_at) > new Date();
  const pack = balance ? balance.balance - balance.free_balance - (live ? balance.subscription_balance : 0) : null;
  return (
    <section className="mt-8 rounded-2xl border border-vx-border bg-vx-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-bold truncate">{user.email}</h2>
          <div className="mt-1 font-vx-mono text-[11px] text-vx-fg-muted break-all">{user.id}</div>
          <div className="mt-2 text-xs text-vx-fg-muted">Joined {when(user.created_at)}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {user.frozen_at && <Chip tone="danger">Frozen {when(user.frozen_at)}</Chip>}
          <Chip tone={user.takedowns >= 2 ? 'danger' : user.takedowns ? 'warn' : 'neutral'} noGlyph>{user.takedowns} takedown{user.takedowns === 1 ? '' : 's'}</Chip>
          <Chip tone="neutral" noGlyph>{user.warnings} warning{user.warnings === 1 ? '' : 's'}</Chip>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['Balance', balance ? nf.format(balance.balance) : '—', true],
          ['Pack', pack == null ? '—' : nf.format(pack), false],
          ['Free', balance ? nf.format(balance.free_balance) : '—', false],
          ['Subscription', balance ? `${nf.format(balance.subscription_balance)}${balance.subscription_balance && !live ? ' (expired)' : ''}` : '—', false],
        ].map(([label, value, money]) => (
          <div key={label} className="rounded-[10px] border border-vx-border p-3">
            <div className="font-vx-mono text-[9.5px] tracking-[0.12em] text-vx-fg-muted">{label.toUpperCase()}</div>
            <div className={`mt-1 font-vx-mono text-[22px] font-bold vx-num ${money ? 'text-vx-money' : ''}`}>{value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function GrantForm({ userId, onDone }) {
  const [open, setOpen] = useState(false);
  const [credits, setCredits] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const attempt = useRef(null);
  const amount = Number(credits);
  const valid = Number.isInteger(amount) && amount >= 1 && amount <= 100000 && reason.trim().length >= 3 && reason.length <= 200;

  async function submit(event) {
    event.preventDefault();
    if (!valid) return;
    const body = JSON.stringify({ user_id: userId, credits: amount, reason: reason.trim() });
    // One key per distinct attempt: a resubmit of the same form replays, a changed form is a new grant.
    if (attempt.current?.body !== body) attempt.current = { body, key: crypto.randomUUID() };
    setBusy(true); setError('');
    try {
      const r = await gatewayFetch('/admin/users/ledger', { method: 'POST', body, headers: { 'idempotency-key': attempt.current.key } });
      setResult(r);
      onDone();
    } catch (e) {
      setError(message(e.code));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return <Button className="mt-4" size="sm" variant="ghost" onClick={() => setOpen(true)}>Grant credits</Button>;
  if (result) {
    return (
      <div role="status" className="mt-4 rounded-lg border border-vx-border p-4 text-sm">
        {result.replayed ? 'This grant was already recorded.' : `Granted ${nf.format(result.credits_delta)} credits.`}
        {' '}Balance is now {nf.format(result.balance_after)}.
        <div className="mt-3"><Button size="sm" onClick={() => { setOpen(false); setResult(null); setCredits(''); setReason(''); attempt.current = null; }}>Done</Button></div>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="mt-4 rounded-lg border border-vx-border p-4 space-y-3" aria-label="Grant credits">
      <div className="flex flex-wrap gap-3">
        <label className="block text-sm w-40">
          Credits
          <input type="number" min={1} max={100000} step={1} value={credits} onChange={(e) => setCredits(e.target.value)} required
            className="mt-2 w-full rounded-lg border border-vx-border bg-vx-panel p-3 text-sm font-vx-mono" />
        </label>
        <label className="block text-sm grow min-w-[260px]">
          Reason (3 to 200 characters, administrators only)
          <input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={200}
            className="mt-2 w-full rounded-lg border border-vx-border bg-vx-panel p-3 text-sm" />
        </label>
      </div>
      <p className="text-xs text-vx-fg-muted">
        Appends a Pack grant to the ledger with your email as the actor. Name the ticket or the decision; do not paste the user&apos;s messages.
        Credits cannot be taken back from here.
      </p>
      {error && <p role="alert" className="text-vx-danger text-sm">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || !valid}>{busy ? 'Saving…' : `Grant ${valid ? nf.format(amount) : ''} credits`}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );
}

function Entries({ rows }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-black tracking-[-0.02em] mb-3">Ledger, newest first</h2>
      <div className="rounded-[10px] border border-vx-border bg-vx-panel overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[150px_90px_90px_90px_1fr] px-5 py-3 border-b border-vx-border font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">
            <div>WHEN</div><div className="text-right">DELTA</div><div className="text-right">FREE</div><div className="text-right">SUB</div><div className="pl-4">REASON</div>
          </div>
          {rows.length === 0 && <div className="px-5 py-4 text-sm text-vx-fg-muted">No ledger rows.</div>}
          {rows.map((r) => (
            <div key={r.id} className="grid grid-cols-[150px_90px_90px_90px_1fr] items-start px-5 py-2.5 border-b border-vx-border/60 last:border-b-0 text-sm">
              <div className="font-vx-mono text-xs">{when(r.created_at)}</div>
              <div className={`text-right font-vx-mono vx-num ${r.delta < 0 ? '' : 'text-vx-money'}`}>{signed(r.delta)}</div>
              <div className="text-right font-vx-mono text-xs vx-num text-vx-fg-muted">{r.free_delta ? signed(r.free_delta) : ''}</div>
              <div className="text-right font-vx-mono text-xs vx-num text-vx-fg-muted">{r.subscription_delta ? signed(r.subscription_delta) : ''}</div>
              <div className="pl-4 min-w-0">
                <div className="font-vx-mono text-xs break-all">{r.reason}</div>
                {r.job_id && <div className="font-vx-mono text-[10px] text-vx-fg-muted break-all">job {r.job_id}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Actions({ rows }) {
  const tone = (a) => (a === 'credit_grant' ? 'accent' : a === 'warning' ? 'warn' : a === 'unfreeze' || a === 'dispute_resolved' ? 'neutral' : 'danger');
  return (
    <section className="mt-10">
      <h2 className="text-lg font-black tracking-[-0.02em] mb-3">Account actions</h2>
      <div className="rounded-[10px] border border-vx-border bg-vx-panel overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[150px_130px_1fr_170px] px-5 py-3 border-b border-vx-border font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">
            <div>WHEN</div><div>ACTION</div><div>REASON</div><div>BY</div>
          </div>
          {rows.length === 0 && <div className="px-5 py-4 text-sm text-vx-fg-muted">Nothing recorded.</div>}
          {rows.map((r) => (
            <div key={r.id} className="grid grid-cols-[150px_130px_1fr_170px] items-start px-5 py-3 border-b border-vx-border/60 last:border-b-0 text-sm">
              <div className="font-vx-mono text-xs">{when(r.created_at)}</div>
              <div><Chip tone={tone(r.action)} noGlyph>{r.action.replace('_', ' ')}</Chip>{r.credits_delta ? <span className="ml-2 font-vx-mono text-xs vx-num">{signed(r.credits_delta)}</span> : null}</div>
              <div className="whitespace-pre-wrap wrap-break-word pr-3 min-w-0">
                {r.reason}
                {r.job_id && <div className="font-vx-mono text-[10px] text-vx-fg-muted break-all">job {r.job_id}</div>}
              </div>
              <div className="text-xs text-vx-fg-muted truncate">{r.actor}{r.action === 'csam_escalation' && <ReleaseEvidence actionId={r.id} />}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ReleaseEvidence({ actionId }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const r = await gatewayFetch('/admin/reports', { method: 'POST', body: JSON.stringify({ release_action_id: actionId, reason: reason.trim() }) });
      setResult(r.released ? `${r.released} file${r.released === 1 ? '' : 's'} queued for deletion.` : 'Nothing was left on hold.');
    } catch (e) {
      setResult(message(e.code));
    } finally {
      setBusy(false);
    }
  }
  if (result) return <div className="mt-1 text-[11px]">{result}</div>;
  if (!open) return <div className="mt-1"><button type="button" onClick={() => setOpen(true)} className="text-[11px] underline">Release evidence</button></div>;
  return (
    <form onSubmit={submit} className="mt-1 space-y-1" aria-label="Release evidence hold">
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Report acknowledged, retention over" required minLength={3} maxLength={500}
        className="w-full rounded border border-vx-border bg-vx-panel p-1 text-[11px]" />
      <div className="flex gap-2">
        <button type="submit" disabled={busy || reason.trim().length < 3} className="text-[11px] font-bold underline disabled:opacity-50">Release</button>
        <button type="button" onClick={() => setOpen(false)} className="text-[11px] underline">Cancel</button>
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
    user_not_found: 'No account matches that email, user id or job id.',
    email_invalid: 'That does not look like an email address.',
    lookup_invalid: 'Enter one email, user id or job id.',
    credits_invalid: 'Credits must be a whole number from 1 to 100,000.',
    reason_invalid: 'Give a reason of 3 to 200 characters.',
    idempotency_key_reused: 'That attempt key was used for a different grant. Cancel and start again.',
    grant_already_applied: 'The ledger already holds this grant. Refresh and check the ledger before trying again.',
    rate_limited: 'Too many requests. Wait a minute and try again.',
    action_not_found: 'That escalation no longer exists.',
    reason_invalid: 'Give a reason of 3 to 500 characters.',
  })[code] || 'The account ledger is unavailable right now. Please retry.';
}
