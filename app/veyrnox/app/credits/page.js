'use client';
import { useCallback, useEffect, useState } from 'react';
import { AppNav } from '../../_components/NavBar';
import { Chip } from '../../_components/Chip';
import { gatewayFetch, GatewayError } from '../../_lib/gateway';
import { readJobHistory } from '../../_lib/jobHistory';
import { MODELS } from '../../_lib/tokens';

const TOPUPS = [
  { c: 300,  price: '$9' },
  { c: 750,  price: '$19' },
  { c: 2000, price: '$49' },
];

const STATE_UI = {
  succeeded: { chip: 'accent', glyph: '✓' },
  failed:    { chip: 'danger', glyph: '✕' },
  queued:    { chip: 'accent', glyph: '●' },
  running:   { chip: 'accent', glyph: '●' },
};

export default function Credits() {
  const [balance, setBalance] = useState(null);
  const [error, setError] = useState(null);
  const [ledger, setLedger] = useState([]);

  const load = useCallback(async () => {
    try {
      const b = await gatewayFetch('/balance');
      setBalance(b.balance);
    } catch (e) {
      if (e instanceof GatewayError && e.status === 401) {
        setError('sign_in_required');
      } else {
        setError('unavailable');
      }
    }
  }, []);

  useEffect(() => {
    load();
    const onFocus = () => load();
    const onBalance = () => load();
    window.addEventListener('focus', onFocus);
    window.addEventListener('veyrnox:balance-changed', onBalance);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('veyrnox:balance-changed', onBalance);
    };
  }, [load]);

  // Local ledger reconstruction — no server /ledger endpoint yet.
  // We hydrate each history row's current state so refunds show as +cr.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const history = readJobHistory().slice(0, 15);
      const enriched = await Promise.all(history.map(async (h) => {
        try {
          const j = await gatewayFetch(`/jobs/${h.job_id}`);
          return { ...h, state: j.state, error_code: j.error_code };
        } catch { return { ...h, state: 'queued' }; }
      }));
      if (!cancelled) setLedger(enriched);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-dvh">
      <AppNav balance={balance ?? 0} active="credits" />

      <section className="max-w-[1200px] mx-auto px-8 pt-10 pb-8">
        <Chip tone="money" className="mb-3">CREDITS & BILLING</Chip>
        <h1 className="text-[40px] font-black tracking-[-0.02em]">Your balance</h1>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-[1fr_360px] gap-5">
          <div className="rounded-2xl border border-vx-border bg-vx-panel p-8">
            <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">CURRENT BALANCE</div>
            <div className="mt-1 font-vx-mono text-[72px] font-bold text-vx-money leading-none vx-num">
              {balance == null ? '—' : new Intl.NumberFormat('en-US').format(balance)}
              <span className="text-2xl align-middle ml-2 text-vx-fg-muted">cr</span>
            </div>
            <div className="mt-4 text-sm text-vx-fg-body">
              Pay-as-you-go — top up to add credits. Failed jobs refund automatically.
            </div>

            {error === 'sign_in_required' && (
              <div className="mt-4 rounded-lg border border-vx-money/40 bg-vx-money/[0.07] px-4 py-3 text-sm text-vx-money flex items-start gap-2">
                <span aria-hidden="true">△</span>
                <span>Sign in to see your balance and buy credits.</span>
              </div>
            )}

            <div className="mt-6 flex flex-wrap gap-2">
              {TOPUPS.map((t) => (
                <button
                  key={t.c}
                  className="flex flex-col items-start rounded-xl border border-vx-border bg-vx-base/60 px-4 py-3 hover:border-vx-money focus-visible:outline-2 focus-visible:outline-vx-accent"
                >
                  <span className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">TOP-UP</span>
                  <span className="font-vx-mono text-[18px] font-bold text-vx-money mt-1 vx-num">+{t.c} cr</span>
                  <span className="font-vx-mono text-[12px] text-vx-fg-body mt-1">{t.price}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-faint">
              CHECKOUT WIRING · PHASE 4
            </div>
          </div>

          <div className="rounded-2xl border border-vx-border bg-vx-panel p-6 flex flex-col">
            <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">YOUR PLAN</div>
            <div className="mt-1 text-2xl font-black">Pay-as-you-go</div>
            <ul className="mt-4 space-y-2 text-sm text-vx-fg-body flex-1">
              <li className="flex gap-2"><span className="text-vx-accent">✓</span> One balance across every model</li>
              <li className="flex gap-2"><span className="text-vx-accent">✓</span> Failed jobs refund automatically</li>
              <li className="flex gap-2"><span className="text-vx-accent">✓</span> No subscription required</li>
              <li className="flex gap-2 text-vx-fg-muted"><span className="text-vx-fg-faint">◦</span> Plans in Phase 4</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ============ RECENT GENERATIONS (client-side ledger) ============ */}
      <section className="max-w-[1200px] mx-auto px-8 pb-16">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-xl font-black tracking-[-0.02em]">Recent generations</h2>
          <div className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">
            LOCAL HISTORY · SERVER LEDGER LIST IN PHASE 4
          </div>
        </div>
        {ledger.length === 0 ? (
          <div className="rounded-2xl border border-vx-border bg-vx-panel p-8 text-center text-sm text-vx-fg-muted">
            No generations yet — Create screen will populate this.
          </div>
        ) : (
          <div className="rounded-2xl border border-vx-border bg-vx-panel overflow-hidden">
            {ledger.map((l) => {
              const model = MODELS.find((m) => m.id === l.model_id);
              const isRefund = l.state === 'failed';
              const delta = isRefund ? `+${l.credits}` : `−${l.credits}`;
              const cls = isRefund ? 'text-vx-accent' : 'text-vx-money';
              const s = STATE_UI[l.state] || STATE_UI.queued;
              return (
                <div
                  key={l.job_id}
                  className="grid grid-cols-[140px_1fr_120px_100px] items-center px-5 py-3 border-b border-vx-border/60 last:border-b-0 gap-3"
                >
                  <div className="font-vx-mono text-[11px] tracking-[0.06em] text-vx-fg-muted">
                    {formatWhen(l.submitted_at)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm truncate">
                      {model?.name || l.model_id} · {l.name || l.prompt || l.job_id.slice(0, 8)}
                    </div>
                  </div>
                  <div>
                    <Chip tone={s.chip} noGlyph>
                      <span aria-hidden="true" className="mr-1">{s.glyph}</span>
                      {l.state.toUpperCase()}
                    </Chip>
                  </div>
                  <div className={`text-right font-vx-mono text-[14px] font-bold vx-num ${cls}`}>
                    {delta} cr
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function formatWhen(ts) {
  if (!ts) return '—';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
