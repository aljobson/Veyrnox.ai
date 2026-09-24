'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MarketingNav } from '../_components/NavBar';
import { Chip } from '../_components/Chip';
import { CopyButton } from '../_components/CopyButton';
import { MODELS as MODELS_FALLBACK, SITE_UPDATED, isShelfModel } from '../_lib/tokens';

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
        // Price only what a visitor can actually buy from the picker: the Clip
        // Editor is a Library tool and Auto Short is still flag-gated.
        const sellable = Array.isArray(data?.models) ? data.models.filter((m) => isShelfModel(m.capabilities)) : [];
        if (!cancelled && sellable.length) {
          setCatalog(sellable);
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

// Prices and credits come from public.credit_packs via /api/credit-packs;
// nothing is priced here. Null while loading or unavailable.
function useCreditPacks() {
  const [packs, setPacks] = useState(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/credit-packs', { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!cancelled && Array.isArray(data?.packs) && data.packs.length) setPacks(data.packs);
      } catch {
        // No pack section if the catalog is unavailable.
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return packs;
}

// "$10", not "$10.00": the approved wording (#99 item 1).
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', trailingZeroDisplay: 'stripIfInteger' });
const num = new Intl.NumberFormat('en-US');

export default function Pricing() {
  const { models: liveModels, live } = useLiveCatalog();
  const packs = useCreditPacks();

  return (
    <div className="min-h-dvh">
      <MarketingNav />

      {/* ============ HEADER ============ */}
      <section className="max-w-[1200px] mx-auto px-4 sm:px-8 pt-12 sm:pt-20 pb-8 text-center">
        <Chip tone="accent" className="mb-6">CREDITS · NOT TOKENS</Chip>
        <h1 className="text-[32px] sm:text-[44px] md:text-[56px] font-black tracking-[-0.03em] leading-[1.06] sm:leading-[1.02] text-balance max-w-[820px] mx-auto">
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
            That is roughly 25 Nano Banana stills or 2 Wan 2.5 clips, on us.
            {packs && ' Need more? Buy a credit pack below.'}
          </p>
          <Link
            href="/app?auth=sign_up"
            className="mt-3 rounded-full bg-vx-accent text-vx-accent-ink px-6 py-3 text-sm font-extrabold hover:bg-vx-accent-hover"
          >
            Create an account
          </Link>
        </div>
      </section>

      {/* ============ CREDIT PACKS ============ */}
      {packs && (
        <section className="max-w-[1200px] mx-auto px-4 sm:px-8 pb-14" aria-labelledby="credit-packs-heading">
          <div className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-money mb-2">CREDIT PACKS · ONE-OFF · NEVER EXPIRE</div>
          <h2 id="credit-packs-heading" className="text-3xl font-black tracking-[-0.02em] mb-4">Top up when you need to.</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {packs.map((p) => (
              <li key={p.id} className="rounded-2xl border border-vx-border bg-vx-panel p-6">
                <div className="font-vx-mono text-[28px] font-bold text-vx-money vx-num">{num.format(p.credits)} cr</div>
                {/* #99 item 1, approved v1: keep verbatim. */}
                <div className="mt-1 text-sm text-vx-fg-body">
                  {num.format(p.credits)} credits — {usd.format(p.price_usd_cents / 100)} + applicable tax
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[13px] text-vx-fg-muted max-w-[640px]">
            Prices are in USD and exclude tax. Stripe, Inc. is the Merchant of Record for credit pack
            purchases and charges and remits any VAT or sales tax for your location; your total including
            tax is shown at checkout before you pay.
          </p>
          <Link
            href="/app/credits"
            className="inline-block mt-5 rounded-full bg-vx-money text-vx-money-ink px-6 py-3 text-sm font-extrabold hover:brightness-110"
          >
            Buy credits
          </Link>
        </section>
      )}

      {/* ============ LIVE MODEL CATALOG ============ */}
      <section className="max-w-[1200px] mx-auto px-4 sm:px-8 pb-20">
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

        <div className="rounded-2xl border border-vx-border bg-vx-panel overflow-hidden">
          {/* Phone: one card per model. The four-column grid needed 640px and
              used to sit in a sideways scroller nobody found. */}
          <ul className="md:hidden divide-y divide-vx-border/60">
            {liveModels.map((m) => (
              <li key={m.id} className="px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="text-[15px] font-bold leading-snug">{m.name}</span>
                  <span className="shrink-0 font-vx-mono text-[15px] font-bold text-vx-money vx-num">
                    {m.credits} cr
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="font-vx-mono text-[10px] tracking-[0.1em] uppercase text-vx-fg-muted">
                    {m.modality}
                  </span>
                  <span className={`font-vx-mono text-[10px] tracking-[0.1em] ${m.gated ? 'text-vx-money' : 'text-vx-accent'}`}>
                    {m.gated ? '◆ GATED' : 'OPEN'}
                  </span>
                  <CopyButton value={m.id} label={m.id} copiedLabel="Model id copied" />
                </div>
              </li>
            ))}
          </ul>

          <div className="hidden md:block">
            {/* Real table semantics. This was div grids, so a screen reader
                got a flat run of text — "Wan 2.5 text-to-video 16 cr OPEN" —
                with no way to tell which number was which column. The grid
                classes move onto the rows via display:grid. */}
            <table className="w-full border-collapse">
              <thead>
                <tr className="grid grid-cols-[1.4fr_1fr_140px_120px] px-5 py-3 border-b border-vx-border font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">
                  <th scope="col" className="text-left font-normal">MODEL</th>
                  <th scope="col" className="text-left font-normal">MODALITY</th>
                  <th scope="col" className="text-right font-normal">CREDITS · 5s</th>
                  <th scope="col" className="text-right font-normal">ACCESS</th>
                </tr>
              </thead>
              <tbody>
            {liveModels.map((m) => (
              <tr key={m.id} className="grid grid-cols-[1.4fr_1fr_140px_120px] px-5 py-3 border-b border-vx-border/60 last:border-b-0 items-center">
                <th scope="row" className="flex items-center gap-2 min-w-0 text-left font-normal">
                  <span className="text-sm font-bold truncate">{m.name}</span>
                  {m.gated && (
                    <span className="font-vx-mono text-[9px] tracking-[0.1em] text-vx-money shrink-0">◆ PREMIUM</span>
                  )}
                </th>
                <td className="flex items-center gap-2 min-w-0">
                  <span className="font-vx-mono text-[11px] tracking-[0.1em] text-vx-fg-muted uppercase truncate">
                    {m.modality}
                  </span>
                  {/* The model id is what goes in an API call — the one
                      string on this page somebody retypes by hand. */}
                  <CopyButton value={m.id} label="id" copiedLabel="copied" />
                </td>
                <td className="text-right font-vx-mono text-sm font-bold text-vx-money vx-num">
                  {m.credits} cr
                </td>
                <td className="text-right font-vx-mono text-[10px] tracking-[0.1em]">
                  {m.gated ? (
                    <span className="text-vx-money">GATED</span>
                  ) : (
                    <span className="text-vx-accent">OPEN</span>
                  )}
                </td>
              </tr>
            ))}
              </tbody>
            </table>
          </div>

          <div className="px-4 sm:px-5 py-3 border-t border-vx-border font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted text-center">
            THE BUTTON IS THE PRICE TAG · FAILED JOBS REFUND AUTOMATICALLY
          </div>
        </div>
        <p className="mt-4 text-[12px] text-vx-fg-muted">
          Catalog read live from the gateway.{' '}
          <span className="whitespace-nowrap">
            Pricing copy last reviewed{' '}
            <time dateTime={SITE_UPDATED}>
              {new Date(`${SITE_UPDATED}T00:00:00Z`).toLocaleDateString('en-GB', {
                day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
              })}
            </time>
            .
          </span>
        </p>
      </section>

      {/* ============ CLOSING ============ */}
      <section className="border-t border-vx-border">
        <div className="max-w-[900px] mx-auto px-4 sm:px-8 py-14 text-center">
          <div className="text-3xl font-black tracking-[-0.02em]">Want to see it first?</div>
          <div className="text-vx-fg-muted mt-2">Browse the preset gallery. No card, no account.</div>
          <Link
            href="/presets"
            className="inline-block mt-6 rounded-full bg-vx-accent text-vx-accent-ink px-6 py-3 text-sm font-extrabold hover:bg-vx-accent-hover"
          >
            Browse the gallery
          </Link>
        </div>
      </section>
    </div>
  );
}
