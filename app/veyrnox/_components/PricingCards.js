'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useI18n } from '../../../components/I18nProvider';
import { localeTag } from '../../../lib/i18n/locales.mjs';

// One pack at a time, Buzzy-style: tabs pick the pack, one large card shows
// what it buys. Every figure comes from the live packs and live catalog this
// page already fetched; there is no list price, no countdown and no typed
// number here. "Save N%" is measured against the dearest pack, and only the
// pack that really is cheapest per credit is marked best value.

const rate = (pack) => pack.price_usd_cents / 100 / pack.credits;

function Tick() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-[3px] h-3.5 w-3.5 shrink-0 text-vx-accent" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 8.5 3.2 3.2L13 4.5" />
    </svg>
  );
}

/**
 * @param {{ packs: Array<{ id: string, credits: number, price_usd_cents: number }>,
 *           typical: null | { image: number | null, video: number | null } }} props
 * `typical` is the median credit price of open image and video models from the
 * live catalog, or null while only the bundled list is showing.
 */
export function PricingCards({ packs, typical }) {
  const { t, locale } = useI18n();
  const tag = localeTag(locale, 'en-US');
  const num = new Intl.NumberFormat(tag);
  const usd = new Intl.NumberFormat(tag, { style: 'currency', currency: 'USD', trailingZeroDisplay: 'stripIfInteger' });
  const perCredit = new Intl.NumberFormat(tag, { style: 'currency', currency: 'USD', minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const rates = packs.map(rate);
  const lowest = Math.min(...rates);
  const highest = Math.max(...rates);
  const bestIndex = lowest < highest ? rates.indexOf(lowest) : -1;
  const [picked, setPicked] = useState(null);
  const index = picked !== null && packs[picked] ? picked : Math.max(bestIndex, 0);
  const pack = packs[index];
  const saving = Math.floor((1 - rate(pack) / highest) * 100);
  const images = typical?.image ? Math.floor(pack.credits / typical.image) : null;
  const clips = typical?.video ? Math.floor(pack.credits / typical.video) : null;

  function onKeyDown(event) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    // Arrows follow reading direction, so flip them for right-to-left languages.
    const direction = document.dir === 'rtl' ? -step : step;
    event.preventDefault();
    const next = (index + direction + packs.length) % packs.length;
    setPicked(next);
    document.getElementById(`pack-tab-${packs[next].id}`)?.focus();
  }

  return (
    <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,560px)_1fr] lg:items-start">
      <div>
        <div
          role="tablist"
          aria-label={t('pricing.cards.pick')}
          onKeyDown={onKeyDown}
          className="flex gap-1 overflow-x-auto rounded-full border border-vx-border bg-vx-base/60 p-1"
        >
          {packs.map((p, i) => {
            const on = i === index;
            return (
              <button
                key={p.id}
                id={`pack-tab-${p.id}`}
                role="tab"
                type="button"
                aria-selected={on}
                aria-controls="pack-card"
                tabIndex={on ? 0 : -1}
                onClick={() => setPicked(i)}
                className={`vx-press min-w-[5.5rem] flex-1 whitespace-nowrap rounded-full px-4 py-2.5 font-vx-mono text-[13px] font-bold transition-colors ${on ? 'bg-vx-accent text-vx-accent-ink' : 'text-vx-fg-body hover:text-vx-fg'}`}
              >
                {num.format(p.credits)}
              </button>
            );
          })}
        </div>

        <div
          id="pack-card"
          role="tabpanel"
          aria-labelledby={`pack-tab-${pack.id}`}
          className="mt-5 rounded-2xl border border-vx-accent/60 bg-vx-panel p-6 shadow-[0_24px_60px_-28px_rgb(var(--vx-accent)/0.55)] sm:p-8"
        >
          <div className="flex h-6 items-center justify-between gap-3 font-vx-mono text-[11px] font-bold">
            <span className="text-vx-fg-muted">{t('pricing.cards.once')}</span>
            {index === bestIndex && (
              <span className="rounded-full bg-vx-accent px-2.5 py-1 text-vx-accent-ink">{t('pricing.packs.best')}</span>
            )}
          </div>

          <div className="mt-4 rounded-2xl border border-vx-accent/40 bg-vx-accent/[0.06] p-4">
            <div className="font-vx-mono text-[26px] font-bold leading-tight text-vx-money vx-num">
              {t('pricing.cards.credits', { credits: num.format(pack.credits) })}
            </div>
            {(images !== null || clips !== null) && (
              <ul className="mt-2 space-y-1 text-[15px] text-vx-fg-body">
                {images !== null && <li>{t('pricing.cards.images', { count: num.format(images) })}</li>}
                {clips !== null && <li>{t('pricing.cards.videos', { count: num.format(clips) })}</li>}
              </ul>
            )}
          </div>

          <div className="mt-6 flex items-baseline gap-3">
            <span className="font-vx-mono text-[48px] font-bold leading-none vx-num">{usd.format(pack.price_usd_cents / 100)}</span>
            {saving >= 1 && <span className="font-vx-mono text-[13px] font-bold text-vx-accent">{t('pricing.packs.save', { pct: saving })}</span>}
          </div>
          <p className="mt-2 font-vx-mono text-[12px] text-vx-fg-muted vx-num">{t('pricing.packs.rate', { rate: perCredit.format(rate(pack)) })}</p>

          <Link
            href="/app/credits"
            className="vx-press mt-6 block rounded-full bg-vx-accent px-7 py-4 text-center text-[15px] font-extrabold uppercase tracking-[0.08em] text-vx-accent-ink hover:bg-vx-accent-hover"
          >
            {t('pricing.packs.buy')}
          </Link>

          <ul className="mt-6 space-y-2.5 border-t border-vx-border pt-5 text-[14px] text-vx-fg-body">
            <li className="flex items-start gap-2"><Tick />{t('pricing.cards.never')}</li>
            <li className="flex items-start gap-2"><Tick />{t('pricing.cards.refund')}</li>
            <li className="flex items-start gap-2"><Tick />{t('pricing.free')}</li>
          </ul>
        </div>
        {typical && <p className="mt-3 text-[12px] text-vx-fg-muted">{t('pricing.cards.estimate')}</p>}
      </div>

      <ul className="hidden space-y-2 lg:block" aria-hidden="true">
        {packs.map((p, i) => (
          <li key={p.id}>
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setPicked(i)}
              className={`flex w-full items-center justify-between gap-4 rounded-2xl border px-5 py-4 text-start transition-colors ${i === index ? 'border-vx-accent/60 bg-vx-accent/[0.06]' : 'border-vx-border hover:border-vx-accent/40'}`}
            >
              <span className="font-vx-mono text-[15px] font-bold vx-num">{t('pricing.cards.credits', { credits: num.format(p.credits) })}</span>
              <span className="text-end">
                <span className="block font-vx-mono text-[15px] font-bold vx-num">{usd.format(p.price_usd_cents / 100)}</span>
                <span className="block font-vx-mono text-[11px] text-vx-fg-muted vx-num">{t('pricing.packs.rate', { rate: perCredit.format(rate(p)) })}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
