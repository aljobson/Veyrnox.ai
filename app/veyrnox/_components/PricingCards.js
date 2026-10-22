'use client';
import Link from 'next/link';
import { useI18n } from '../../../components/I18nProvider';
import { localeTag } from '../../../lib/i18n/locales.mjs';

// Every pack as a card in one row so visitors can compare them at a glance.
// Every figure comes from the live packs and live catalog this page already
// fetched; there is no list price, no countdown and no typed number here.
// "Save N%" is measured against the dearest pack, and only the pack that
// really is cheapest per credit is marked best value.

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

  return (
    <>
      <ul className="mt-10 grid grid-cols-1 items-stretch gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {packs.map((pack) => {
          const best = lowest < highest && rate(pack) === lowest;
          const saving = Math.floor((1 - rate(pack) / highest) * 100);
          const images = typical?.image ? Math.floor(pack.credits / typical.image) : null;
          const clips = typical?.video ? Math.floor(pack.credits / typical.video) : null;
          return (
            <li key={pack.id} data-pack={pack.id} className="flex">
              <div className={`flex w-full flex-col rounded-2xl border bg-vx-panel p-6 ${best ? 'border-vx-accent/70 shadow-[0_24px_60px_-28px_rgb(var(--vx-accent)/0.55)]' : 'border-vx-border'}`}>
                {/* The top row keeps its height with or without the pill, so
                    the credit boxes line up across the row. */}
                <div className="flex h-6 items-center justify-between gap-3 font-vx-mono text-[11px] font-bold">
                  <span className="text-vx-fg-muted">{t('pricing.cards.once')}</span>
                  {best && <span className="shrink-0 rounded-full bg-vx-accent px-2.5 py-1 text-vx-accent-ink">{t('pricing.packs.best')}</span>}
                </div>

                <div className="mt-4 rounded-2xl border border-vx-accent/40 bg-vx-accent/[0.06] p-4">
                  <div className="font-vx-mono text-[24px] font-bold leading-tight text-vx-money vx-num">
                    {t('pricing.cards.credits', { credits: num.format(pack.credits) })}
                  </div>
                  {(images !== null || clips !== null) && (
                    <ul className="mt-2 space-y-1 text-[14px] text-vx-fg-body">
                      {images !== null && <li>{t('pricing.cards.images', { count: num.format(images) })}</li>}
                      {clips !== null && <li>{t('pricing.cards.videos', { count: num.format(clips) })}</li>}
                    </ul>
                  )}
                </div>

                <div className="mt-6 flex h-[3rem] items-baseline gap-3">
                  <span className="font-vx-mono text-[44px] font-bold leading-none vx-num">{usd.format(pack.price_usd_cents / 100)}</span>
                  {saving >= 1 && <span className="font-vx-mono text-[12px] font-bold text-vx-accent">{t('pricing.packs.save', { pct: saving })}</span>}
                </div>
                <p className="mt-2 font-vx-mono text-[12px] text-vx-fg-muted vx-num">{t('pricing.packs.rate', { rate: perCredit.format(rate(pack)) })}</p>

                <Link
                  href="/app/credits"
                  className={`vx-press mt-6 block rounded-full px-6 py-3.5 text-center text-[14px] font-extrabold uppercase tracking-[0.08em] ${best ? 'bg-vx-accent text-vx-accent-ink hover:bg-vx-accent-hover' : 'bg-vx-fg text-vx-base hover:bg-vx-fg/85'}`}
                >
                  {t('pricing.packs.buy')}
                </Link>

                <ul className="mt-6 space-y-2.5 border-t border-vx-border pt-5 text-[14px] text-vx-fg-body">
                  <li className="flex items-start gap-2"><Tick />{t('pricing.cards.never')}</li>
                  <li className="flex items-start gap-2"><Tick />{t('pricing.cards.refund')}</li>
                </ul>
              </div>
            </li>
          );
        })}
      </ul>
      {typical && <p className="mt-4 text-[12px] text-vx-fg-muted">{t('pricing.cards.estimate')}</p>}
    </>
  );
}
