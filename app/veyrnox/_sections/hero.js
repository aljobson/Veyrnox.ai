import Link from 'next/link';
import { MediaTile } from '../_components/MediaTile';
import { SHOWCASE_CLIPS } from '../_lib/showcase';
import { FEATURE_CARDS, shelfName } from '../_lib/tokens';
import { PRESETS } from '../_lib/templates';
import { FilmPlayer } from '../_components/FilmPlayer';
import { BREAKTHROUGH_FILM } from '../_lib/film';
import { PriceSlip } from '../_components/PriceSlip';
import { getT } from '../../../lib/i18n/server';
import { localizedHref } from '../../../lib/i18n/locales.mjs';

/* ─── Hero: the promise, and the receipt that keeps it, side by side with the promo film ─── */

export async function Hero({ models }) {
  const { locale, t } = await getT();
  return (
    <section className="relative">
      {/* The headline says the price is on the receipt, so the receipt is
          under it, printing in the first screen. The slip's Generate button
          is the page's one primary action, which is why there is no second
          "Start creating" pill beside it. The film sits in its own column,
          never under text, buttons or a scrim: the picture is whole and the
          Play control is beneath it. On a phone the headline and the slip
          come first and the film follows. */}
      <div className="px-4 sm:px-6 max-w-[1300px] mx-auto grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-x-16 gap-y-12 lg:items-start pt-8 sm:pt-10 pb-16 lg:pb-24">
        <div className="min-w-0">
          <h1 className="vx-display vx-title-index vx-title-glow">
            {t('home.hero.title')}
          </h1>
          <p className="mt-5 text-lg sm:text-xl text-vx-fg-body max-w-[52ch] leading-[1.5] text-pretty">
            {t('home.hero.lead')}
          </p>
          <div className="mt-8 sm:mt-10 max-w-[620px]">
            <PriceSlip models={models} />
          </div>
          <div className="mt-7 flex max-w-[620px] flex-wrap items-baseline gap-x-6 gap-y-2 text-[14px] text-vx-fg-body">
            <Link href={localizedHref(locale, '/pricing')} className="text-[15px] font-bold text-vx-fg-body underline decoration-vx-fg-faint decoration-2 underline-offset-[6px] hover:text-vx-fg hover:decoration-vx-accent">
              {t('home.hero.prices')}
            </Link>
            <span>{t('home.cta.note')}</span>
          </div>
        </div>
        {/* The fixed Contact / back-to-top rail (SiteChrome) is 44px wide, 8px from
            the right edge and scrolls over the page. Where the film could reach
            it (phones, and the two-column layout until the container stops
            at 1300px) the column keeps 3.5rem clear on that side. */}
        <div className="mx-auto w-full max-w-[420px] max-sm:pe-14 lg:max-w-[460px] lg:max-[1360px]:pe-14">
          <p className="sr-only">{t('home.breakthrough.film')}</p>
          <FilmPlayer film={BREAKTHROUGH_FILM} label={t('public.film.robot')} aspectRatio="9 / 16" controlsBelow />
        </div>
      </div>
    </section>
  );
}

/* ─── What it makes: five tiles, each opens a model or the presets ─── */

const modelOf = (href) => new URL(href, 'https://x').searchParams.get('model');

// Four of the five clips are portrait (9:16 and 406:720) and one is 4:3. Each
// at its own shape left the row ragged, with the 4:3 card a third of the height
// of its neighbours and the five price lines on five different baselines. One
// portrait frame (MediaTile `ambient`) keeps every clip whole, lines the
// prices up, and lets the landscape clip sit in it on a blurred copy of itself.
const PORTRAIT_FRAME = '9 / 16';

export async function FeaturedHeroCards({ catalog }) {
  const { t } = await getT();
  const rowOf = (id) => catalog.find((m) => m.id === id);
  return (
    <section id="explore" data-vey-perch className="px-4 sm:px-6 max-w-[1300px] mx-auto">
      <h2 id="featured-title" className="sr-only">{t('home.cards.heading')}</h2>
      <p id="featured-scroll-hint" className="sr-only">{t('home.cards.hint')}</p>
      {/* Below sm the five tiles are one swipe row, not a stack. It runs to
          the screen edge so the next tile shows there is more; the vertical
          padding keeps the rise and the focus ring inside the scroller,
          which clips both axes. Every tile shares one frame, so the
          captions and prices sit on one line across the row. */}
      <div role="region" aria-labelledby="featured-title" aria-describedby="featured-scroll-hint" className="-mx-4 -my-2 flex snap-x snap-mandatory items-start gap-x-3 gap-y-6 overflow-x-auto scroll-ps-4 px-4 py-2 sm:mx-0 sm:my-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:py-0 lg:grid-cols-5">
        {FEATURE_CARDS.map((f, i) => {
          const row = rowOf(modelOf(f.href));
          const clip = SHOWCASE_CLIPS[f.key];
          const title = t(f.key === 'presets' ? 'home.cards.presets-title' : `home.cards.${f.key}`);
          return (
            <MediaTile
              key={f.key}
              href={f.href}
              clip={clip && { ...clip, objectFit: 'contain' }}
              imageSizes="(max-width: 639px) 72vw, (max-width: 1023px) 50vw, 20vw"
              ariaLabel={t('home.cards.open', { title })}
              className="vx-rise block w-[72%] shrink-0 snap-start text-start sm:w-auto"
              style={{ '--vx-i': i }}
              mediaClassName="rounded-2xl"
              ambient
              mediaStyle={{ background: f.bg, aspectRatio: PORTRAIT_FRAME }}
              footer={
                <div className="pt-3 flex flex-col gap-2">
                  <div className="font-black text-[17px] leading-[1.15] text-balance">{title}</div>
                  <div className="flex items-baseline gap-2 font-vx-mono text-[12px] text-vx-fg-body vx-num">
                    <span className="truncate">{row ? shelfName(row.name) : t('home.cards.presets')}</span>
                    <span aria-hidden className="vx-leader flex-1" />
                    <span className={`shrink-0 font-bold ${row ? 'text-vx-money' : ''}`}>{row ? `${row.credits} cr` : t('home.cards.looks', { n: PRESETS.length })}</span>
                  </div>
                </div>
              }
            />
          );
        })}
      </div>
    </section>
  );
}
