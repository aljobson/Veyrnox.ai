'use client';
import { useCallback, useEffect, useState } from 'react';
import { AppNav } from '../../_components/NavBar';
import Link from 'next/link';
import { Chip } from '../../_components/Chip';
import { TopUpPacks, TopUpReturn } from '../../_components/TopUpPacks';
import { CreditStatement } from '../../_components/CreditStatement';
import { TopUpHistory } from '../../_components/TopUpHistory';
import { gatewayFetch, GatewayError } from '../../_lib/gateway';
import { readJobHistory } from '../../_lib/jobHistory';
import { MODELS } from '../../_lib/tokens';

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
  const load = useCallback(async () => {
    try {
      // Clear first: a transient failure used to leave the previous error up
      // permanently, so a signed-in user kept seeing "Sign in to see your
      // balance" after the next successful load.
      setError(null);
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
          return { ...h, state: j.state, error_code: j.error_code, refunded: j.refunded === true };
        } catch { return { ...h, state: 'queued' }; }
      }));
      if (!cancelled) setLedger(enriched);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-dvh">
      <AppNav balance={balance} active="credits" />

      <section className="max-w-[1200px] mx-auto px-4 sm:px-8 pt-10 pb-8">
        <h1 className="vx-display text-[40px] sm:text-[56px]">Your balance</h1>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-[1fr_340px] gap-8 lg:gap-12 items-start">
          <div>
            {/* The balance as a printed slip: the one figure this page exists
                for. Signed out there is no figure, so no slip. */}
            {error !== 'sign_in_required' && (
            <div className="vx-paper-shadow max-w-[560px]">
              <div className="vx-paper px-6 sm:px-8 pt-9 pb-10">
                <div className="text-[13px] font-bold">Current balance</div>
                <div className="mt-2 font-vx-mono text-[56px] sm:text-[72px] font-bold text-vx-money leading-none vx-num">
                  {balance == null ? '—' : new Intl.NumberFormat('en-US').format(balance)}
                  <span className="text-2xl align-middle ml-2 text-vx-fg-muted">cr</span>
                </div>
                {free && (
                  <>
                    <div className="vx-perf mt-6" aria-hidden />
                    <div className="mt-4 flex items-baseline gap-2 font-vx-mono text-[13px] vx-num">
                      <span>Free credits</span>
                      <span aria-hidden className="vx-leader flex-1" />
                      <span className="font-bold text-vx-money">{new Intl.NumberFormat('en-US').format(free.credits)} cr</span>
                    </div>
                    <div className="mt-1.5 flex items-baseline gap-2 font-vx-mono text-[13px] text-vx-fg-muted vx-num">
                      <span>Expire</span>
                      <span aria-hidden className="vx-leader flex-1" />
                      <span>{new Date(free.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
            )}

            {error === 'unavailable' && (
              <div role="alert" className="mt-6 rounded-lg border border-vx-danger/40 bg-vx-danger/[0.07] px-4 py-3 text-sm text-vx-danger flex items-start gap-2">
                <span aria-hidden="true">△</span>
                <span>We couldn&apos;t read your balance just now. Your credits are safe — reload to try again.</span>
              </div>
            )}

            {error === 'sign_in_required' && (
              <div className="mt-6 rounded-lg border border-vx-warn/40 bg-vx-warn/[0.07] px-4 py-3 text-sm text-vx-warn flex items-start gap-2">
                <span aria-hidden="true">△</span>
                <span>Sign in to see your balance.</span>
              </div>
            )}

            <TopUpReturn />

            {/* Wait for balance to settle before loading the purchase controls. */}
            {(error === 'sign_in_required' || balance != null) && <TopUpPacks signedIn={error !== 'sign_in_required'} />}
          </div>

          <div className="md:pt-2">
            <h2 className="text-xl font-black">How billing works</h2>
            <ul className="mt-4 space-y-4 text-[15px] text-vx-fg-body leading-[1.55]">
              <li>One balance covers every model. Free credits are spent first.</li>
              <li>Each generation is charged at the price on its button, when you press it.</li>
              <li>Failed jobs refund automatically, as their own line in your statement.</li>
              <li>No subscription. Every account works the same way.</li>
            </ul>
          </div>
        </div>
      </section>

      {balance != null && <CreditStatement />}
      {balance != null && <TopUpHistory />}

      {/* ============ RECENT GENERATIONS (client-side ledger) ============ */}
      <section className="max-w-[1200px] mx-auto px-4 sm:px-8 pb-16">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
          <h2 className="text-xl font-black tracking-[-0.02em]">Recent generations</h2>
          <p className="text-[13px] text-vx-fg-muted">From this browser&apos;s history</p>
        </div>
        {ledger.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-vx-border p-8 text-center">
            <p className="text-[15px] text-vx-fg-body">Nothing generated in this browser yet.</p>
            <Link href="/app/create" className="vx-press inline-block mt-4 rounded-full bg-vx-accent text-vx-accent-ink px-5 py-2.5 text-sm font-extrabold hover:bg-vx-accent-hover">
              Open the studio
            </Link>
          </div>
        ) : (
          <div className="rounded-2xl border border-vx-border bg-vx-panel overflow-hidden">
            {ledger.map((l) => {
              const model = MODELS.find((m) => m.id === l.model_id);
              // `refunded` comes from /jobs/:id; a failure whose refund has
              // not landed yet shows the debit it still is.
              const isRefund = l.state === 'failed' && l.refunded === true;
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
