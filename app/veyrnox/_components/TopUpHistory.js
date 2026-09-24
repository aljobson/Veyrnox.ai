'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Chip } from './Chip';
import { gatewayFetch } from '../_lib/gateway';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const num = new Intl.NumberFormat('en-US');

// The caller's own Top-ups, newest first (#95). A pending row is either
// still being credited or a checkout that was never paid; it is shown muted
// so it never reads like credits the user has.
export function TopUpHistory() {
  const [topUps, setTopUps] = useState(null);
  const [failed, setFailed] = useState(false);
  const [next, setNext] = useState(null);
  const [busy, setBusy] = useState(false);
  // Loads can overlap (mount, focus, balance change); only the latest applies.
  const latest = useRef(0);

  const load = useCallback(async (cursor = null) => {
    const seq = ++latest.current;
    setBusy(true);
    try {
      const b = await gatewayFetch(`/top-ups${cursor ? `?${new URLSearchParams(cursor)}` : ''}`);
      if (seq !== latest.current) return;
      const rows = Array.isArray(b?.top_ups) ? b.top_ups : [];
      setTopUps(previous => cursor ? [...(previous || []), ...rows.filter(row => !previous?.some(p => p.id === row.id))] : rows);
      setNext(b.next || null);
      setFailed(false);
    } catch {
      if (seq === latest.current) setFailed(true);
    } finally { if (seq === latest.current) setBusy(false); }
  }, []);

  useEffect(() => {
    load();
    // focus: coming back from an abandoned checkout tab shows its pending row.
    const refresh = () => load();
    window.addEventListener('focus', refresh);
    window.addEventListener('veyrnox:balance-changed', refresh);
    return () => {
      latest.current++;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('veyrnox:balance-changed', refresh);
    };
  }, [load]);

  return (
    <section className="max-w-[1200px] mx-auto px-4 sm:px-8 pb-10" aria-labelledby="topup-history-heading">
      <h2 id="topup-history-heading" className="text-xl font-black tracking-[-0.02em] mb-4">Top-ups</h2>
      {failed && (
        <div role="alert" className="rounded-2xl border border-vx-border bg-vx-panel p-6 text-sm text-vx-fg-muted">
          Your Top-up history is unavailable right now.
        </div>
      )}
      {!failed && topUps && topUps.length === 0 && (
        <div className="rounded-2xl border border-vx-border bg-vx-panel p-6 text-center text-sm text-vx-fg-muted">
          No Top-ups yet.
        </div>
      )}
      {!failed && topUps && topUps.length > 0 && (
        <ul className="rounded-2xl border border-vx-border bg-vx-panel overflow-hidden">
          {topUps.map((t) => {
            const credited = t.status === 'credited';
            return (
              <li
                key={t.id}
                className={`grid grid-cols-[auto_1fr_auto] sm:grid-cols-[140px_1fr_100px_140px] items-center gap-3 px-5 py-3 border-b border-vx-border/60 last:border-b-0 ${credited ? '' : 'text-vx-fg-muted'}`}
              >
                <div className="font-vx-mono text-[11px] tracking-[0.06em] text-vx-fg-muted">
                  {new Date(t.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
                <div className={`font-vx-mono text-[14px] font-bold vx-num whitespace-nowrap ${credited ? 'text-vx-money' : ''}`}>
                  +{num.format(t.credits)} cr
                </div>
                <div className="hidden sm:block font-vx-mono text-[12px] vx-num">{usd.format(t.price_usd_cents / 100)}</div>
                <div className="justify-self-end">
                  {credited ? (
                    <Chip tone="money">Credited</Chip>
                  ) : (
                    <Chip tone="neutral" className="border-dashed">
                      <span aria-hidden="true" className="text-[9px] leading-none">○</span>
                      Pending
                    </Chip>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {next && <button type="button" disabled={busy} onClick={() => load(next)} className="mt-4 rounded-full border border-vx-border px-5 py-2 text-sm font-bold disabled:opacity-50">{busy ? 'Loading…' : 'Load older Top-ups'}</button>}
    </section>
  );
}
