'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MarketingNav } from '../_components/NavBar';
import { Main } from '../_components/Main';
import { CreditSubscriptionOffer } from '../_components/CreditSubscriptions';
import { PremiumTag } from '../_components/PremiumTag';
import { CopyButton } from '../_components/CopyButton';
import { MODELS as MODELS_FALLBACK, SITE_UPDATED, isShelfModel, kindOf } from '../_lib/tokens';
import { creditValueRange, formatUsdRange } from '../_lib/creditValue';
import { modelPriceUnit } from '../_lib/modelPricing';

const FALLBACK_MODELS = MODELS_FALLBACK.map((model) => ({
  ...model,
  isSpeech: !!model.speech,
  id: model.id,
  name: model.name,
  modality: model.kind,
  credits: model.credits,
  gated: !!model.premium,
}));

// Live catalog fetch — public, unauthenticated. The bundled list keeps the
// table useful while loading and if the endpoint is unavailable; status keeps
// those two states honest for visitors.
function useLiveCatalog() {
  const [catalogState, setCatalogState] = useState({
    models: FALLBACK_MODELS,
    status: 'loading',
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/catalog');
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        // Price only what a visitor can actually buy from the picker: the Clip
        // Editor is a Library tool and Auto Short is still flag-gated.
        const sellable = Array.isArray(data?.models) ? data.models.filter((m) => isShelfModel(m.capabilities)) : [];
        if (!sellable.length) throw new Error('empty');
        if (!cancelled) setCatalogState({ models: sellable, status: 'live' });
      } catch {
        if (!cancelled) {
          setCatalogState({
            models: FALLBACK_MODELS,
            status: 'unavailable',
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return catalogState;
}

// Prices and credits come from public.credit_packs via /api/credit-packs;
// nothing is priced here. The endpoint sets a short, bounded shared cache.
function useCreditPacks() {
  const [packState, setPackState] = useState({
    packs: [],
    status: 'loading',
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/credit-packs');
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!Array.isArray(data?.packs)) throw new Error('invalid');
        if (!cancelled) setPackState({ packs: data.packs, status: 'success' });
      } catch {
        if (!cancelled) setPackState({ packs: [], status: 'unavailable' });
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return packState;
}

// "$10", not "$10.00": the approved wording (#99 item 1).
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', trailingZeroDisplay: 'stripIfInteger' });
const num = new Intl.NumberFormat('en-US');

export default function Pricing() {
  const catalogState = useLiveCatalog();
  const liveModels = catalogState.models;
  const packState = useCreditPacks();
  const groups = ['video', 'image', 'audio']
    .map((kind) => ({ kind, rows: liveModels.filter((m) => kindOf(m.modality) === kind) }))
    .filter((g) => g.rows.length);

  return (
    <div className="min-h-dvh">
      <MarketingNav />
      <Main>
      <section className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-14 sm:pt-20">
        <h1 className="vx-display vx-title-index max-w-[12ch]">
          One balance. Every model.
        </h1>
        <p className="mt-6 text-lg sm:text-xl text-vx-fg-body max-w-[46ch] leading-[1.5] text-pretty">
          Credits buy generations. Each model shows its price on the button before you spend, and failed jobs refund automatically.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
          <Link
            href="/app/create"
            className="vx-press rounded-full bg-vx-fg text-vx-base px-7 py-3.5 text-[15px] font-extrabold hover:bg-vx-fg/85"
          >
            Open Studio
          </Link>
          <p className="text-[15px] text-vx-fg-muted">New accounts include 10 free credits. No card needed.</p>
        </div>
      </section>

      <section
        id="credit-packs"
        className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-24 sm:pt-32"
        aria-labelledby="credit-packs-heading"
      >
        <h2 id="credit-packs-heading" className="vx-display text-[40px] sm:text-[56px]">Top up when you need to.</h2>
        <p className="mt-4 text-vx-fg-body max-w-[52ch] leading-[1.6]">One-off credit packs. Purchased credits never expire.</p>
        {packState.status === 'loading' && (
          <p role="status" aria-live="polite" className="mt-8 text-vx-fg-muted">
            Loading Credit Packs…
          </p>
        )}
        {packState.status === 'unavailable' && (
          <p role="alert" className="mt-8 text-vx-fg-muted">
            Credit Packs are temporarily unavailable. Reload this page to try again.
          </p>
        )}
        {packState.status === 'success' && packState.packs.length === 0 && (
          <p role="status" className="mt-8 text-vx-fg-muted">
            No Credit Packs are available right now.
          </p>
        )}
        {packState.status === 'success' && packState.packs.length > 0 && (
          <>
          <ul className="mt-10 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
            {packState.packs.map((p) => (
              <li key={p.id} className="vx-paper-shadow">
                {/* h-full: the slips share a row, and a line that wraps on one
                    (the longest price line does at four across) must not leave
                    it taller than its neighbours. */}
                <div className="vx-paper h-full px-6 pt-9 pb-10">
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
          </>
        )}
      </section>

      <CreditSubscriptionOffer />
      <section className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-24 sm:pt-32 pb-8">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <h2 className="vx-display text-[40px] sm:text-[56px]">Every model, priced.</h2>
          <p role="status" aria-live="polite" className="text-[14px] text-vx-fg-muted">
            {catalogState.status === 'loading'
              ? 'Loading live prices… Showing the bundled reference list meanwhile.'
              : catalogState.status === 'live'
                ? 'Read live from the gateway.'
                : 'Live prices are unavailable. Showing the bundled reference list; confirm the price in Studio before generating.'}
          </p>
        </div>
        <p className="mt-4 text-vx-fg-body max-w-[60ch] leading-[1.6]">
          Each price covers the output length shown for that model. Where a model offers both 5 s and 10 s, the 10 s option costs double. Premium models need an account in good standing.
        </p>
        {packState.status === 'success' && packState.packs.length > 0 && (
          <p className="mt-2 text-[13px] text-vx-fg-muted">
            Approximate pack values. Based on current pack rates before tax; Studio shows the final credit charge before generation.
          </p>
        )}

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
                    <th scope="col">Approx. pack value</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((m) => (
                    <tr key={m.id} className="border-b border-vx-border">
                      <th scope="row" className="py-3 pr-3 text-left font-normal">
                        <span className="text-[15px] font-bold">{m.name}</span>
                        {m.gated && <PremiumTag className="ml-2" />}
                        <span className="block mt-1 text-[12px] text-vx-fg-muted">{modelPriceUnit(m)}</span>
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
                      <td className="py-3 pl-2 sm:pl-4 text-right font-vx-mono text-[12px] sm:text-[14px] text-vx-fg-muted vx-num whitespace-nowrap">
                        <PackValue credits={m.credits} packState={packState} />
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
      </Main>
    </div>
  );
}

function PackValue({ credits, packState }) {
  if (packState.status !== 'success') return '—';
  return formatUsdRange(creditValueRange(credits, packState.packs)) || '—';
}

