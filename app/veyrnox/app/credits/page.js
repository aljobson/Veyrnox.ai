'use client';
import { useCallback, useEffect, useState } from 'react';
import { AppNav } from '../../_components/NavBar';
import { Chip } from '../../_components/Chip';
import { TopUpPacks, TopUpReturn } from '../../_components/TopUpPacks';
import { TopUpHistory } from '../../_components/TopUpHistory';
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
  const [free, setFree] = useState(null);
  const [error, setError] = useState(null);
  const [ledger, setLedger] = useState([]);
  // Live Credit Packs stay hidden until launch (#101): opt in per browser with
  // localStorage.setItem('veyrnox_topups', '1').
  const [topupsEnabled, setTopupsEnabled] = useState(false);

  useEffect(() => {
    try { setTopupsEnabled(localStorage.getItem('veyrnox_topups') === '1'); } catch {}
  }, []);

  const load = useCallback(async () => {
    try {
      const b = await gatewayFetch('/balance');
      setBalance(b.balance);
      setFree(b.free_credits > 0 && b.free_expires_at ? { credits: b.free_credits, expiresAt: b.free_expires_at } : null);
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

      <section className="max-w-[1200px] mx-auto px-4 sm:px-8 pt-10 pb-8">
        <Chip tone="money" className="mb-3">CREDITS & BILLING</Chip>
        <h1 className="text-[28px] sm:text-[34px] md:text-[40px] font-black tracking-[-0.02em]">Your balance</h1>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-[1fr_360px] gap-5">
          <div className="rounded-2xl border border-vx-border bg-vx-panel p-5 sm:p-8">
            <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">CURRENT BALANCE</div>
            <div className="mt-1 font-vx-mono text-[48px] sm:text-[60px] md:text-[72px] font-bold text-vx-money leading-none vx-num">
              {balance == null ? '—' : new Intl.NumberFormat('en-US').format(balance)}
              <span className="text-2xl align-middle ml-2 text-vx-fg-muted">cr</span>
            </div>
            {free && (
              <div className="mt-3 font-vx-mono text-[12px] tracking-[0.06em] text-vx-fg-muted vx-num">
                {new Intl.NumberFormat('en-US').format(free.credits)} free credits, expire{' '}
                {new Date(free.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
            )}
            <div className="mt-4 text-sm text-vx-fg-body">
              Every account runs on the same balance. Free credits are spent first. Failed jobs refund automatically.
            </div>

            {error === 'sign_in_required' && (
              <div className="mt-4 rounded-lg border border-vx-money/40 bg-vx-money/[0.07] px-4 py-3 text-sm text-vx-money flex items-start gap-2">
                <span aria-hidden="true">△</span>
                <span>Sign in to see your balance.</span>
              </div>
            )}

            <TopUpReturn />

            {topupsEnabled ? (
              // Wait for the balance call to settle so packs never load for a signed-out visitor.
              (error === 'sign_in_required' || balance != null) && <TopUpPacks signedIn={error !== 'sign_in_required'} />
            ) : (<>
            <div className="mt-6 flex flex-wrap gap-2">
              {TOPUPS.map((t) => (
                <button
                  key={t.c}
                  type="button"
                  disabled
                  title="Top-ups are not available yet"
                  className="flex flex-col items-start rounded-xl border border-vx-border bg-vx-base/60 px-4 py-3 opacity-50 cursor-not-allowed"
                >
                  <span className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">TOP-UP</span>
                  <span className="font-vx-mono text-[18px] font-bold text-vx-money mt-1 vx-num">+{t.c} cr</span>
                  <span className="font-vx-mono text-[12px] text-vx-fg-body mt-1">{t.price}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-faint">
              TOP-UPS NOT AVAILABLE YET · PRICES SHOWN ARE INDICATIVE
            </div>
            </>)}
          </div>

          <div className="rounded-2xl border border-vx-border bg-vx-panel p-5 sm:p-6 flex flex-col">
            <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">HOW BILLING WORKS</div>
            <div className="mt-1 text-2xl font-black">One balance, no tiers</div>
            <ul className="mt-4 space-y-2 text-sm text-vx-fg-body flex-1">
              <li className="flex gap-2"><span className="text-vx-accent">✓</span> One balance across every model</li>
              <li className="flex gap-2"><span className="text-vx-accent">✓</span> Failed jobs refund automatically</li>
              <li className="flex gap-2"><span className="text-vx-accent">✓</span> No subscription required</li>
              <li className="flex gap-2 text-vx-fg-muted"><span className="text-vx-fg-faint">◦</span> No subscription tiers today — every account works the same way</li>
            </ul>
          </div>
        </div>
      </section>

      {topupsEnabled && balance != null && <TopUpHistory />}

      {/* ============ RECENT GENERATIONS (client-side ledger) ============ */}
      <section className="max-w-[1200px] mx-auto px-4 sm:px-8 pb-16">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
          <h2 className="text-xl font-black tracking-[-0.02em]">Recent generations</h2>
          <div className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">
            FROM THIS BROWSER'S HISTORY
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
                  className="flex flex-col gap-2 px-4 py-3 sm:grid sm:grid-cols-[120px_minmax(0,1fr)_auto_90px] sm:items-center sm:gap-3 sm:px-5 border-b border-vx-border/60 last:border-b-0"
                >
                  <div className="order-2 font-vx-mono text-[11px] tracking-[0.06em] text-vx-fg-muted sm:order-none">
                    {formatWhen(l.submitted_at)}
                  </div>
                  <div className="order-1 min-w-0 sm:order-none">
                    <div className="text-sm truncate">
                      {model?.name || l.model_id} · {l.name || l.prompt || l.job_id.slice(0, 8)}
                    </div>
                  </div>
                  <div className="order-3 flex items-center justify-between gap-3 sm:order-none sm:justify-start">
                    <Chip tone={s.chip} noGlyph>
                      <span aria-hidden="true" className="mr-1">{s.glyph}</span>
                      {l.state.toUpperCase()}
                    </Chip>
                    <div className={`font-vx-mono text-[14px] font-bold vx-num sm:hidden ${cls}`}>
                      {delta} cr
                    </div>
                  </div>
                  <div className={`hidden text-right font-vx-mono text-[14px] font-bold vx-num sm:block ${cls}`}>
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
