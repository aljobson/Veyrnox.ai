'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MarketingNav } from '../_components/NavBar';
import { CopyButton } from '../_components/CopyButton';
import { MODELS as MODELS_FALLBACK, SITE_UPDATED, isShelfModel, kindOf } from '../_lib/tokens';

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
  const groups = ['video', 'image', 'audio']
    .map((kind) => ({ kind, rows: liveModels.filter((m) => kindOf(m.modality) === kind) }))
    .filter((g) => g.rows.length);

  return (
    <div className="min-h-dvh">
      <MarketingNav />

      <section className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20">
        <h1 className="vx-display text-[52px] sm:text-[80px] lg:text-[104px] max-w-[12ch]">
          One balance. Every model.
        </h1>
        <p className="mt-6 text-lg sm:text-xl text-vx-fg-body max-w-[46ch] leading-[1.5] text-pretty">
          Credits buy generations. Each model shows its price on the button before you spend, and failed jobs refund automatically.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
          <Link
            href="/app?auth=sign_up"
            className="vx-press rounded-full bg-vx-fg text-vx-base px-7 py-3.5 text-[15px] font-extrabold hover:bg-vx-fg/85"
          >
            Create an account
          </Link>
          <p className="text-[15px] text-vx-fg-muted">10 free credits on sign-up. No card needed.</p>
        </div>
      </section>

      {packs && (
        <section className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-24 sm:pt-32" aria-labelledby="credit-packs-heading">
          <h2 id="credit-packs-heading" className="vx-display text-[40px] sm:text-[56px]">Top up when you need to.</h2>
          <p className="mt-4 text-vx-fg-body max-w-[52ch] leading-[1.6]">One-off credit packs. Purchased credits never expire.</p>
          <ul className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {packs.map((p) => (
              <li key={p.id} className="vx-paper-shadow">
                <div className="vx-paper px-6 pt-9 pb-10">
                  <div className="font-vx-mono text-[40px] font-bold leading-none text-vx-money vx-num">{num.format(p.credits)} cr</div>
                  <div className="vx-perf mt-6" aria-hidden />
                  {/* #99 item 1, approved v1: keep verbatim. */}
                  <div className="mt-4 text-[15px] text-vx-fg-body">
                    {num.format(p.credits)} credits — {usd.format(p.price_usd_cents / 100)} + applicable tax
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-[13px] text-vx-fg-muted max-w-[640px] leading-[1.6]">
            Prices are in USD and exclude tax. Stripe, Inc. is the Merchant of Record for credit pack
            purchases and charges and remits any VAT or sales tax for your location; your total including
            tax is shown at checkout before you pay.
          </p>
          <Link
            href="/app/credits"
            className="vx-press inline-block mt-6 rounded-full bg-vx-accent text-vx-accent-ink px-7 py-3.5 text-[15px] font-extrabold hover:bg-vx-accent-hover"
          >
            Buy credits
          </Link>
        </section>
      )}

      <section className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-24 sm:pt-32 pb-8">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <h2 className="vx-display text-[40px] sm:text-[56px]">Every model, priced.</h2>
          <p className="text-[14px] text-vx-fg-muted">
            {live ? 'Read live from the gateway.' : 'Showing the cached list; the live catalog did not answer.'}
          </p>
        </div>
        <p className="mt-4 text-vx-fg-body max-w-[60ch] leading-[1.6]">
          Video is priced per 5 s clip; where a model offers 10 s, it costs double. Premium models need an account in good standing.
        </p>

        <div className="mt-12 space-y-14">
          {groups.map((g) => (
            <div key={g.kind}>
              <h3 id={`price-${g.kind}`} className="text-xl font-black border-b-2 border-vx-fg pb-2 capitalize">{g.kind}</h3>
              {/* Real table semantics so a screen reader can tell which
                  number is which column. */}
              <table aria-labelledby={`price-${g.kind}`} className="w-full border-collapse">
                <thead className="sr-only">
                  <tr>
                    <th scope="col">Model</th>
                    <th scope="col">Model id</th>
                    <th scope="col">Credits</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((m) => (
                    <tr key={m.id} className="border-b border-vx-border">
                      <th scope="row" className="py-3 pr-3 text-left font-normal">
                        <span className="text-[15px] font-bold">{m.name}</span>
                        {m.gated && <span className="ml-2 text-[12px] font-bold text-vx-money">premium</span>}
                        <span className="block sm:hidden mt-1"><CopyButton value={m.id} label={m.id} copiedLabel="Model id copied" /></span>
                      </th>
                      {/* The model id is what goes in an API call: the one
                          string on this page somebody retypes by hand. */}
                      <td className="hidden sm:table-cell py-3 pr-3 text-left">
                        <CopyButton value={m.id} label={m.id} copiedLabel="Model id copied" />
                      </td>
                      <td className="py-3 text-right font-vx-mono text-[16px] font-bold text-vx-money vx-num whitespace-nowrap">
                        {m.credits} cr
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
        <p className="mt-8 text-[13px] text-vx-fg-muted">
          Pricing copy last reviewed{' '}
          <time dateTime={SITE_UPDATED}>
            {new Date(`${SITE_UPDATED}T00:00:00Z`).toLocaleDateString('en-GB', {
              day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
            })}
          </time>
          .
        </p>
      </section>

      <section className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-24 sm:pt-32 pb-28">
        <h2 className="vx-display text-[40px] sm:text-[56px] max-w-[14ch]">Want to see it first?</h2>
        <p className="mt-4 text-vx-fg-body">Browse the presets. No card, no account.</p>
        <Link
          href="/presets"
          className="vx-press inline-block mt-8 rounded-full bg-vx-accent text-vx-accent-ink px-7 py-3.5 text-[15px] font-extrabold hover:bg-vx-accent-hover"
        >
          Browse presets
        </Link>
      </section>
    </div>
  );
}

