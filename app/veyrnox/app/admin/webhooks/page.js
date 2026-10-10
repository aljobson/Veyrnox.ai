'use client';

/**
 * Inbound webhook health (ADR-0083): what each provider delivered in the
 * window and how we answered, the refusals and failures with their typed
 * error so a class points at a fix, and accepted events that never finished.
 * Reads /api/v1/admin/webhooks.
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

const nf = new Intl.NumberFormat('en-US');
const when = (iso) => (iso ? new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—');
const FIX = {
  rejected_signature: 'The provider signed with a key we do not hold, or the secret was rotated on one side only. Check the webhook secret for this source.',
  rejected: 'The body or the event was not one we accept. Compare the provider’s payload version with the adapter.',
  unavailable: 'We answered 502/503: a provider re-read failed or a secret is unset. The provider will redeliver; check the Worker secrets and the provider status page.',
  failed: 'A 500 from our handler. Read the Worker log for this minute; the provider will redeliver.',
};

export default function Page() {
  return <><AppNav /><Main><AccountBoundary><Webhooks /></AccountBoundary></Main></>;
}

function Webhooks() {
  const [hours, setHours] = useState(24);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const generation = useRef(0);

  const load = useCallback(async (h) => {
    const version = ++generation.current;
    setError('');
    try {
      const d = await gatewayFetch(`/admin/webhooks?hours=${h}&limit=100`);
      if (version === generation.current) setData(d);
    } catch (e) {
      if (version === generation.current) { setData(null); setError(message(e.code)); }
    }
  }, []);

  // A request counter, not a DOM node: the cleanup must bump the live value.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(hours); return () => { generation.current++; }; }, [load, hours]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 pb-32 sm:px-8">
      <Link href="/app/admin" className="text-sm underline">Back to operations</Link>
      <Chip tone="danger" className="mt-5 mb-3">ADMIN · WEBHOOKS</Chip>
      <h1 className="text-3xl font-black tracking-[-0.02em]">Inbound webhooks</h1>
      <p className="my-5 text-vx-fg-body max-w-[640px]">
        Every delivery a provider sent us and how we answered. A refusal class names its fix. An event that was accepted but
        never marked processed means the handler died after the dedupe insert: the provider should redeliver, or the sweep refunds it.
        Logging is on when <code className="font-vx-mono text-xs">WEBHOOK_DELIVERY_LOG_ENABLED</code> is true.
      </p>
      <MfaPanel />
      <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Window">
        {[1, 24, 168].map((h) => (
          <Button key={h} size="sm" variant={hours === h ? 'primary' : 'ghost'} role="tab" aria-selected={hours === h} onClick={() => setHours(h)}>
            {h === 1 ? 'Last hour' : h === 24 ? 'Last 24 hours' : 'Last 7 days'}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => load(hours)}>Refresh</Button>
      </div>
      {error && <p role="alert" className="mt-4 text-vx-danger">{error}</p>}
      {data && <BySource rows={data.by_source} />}
      {data && <Failures rows={data.failures} />}
      {data && <Stuck rows={data.stuck_events} />}
    </div>
  );
}

function BySource({ rows }) {
  const cols = 'grid-cols-[140px_repeat(7,80px)_1fr]';
  return (
    <section className="mt-8">
      <h2 className="text-lg font-black tracking-[-0.02em] mb-3">By source</h2>
      <div className="rounded-[10px] border border-vx-border bg-vx-panel overflow-x-auto">
        <div className="min-w-[900px]">
          <div className={`grid ${cols} px-5 py-3 border-b border-vx-border font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted`}>
            <div>SOURCE</div><div className="text-right">TOTAL</div><div className="text-right">ACCEPTED</div><div className="text-right">DUPLICATE</div>
            <div className="text-right">OTHER OK</div><div className="text-right">BAD SIG</div><div className="text-right">REJECTED</div><div className="text-right">502/5XX</div><div className="pl-4">LAST BAD</div>
          </div>
          {rows.length === 0 && <div className="px-5 py-4 text-sm text-vx-fg-muted">No deliveries recorded in this window.</div>}
          {rows.map((r) => (
            <div key={r.source} className={`grid ${cols} items-center px-5 py-3 border-b border-vx-border/60 last:border-b-0 text-sm`}>
              <div className="font-bold">{r.source}</div>
              <div className="text-right font-vx-mono vx-num">{nf.format(r.total)}</div>
              <div className="text-right font-vx-mono vx-num">{nf.format(r.accepted)}</div>
              <div className="text-right font-vx-mono vx-num text-vx-fg-muted">{nf.format(r.duplicate)}</div>
              <div className="text-right font-vx-mono vx-num text-vx-fg-muted">{nf.format(r.other_ok)}</div>
              <div className={`text-right font-vx-mono vx-num ${r.rejected_signature ? 'text-vx-danger' : ''}`}>{nf.format(r.rejected_signature)}</div>
              <div className={`text-right font-vx-mono vx-num ${r.rejected ? 'text-vx-warn' : ''}`}>{nf.format(r.rejected)}</div>
              <div className={`text-right font-vx-mono vx-num ${(r.unavailable + r.failed) ? 'text-vx-danger' : ''}`}>{nf.format(r.unavailable + r.failed)}</div>
              <div className="pl-4 font-vx-mono text-xs text-vx-fg-muted">{when(r.last_bad_at)}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Failures({ rows }) {
  const classes = [...new Set(rows.map((r) => r.outcome))];
  return (
    <section className="mt-10">
      <h2 className="text-lg font-black tracking-[-0.02em] mb-3">Refused or failed, newest first</h2>
      {classes.length > 0 && (
        <ul className="mb-3 space-y-1 text-xs text-vx-fg-body">
          {classes.map((c) => FIX[c] && <li key={c}><b>{c.replace('_', ' ')}:</b> {FIX[c]}</li>)}
        </ul>
      )}
      <div className="rounded-[10px] border border-vx-border bg-vx-panel overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="grid grid-cols-[150px_120px_170px_80px_1fr] px-5 py-3 border-b border-vx-border font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">
            <div>WHEN</div><div>SOURCE</div><div>OUTCOME</div><div className="text-right">STATUS</div><div className="pl-4">ERROR</div>
          </div>
          {rows.length === 0 && <div className="px-5 py-4 text-sm text-vx-fg-muted">Nothing refused or failed.</div>}
          {rows.map((r) => (
            <div key={r.id} className="grid grid-cols-[150px_120px_170px_80px_1fr] items-center px-5 py-2.5 border-b border-vx-border/60 last:border-b-0 text-sm">
              <div className="font-vx-mono text-xs">{when(r.created_at)}</div>
              <div className="font-bold">{r.source}</div>
              <div><Chip tone={r.outcome === 'rejected' ? 'warn' : 'danger'} noGlyph>{r.outcome.replace('_', ' ')}</Chip></div>
              <div className="text-right font-vx-mono vx-num">{r.http_status}</div>
              <div className="pl-4 font-vx-mono text-xs break-all">{r.error || '—'}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Stuck({ rows }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-black tracking-[-0.02em] mb-3">Accepted, never finished (over 10 minutes)</h2>
      <div className="rounded-[10px] border border-vx-border bg-vx-panel overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-[150px_120px_1fr] px-5 py-3 border-b border-vx-border font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">
            <div>RECEIVED</div><div>SOURCE</div><div>EXTERNAL ID</div>
          </div>
          {rows.length === 0 && <div className="px-5 py-4 text-sm text-vx-fg-muted">Every accepted event was processed.</div>}
          {rows.map((r) => (
            <div key={`${r.source}:${r.external_id}`} className="grid grid-cols-[150px_120px_1fr] items-center px-5 py-2.5 border-b border-vx-border/60 last:border-b-0 text-sm">
              <div className="font-vx-mono text-xs">{when(r.created_at)}</div>
              <div className="font-bold">{r.source}</div>
              <div className="font-vx-mono text-xs break-all">{r.external_id}</div>
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
    rate_limited: 'Too many requests. Wait a minute and try again.',
  })[code] || 'Webhook health is unavailable right now. Please retry.';
}
