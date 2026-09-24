'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../_lib/gateway';

const LABELS = {
  signup_grant: 'Welcome credits', free_credit_expiry: 'Free credits expired',
  generation: 'Generation', generation_refund: 'Generation refund',
  top_up: 'Top-up', payment_adjustment: 'Payment adjustment', adjustment: 'Credit adjustment',
};
const num = new Intl.NumberFormat('en-US', { signDisplay: 'always' });

export function CreditStatement() {
  const [entries, setEntries] = useState([]);
  const [next, setNext] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(async (cursor = null) => {
    const seq = ++sequence.current;
    setBusy(true); setError(false);
    try {
      const query = cursor ? `?${new URLSearchParams(cursor)}` : '';
      const result = await gatewayFetch(`/ledger${query}`);
      if (seq !== sequence.current) return;
      setEntries(previous => cursor
        ? [...previous, ...result.entries.filter(row => !previous.some(p => p.id === row.id))]
        : result.entries);
      setNext(result.next);
    } catch { if (seq === sequence.current) setError(true); }
    finally { if (seq === sequence.current) setBusy(false); }
  }, []);
  useEffect(() => {
    load();
    const refresh = () => load();
    window.addEventListener('veyrnox:balance-changed', refresh);
    return () => { sequence.current++; window.removeEventListener('veyrnox:balance-changed', refresh); };
  }, [load]);
  return (
    <section className="max-w-[1200px] mx-auto px-4 sm:px-8 pb-10" aria-labelledby="credit-statement-title">
      <h2 id="credit-statement-title" className="text-xl font-black mb-2">Credit statement</h2>
      <p className="text-sm text-vx-fg-muted mb-4">All credit movements on your account, across devices. Charges and refunds appear separately.</p>
      {error && <p role="alert" className="text-sm text-vx-danger mb-3">Your statement is unavailable. <button type="button" onClick={() => load()} className="underline">Try again</button></p>}
      {!entries.length && !error && <p className="rounded-2xl border border-vx-border bg-vx-panel p-6 text-sm text-vx-fg-muted" role="status">{busy ? 'Loading statement…' : 'No credit movements yet.'}</p>}
      {!!entries.length && <ul className="rounded-2xl border border-vx-border bg-vx-panel overflow-hidden">
        {entries.map(entry => <li key={entry.id} className="flex items-center justify-between gap-4 px-5 py-4 border-b border-vx-border/60 last:border-b-0">
          <div className="min-w-0">
            <div className="text-sm font-bold">{LABELS[entry.kind] || LABELS.adjustment}</div>
            <time dateTime={entry.created_at} className="text-xs text-vx-fg-muted">{new Date(entry.created_at).toLocaleString('en-GB')}</time>
          </div>
          <span className={`shrink-0 font-vx-mono font-bold ${entry.delta > 0 ? 'text-vx-accent' : 'text-vx-money'}`}>{num.format(entry.delta)} cr</span>
        </li>)}
      </ul>}
      {next && <button type="button" disabled={busy} onClick={() => load(next)} className="mt-4 rounded-full border border-vx-border px-5 py-2 text-sm font-bold disabled:opacity-50">{busy ? 'Loading…' : 'Load older movements'}</button>}
    </section>
  );
}
