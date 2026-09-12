'use client';

/**
 * Ops dashboard. Every number here comes from /api/v1/admin/metrics, which
 * requires a verified session AND users.is_admin. A non-admin sees the
 * refusal and nothing else — there is no placeholder data to leak, because
 * there is no placeholder data.
 *
 * Grant access deliberately:
 *   update public.users set is_admin = true where email = '<person>';
 */

import { useCallback, useEffect, useState } from 'react';
import { AppNav } from '../../_components/NavBar';
import { Chip } from '../../_components/Chip';
import { gatewayFetch, GatewayError } from '../../_lib/gateway';

const nf = new Intl.NumberFormat('en-US');

function pct(part, whole) {
  if (!whole) return '—';
  return `${((part / whole) * 100).toFixed(1)}%`;
}

export default function Admin() {
  const [metrics, setMetrics] = useState(null);
  const [state, setState] = useState('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const m = await gatewayFetch('/admin/metrics');
      setMetrics(m);
      setState('ready');
    } catch (err) {
      if (err instanceof GatewayError && err.status === 403) setState('forbidden');
      else if (err instanceof GatewayError && err.status === 401) setState('unauthenticated');
      else setState('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-dvh">
      <AppNav active="explore" />

      <section className="max-w-[1400px] mx-auto px-8 pt-10 pb-6">
        <Chip tone="danger" className="mb-3">ADMIN · OPS</Chip>
        <h1 className="text-[36px] font-black tracking-[-0.02em]">Last 24 hours</h1>

        {state !== 'ready' && (
          <p className="mt-5 text-[15px] text-vx-fg-body max-w-[540px]">
            {state === 'loading' && 'Loading…'}
            {state === 'forbidden' && 'This account is not an administrator.'}
            {state === 'unauthenticated' && 'Sign in with an administrator account to view operations metrics.'}
            {state === 'error' && 'Metrics are unavailable right now.'}
          </p>
        )}

        {state === 'ready' && metrics && (
          <>
            <Kpis m={metrics} />
            <ModelTable rows={metrics.models || []} />
            <p className="mt-6 font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">
              READ FROM JOBS AND THE LEDGER AT {new Date(metrics.generated_at).toISOString().replace('T', ' ').slice(0, 19)} UTC
            </p>
          </>
        )}
      </section>
    </div>
  );
}

function Kpis({ m }) {
  const cards = [
    { label: 'Users who generated', value: nf.format(m.generating_users ?? 0), tone: 'accent' },
    { label: 'Generations', value: nf.format(m.jobs_total ?? 0), tone: 'accent' },
    { label: 'Credits debited', value: nf.format(m.credits_debited ?? 0), tone: 'money' },
    { label: 'Credits refunded', value: nf.format(m.credits_refunded ?? 0), tone: 'money' },
    { label: 'Failed or refunded', value: pct(m.jobs_failed ?? 0, m.jobs_total ?? 0), tone: 'accent' },
  ];
  return (
    <div className="mt-5 grid grid-cols-2 md:grid-cols-5 gap-3">
      {cards.map((c) => (
        <div key={c.label} className="rounded-[10px] border border-vx-border bg-vx-panel p-4">
          <div className="font-vx-mono text-[9.5px] tracking-[0.12em] text-vx-fg-muted">{c.label.toUpperCase()}</div>
          <div className={`mt-1 font-vx-mono text-[26px] font-bold vx-num ${c.tone === 'money' ? 'text-vx-money' : ''}`}>
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function ModelTable({ rows }) {
  return (
    <div className="mt-8">
      <h2 className="text-lg font-black tracking-[-0.02em] mb-3">By model</h2>
      <div className="rounded-[10px] border border-vx-border bg-vx-panel overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[1fr_110px_110px_130px_150px] px-5 py-3 border-b border-vx-border font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">
            <div>MODEL</div>
            <div className="text-right">JOBS</div>
            <div className="text-right">STORED</div>
            <div className="text-right">FAILED</div>
            <div className="text-right">P95 TO FINISH</div>
          </div>
          {rows.length === 0 && (
            <div className="px-5 py-4 text-sm text-vx-fg-muted">No generations in this window.</div>
          )}
          {rows.map((r) => (
            <div key={r.model_id} className="grid grid-cols-[1fr_110px_110px_130px_150px] items-center px-5 py-3 border-b border-vx-border/60 last:border-b-0">
              <div className="text-sm font-bold truncate">{r.model_id}</div>
              <div className="text-right font-vx-mono text-sm vx-num">{nf.format(r.jobs)}</div>
              <div className="text-right font-vx-mono text-sm vx-num">{nf.format(r.stored)}</div>
              <div className="text-right font-vx-mono text-sm vx-num">{nf.format(r.failed)}</div>
              <div className="text-right font-vx-mono text-sm vx-num">
                {r.p95_seconds == null ? '—' : `${r.p95_seconds}s`}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
