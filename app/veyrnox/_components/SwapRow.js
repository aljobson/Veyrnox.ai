'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { fetchSwapRow, swapRowRatio } from '../_lib/swapRowClient.mjs';
import { presetTitle } from '../_lib/tokens';

// "Put yourself in": a short row of swap templates above the template gallery. It renders nothing until the server names a live
// card, so with the swap switch off the page is exactly what it was. Each card opens the existing swap composer.
export function SwapRow() {
  const { t } = useI18n();
  const [cards, setCards] = useState([]);
  useEffect(() => {
    const controller = new AbortController();
    void fetchSwapRow(fetch, '', controller.signal).then(rows => { if (!controller.signal.aborted) setCards(rows); });
    return () => controller.abort();
  }, []);
  if (!cards.length) return null;
  return <section aria-labelledby="swap-row-title" className="mb-12" data-swap-row>
    <h2 id="swap-row-title" className="vx-display text-balance text-[30px] sm:text-[38px]">{t('presets.swap.title')}</h2>
    <ul className="mt-5 flex snap-x gap-4 overflow-x-auto pb-3 [scrollbar-width:thin]">
      {cards.map(card => <li key={card.id} className="w-40 shrink-0 snap-start sm:w-48">
        <Link href={`/app/create?preset=${encodeURIComponent(card.id)}`} className="group block rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent">
          <span className="block overflow-hidden rounded-2xl border border-vx-border bg-vx-panel" style={{ aspectRatio: swapRowRatio(card.aspectRatio) }}>
            <img src={card.poster} alt="" loading="lazy" className="h-full w-full object-cover" />
          </span>
          <span className="mt-2 block font-bold leading-tight">{presetTitle(card.name)}</span>
          <span className="block text-sm text-vx-money">{t('presets.swap.price', { credits: card.credits })}</span>
        </Link>
      </li>)}
    </ul>
  </section>;
}
