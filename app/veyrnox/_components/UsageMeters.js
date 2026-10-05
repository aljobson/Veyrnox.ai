'use client';
import { useCallback, useEffect, useState } from 'react';
import { gatewayFetch } from '../_lib/gateway';

const ROWS = [['day', 'Last 24 hours'], ['week', 'Last 7 days'], ['month', 'Last 30 days']];
const num = new Intl.NumberFormat('en-US');

export function UsageMeters() {
  const [usage, setUsage] = useState(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    try { setUsage(await gatewayFetch('/ledger/usage')); setError(false); } catch { setError(true); }
  }, []);
  useEffect(() => {
    load();
    window.addEventListener('veyrnox:balance-changed', load);
    return () => window.removeEventListener('veyrnox:balance-changed', load);
  }, [load]);
  if (error) return null; // a convenience: the statement below still shows every line
  return (
    <section className="max-w-[1200px] mx-auto px-4 sm:px-8 pb-8" aria-label="Credit usage">
      <h2 className="text-xl font-black">Usage</h2>
      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        {ROWS.map(([key, label]) => (
          <div key={key} className="rounded-xl border border-vx-border px-4 py-3">
            <dt className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted uppercase">{label}</dt>
            <dd className="mt-1 font-vx-mono text-2xl font-bold text-vx-money vx-num">
              {usage ? `${key === 'month' && usage.truncated ? '≥ ' : ''}${num.format(usage.spent[key])}` : '–'} <span className="text-xs text-vx-fg-muted">cr</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-vx-fg-muted">Generations, net of refunds. Top-ups and welcome credits are not counted.</p>
    </section>
  );
}
