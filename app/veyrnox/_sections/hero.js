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

/* ─── Hero: the promise beside the promo film, the working price slip below ─── */

export async function Hero({ models }) {
  const { locale, t } = await getT();
  return (
    <section className="relative">
      <h2 className="sr-only">Veyrnox.ai</h2>
      <p className="sr-only">{t('home.breakthrough.film')}</p>
      {/* The film sits in its own column, never under text, buttons or a
          scrim: the picture is whole and the Play control is beneath it. On a
          phone the headline comes first and the film follows it. */}
      <div className="px-4 sm:px-6 max-w-[1300px] mx-auto grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-x-16 gap-y-10 lg:items-center pt-10 sm:pt-14">
        <div className="flex flex-col justify-center">
          <h1 className="vx-display vx-title-index vx-title-glow">
            {t('home.hero.title')}
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-vx-fg-body max-w-[40ch] leading-[1.5] text-pretty">
            {t('home.hero.lead')}
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
            <Link
              href="/app/create?model=nano-banana-kie"
              className="vx-press inline-flex min-h-11 items-center rounded-full bg-vx-fg px-7 py-3.5 text-[15px] font-extrabold text-vx-base hover:bg-vx-fg/85"
            >
              {t('home.hero.start')}
            </Link>
            <Link href={localizedHref(locale, '/pricing')} className="text-[15px] font-bold text-vx-fg-body underline decoration-vx-fg-faint decoration-2 underline-offset-[6px] hover:text-vx-fg hover:decoration-vx-accent">
              {t('home.hero.prices')}
            </Link>
          </div>
          <p className="mt-5 text-[14px] text-vx-fg-body">{t('home.cta.note')}</p>
        </div>
        <div className="mx-auto w-full max-w-[420px] lg:max-w-[460px]">
          <FilmPlayer film={BREAKTHROUGH_FILM} label={t('public.film.robot')} aspectRatio="9 / 16" controlsBelow />
        </div>
      </div>
      <div className="px-4 sm:px-6 max-w-[1300px] mx-auto pt-12 pb-16 lg:pb-24">
        <div className="mx-auto max-w-[620px]">
          <PriceSlip models={models} />
        </div>
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
