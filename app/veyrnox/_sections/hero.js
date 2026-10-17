import Link from 'next/link';
import { MediaTile } from '../_components/MediaTile';
import { SHOWCASE_CLIPS } from '../_lib/showcase';
import { FEATURE_CARDS, PRESETS, shelfName } from '../_lib/tokens';
import { FilmPlayer } from '../_components/FilmPlayer';
import { BRAND_FILM } from '../_lib/film';
import { PriceSlip } from '../_components/PriceSlip';

/* ─── Hero: the promise on the left, the working price slip on the right ─── */

export function Hero({ models }) {
  return (
    <section className="relative px-4 sm:px-6 max-w-[1300px] mx-auto pt-12 sm:pt-16 lg:pt-20 pb-16 lg:pb-24">
      <h2 className="sr-only">Veyrnox.ai</h2>
      <p className="sr-only">A silent ten-second video: a calm portrait fades into a galaxy above Earth, then the Veyrnox.ai logo appears over the planet’s glowing horizon.</p>
      <div className="mb-10 lg:mb-14 -mx-4 sm:mx-0">
        <FilmPlayer film={BRAND_FILM} label="the Veyrnox.ai intro" frameless />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-12 lg:gap-16 items-start">
        <div className="lg:pt-10">
          <h1 className="vx-display vx-title-index">
            Reach for the stars.
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-vx-fg-body max-w-[40ch] leading-[1.5] text-pretty">
            Image, video and audio models on one credit balance, with the price on every button. Failed jobs refund on their own.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
            <Link
              href="/app/create?model=nano-banana-kie"
              className="vx-press inline-flex min-h-11 items-center rounded-full bg-vx-fg text-vx-base px-7 py-3.5 text-[15px] font-extrabold hover:bg-vx-fg/85"
            >
              Start creating
            </Link>
            <Link href="/pricing" className="text-[15px] font-bold text-vx-fg-body underline decoration-vx-border decoration-2 underline-offset-[6px] hover:text-vx-fg hover:decoration-vx-accent">
              See every price
            </Link>
          </div>
        </div>
        <PriceSlip models={models} />
      </div>
    </section>
  );
}

/* ─── What it makes: five tiles, each opens a model or the presets ─── */

const modelOf = (href) => new URL(href, 'https://x').searchParams.get('model');

export function FeaturedHeroCards({ catalog }) {
  const rowOf = (id) => catalog.find((m) => m.id === id);
  return (
    <section id="explore" aria-labelledby="featured-title" className="px-4 sm:px-6 max-w-[1300px] mx-auto">
      <h2 id="featured-title" className="sr-only">Featured ways to create</h2>
      <p id="featured-scroll-hint" className="sr-only">Scroll horizontally to browse featured creation options.</p>
      {/* Below sm the five tiles are one swipe row, not a stack. It runs to
          the screen edge so the next tile shows there is more; the vertical
          padding keeps the rise and the focus ring inside the scroller,
          which clips both axes. Tiles keep their clip's own shape, so they
          are top-aligned, as in the grid from sm up. */}
      <div role="region" aria-labelledby="featured-title" aria-describedby="featured-scroll-hint" className="-mx-4 -my-2 flex snap-x snap-mandatory items-start gap-x-3 gap-y-6 overflow-x-auto scroll-pl-4 px-4 py-2 sm:mx-0 sm:my-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:py-0 lg:grid-cols-5">
        {FEATURE_CARDS.map((f, i) => {
          const row = rowOf(modelOf(f.href));
          const clip = SHOWCASE_CLIPS[f.key];
          return (
            <MediaTile
              key={f.key}
              href={f.href}
              clip={clip && { ...clip, objectFit: 'contain' }}
              imageSizes="(max-width: 639px) 72vw, (max-width: 1023px) 50vw, 20vw"
              ariaLabel={`Open ${f.title}`}
              className="vx-rise block w-[72%] shrink-0 snap-start text-left sm:w-auto"
              style={{ '--vx-i': i }}
              mediaClassName="rounded-2xl"
              mediaStyle={{ background: f.bg, aspectRatio: clip?.aspectRatio || '4 / 5' }}
              footer={
                <div className="pt-3 flex flex-col gap-2">
                  <div className="font-black text-[17px] leading-[1.15] text-balance">{f.title}</div>
                  <div className="flex items-baseline gap-2 font-vx-mono text-[12px] text-vx-fg-body vx-num">
                    <span className="truncate">{row ? shelfName(row.name) : 'Presets'}</span>
                    <span aria-hidden className="vx-leader flex-1" />
                    <span className={`shrink-0 font-bold ${row ? 'text-vx-money' : ''}`}>{row ? `${row.credits} cr` : `${PRESETS.length} looks`}</span>
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
