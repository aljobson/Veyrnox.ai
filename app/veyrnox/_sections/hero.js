import Link from 'next/link';
import { MediaTile } from '../_components/MediaTile';
import { SHOWCASE_CLIPS } from '../_lib/showcase';
import { FEATURE_CARDS, shelfName } from '../_lib/tokens';
import { PRESETS } from '../_lib/templates';
import { FilmPlayer } from '../_components/FilmPlayer';
import { BRAND_FILM } from '../_lib/film';
import { PriceSlip } from '../_components/PriceSlip';
import { getT } from '../../../lib/i18n/server';
import { localizedHref } from '../../../lib/i18n/locales.mjs';

/* ─── Hero: the promise on the left, the working price slip on the right ─── */

export async function Hero({ models }) {
  const { locale, t } = await getT();
  return (
    <section className="relative isolate">
      <h2 className="sr-only">Veyrnox.ai</h2>
      <p className="sr-only">{t('home.hero.film')}</p>
      {/* The film is the backdrop: the promise and the price slip sit on it,
          so the first screen carries the headline, the button and the price,
          not only the picture. Below lg the backdrop covers the headline
          block and the slip follows on the page background. The scrim is
          always dark, so the light text holds in both themes. */}
      <div className="absolute inset-x-0 top-0 -z-10 h-[max(34rem,calc(100dvh-8rem))] lg:h-full">
        <FilmPlayer film={BRAND_FILM} label={t('public.film.intro')} frameless fill />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/60 to-black/25 lg:bg-gradient-to-r lg:from-black/95 lg:via-black/75 lg:to-black/35" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-vx-base to-transparent" />
      </div>
      <div className="px-4 sm:px-6 max-w-[1300px] mx-auto grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-x-16 gap-y-12 lg:items-end pt-12 sm:pt-16 pb-16 lg:pb-24">
        <div className="flex min-h-[max(26rem,calc(100dvh-14rem))] flex-col justify-end text-white lg:min-h-[34rem]">
          <h1 className="vx-display vx-title-index vx-title-glow">
            {t('home.hero.title')}
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-white/85 max-w-[40ch] leading-[1.5] text-pretty">
            {t('home.hero.lead')}
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
            <Link
              href="/app/create?model=nano-banana-kie"
              className="vx-press inline-flex min-h-11 items-center rounded-full bg-white text-black px-7 py-3.5 text-[15px] font-extrabold hover:bg-white/85"
            >
              {t('home.hero.start')}
            </Link>
            <Link href={localizedHref(locale, '/pricing')} className="text-[15px] font-bold text-white/85 underline decoration-white/40 decoration-2 underline-offset-[6px] hover:text-white hover:decoration-vx-accent">
              {t('home.hero.prices')}
            </Link>
          </div>
          <p className="mt-5 text-[14px] text-white/70">{t('home.cta.note')}</p>
        </div>
        <PriceSlip models={models} />
      </div>
    </section>
  );
}

/* ─── What it makes: five tiles, each opens a model or the presets ─── */

const modelOf = (href) => new URL(href, 'https://x').searchParams.get('model');

export async function FeaturedHeroCards({ catalog }) {
  const { t } = await getT();
  const rowOf = (id) => catalog.find((m) => m.id === id);
  return (
    <section id="explore" aria-labelledby="featured-title" data-vey-perch className="px-4 sm:px-6 max-w-[1300px] mx-auto">
      <h2 id="featured-title" className="sr-only">{t('home.cards.heading')}</h2>
      <p id="featured-scroll-hint" className="sr-only">{t('home.cards.hint')}</p>
      {/* Below sm the five tiles are one swipe row, not a stack. It runs to
          the screen edge so the next tile shows there is more; the vertical
          padding keeps the rise and the focus ring inside the scroller,
          which clips both axes. Tiles keep their clip's own shape, so they
          are top-aligned, as in the grid from sm up. */}
      <div role="region" aria-labelledby="featured-title" aria-describedby="featured-scroll-hint" className="-mx-4 -my-2 flex snap-x snap-mandatory items-start gap-x-3 gap-y-6 overflow-x-auto scroll-pl-4 px-4 py-2 sm:mx-0 sm:my-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:py-0 lg:grid-cols-5">
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
              className="vx-rise block w-[72%] shrink-0 snap-start text-left sm:w-auto"
              style={{ '--vx-i': i }}
              mediaClassName="rounded-2xl"
              mediaStyle={{ background: f.bg, aspectRatio: clip?.aspectRatio || '4 / 5' }}
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
