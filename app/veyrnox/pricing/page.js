'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MarketingNav } from '../_components/NavBar';
import { Chip } from '../_components/Chip';
import { MODELS as MODELS_FALLBACK } from '../_lib/tokens';

// Live catalog fetch — public, unauthenticated. Falls back to tokens.js
// MODELS if the endpoint is unreachable so the page never renders blank.
function useLiveCatalog() {
  const [catalog, setCatalog] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/catalog', { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!cancelled && Array.isArray(data?.models) && data.models.length) {
          setCatalog(data.models);
        } else if (!cancelled) {
          throw new Error('empty');
        }
      } catch {
        if (!cancelled) setCatalog(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  // Normalise fallback to same shape.
  if (catalog) return { models: catalog, live: true };
  return {
    models: MODELS_FALLBACK.map((m) => ({
      id: m.id, name: m.name, modality: m.kind, credits: m.credits, gated: !!m.premium,
    })),
    live: false,
  };
}

export default function Pricing() {
  const { models: liveModels, live } = useLiveCatalog();

  return (
    <div className="min-h-dvh">
      <MarketingNav />

      {/* ============ HEADER ============ */}
      <section className="max-w-[1200px] mx-auto px-8 pt-20 pb-8 text-center">
        <Chip tone="accent" className="mb-6">CREDITS · NOT TOKENS</Chip>
        <h1 className="text-[56px] font-black tracking-[-0.03em] leading-[1.02] text-balance max-w-[820px] mx-auto">
          One balance. Every model.<br/>No add-ons.
        </h1>
        <p className="text-vx-fg-body mt-5 max-w-[600px] mx-auto leading-[1.65]">
          Credits buy generations. Every model shows its exact price on the button
          before you spend, and failed jobs refund automatically.
        </p>

        <div className="mt-8 inline-flex flex-col items-center gap-2">
          <div className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-accent">
            50 FREE CREDITS ON SIGN-UP
          </div>
          <p className="text-[13px] text-vx-fg-muted max-w-[460px]">
            That is roughly 16 Nano Banana stills or 3 Wan 2.5 clips, on us. Paid
            top-ups are not available yet — when they are, the prices will be here.
          </p>
          <Link
            href="/app?auth=sign_up"
            className="mt-3 rounded-full bg-vx-accent text-vx-accent-ink px-6 py-3 text-sm font-extrabold hover:bg-vx-accent-hover"
          >
            Create an account
          </Link>
        </div>
      </section>

      {/* ============ LIVE MODEL CATALOG ============ */}
      <section className="max-w-[1200px] mx-auto px-8 pb-20">
        <div className="flex items-end justify-between mb-4 flex-wrap gap-2">
          <div>
            <div className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-accent mb-2">
              LIVE CATALOG · 5s CLIP PRICING
            </div>
            <h2 className="text-3xl font-black tracking-[-0.02em]">Every model. Priced up front.</h2>
          </div>
          <div className="flex items-center gap-3">
            {live ? (
              <span className="inline-flex items-center gap-1.5 font-vx-mono text-[10px] tracking-[0.12em] text-vx-accent">
                <span aria-hidden="true">●</span> LIVE
              </span>
            ) : (
              <span className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">CACHED</span>
            )}
            <div className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">
              10s VIDEO = 2×
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-vx-border bg-vx-panel overflow-hidden overflow-x-auto">
          <div className="grid grid-cols-[1.4fr_1fr_120px_120px] px-5 py-3 border-b border-vx-border font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted min-w-[640px]">
            <div>MODEL</div>
            <div>MODALITY</div>
            <div className="text-right">CREDITS · 5s</div>
            <div className="text-right">ACCESS</div>
          </div>
          {liveModels.map((m) => (
            <div key={m.id} className="grid grid-cols-[1.4fr_1fr_120px_120px] px-5 py-3 border-b border-vx-border/60 last:border-b-0 items-center min-w-[640px]">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-bold truncate">{m.name}</span>
                {m.gated && (
                  <span className="font-vx-mono text-[9px] tracking-[0.1em] text-vx-money">◆ PREMIUM</span>
                )}
              </div>
              <div className="font-vx-mono text-[11px] tracking-[0.1em] text-vx-fg-muted uppercase">
                {m.modality}
              </div>
              <div className="text-right font-vx-mono text-sm font-bold text-vx-money vx-num">
                {m.credits} cr
              </div>
              <div className="text-right font-vx-mono text-[10px] tracking-[0.1em]">
                {m.gated ? (
                  <span className="text-vx-money">GATED</span>
                ) : (
                  <span className="text-vx-accent">OPEN</span>
                )}
              </div>
            </div>
          ))}
          <div className="px-5 py-3 border-t border-vx-border font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted text-center">
            THE BUTTON IS THE PRICE TAG · FAILED JOBS REFUND AUTOMATICALLY
          </div>
        </div>
      </section>

      {/* ============ CLOSING ============ */}
      <section className="border-t border-vx-border">
        <div className="max-w-[900px] mx-auto px-8 py-14 text-center">
          <div className="text-3xl font-black tracking-[-0.02em]">Want to see it first?</div>
          <div className="text-vx-fg-muted mt-2">Browse the preset gallery. No card, no account.</div>
          <Link
            href="/veyrnox/presets"
            className="inline-block mt-6 rounded-full bg-vx-accent text-vx-accent-ink px-6 py-3 text-sm font-extrabold hover:bg-vx-accent-hover"
          >
            Browse the gallery
          </Link>
        </div>
      </section>
    </div>
  );
}
