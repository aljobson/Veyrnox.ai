import Link from 'next/link';
import { Logo } from '../_components/Logo';
import { NavAuthButtons } from '../_components/NavAuthButtons';
import { MobileMenu } from '../_components/MobileMenu';
import { SiteSearch } from '../_components/SiteSearch';
import { ThemeToggle } from '../_components/ThemeToggle';
import { MediaTile } from '../_components/MediaTile';
import { SHOWCASE_CLIPS } from '../_lib/showcase';
import { NAV_CATEGORIES, FEATURE_CARDS, PRESETS, shelfName } from '../_lib/tokens';
import { PriceSlip } from '../_components/PriceSlip';

/* ─── Wide sticky nav ─── */

export function WideNav() {
  return (
    <div data-print="hide" className="sticky top-0 z-40 h-16 border-b border-vx-border bg-vx-base/90 backdrop-blur">
      <div className="h-full px-4 sm:px-6 flex items-center gap-3 lg:gap-6 max-w-[1300px] mx-auto">
        <Link href="/" className="flex items-center shrink-0" aria-label="Veyrnox.ai home">
          <Logo size={30} wordmark />
        </Link>
        {/* The links used to live in a horizontal scroller that, on a phone,
            looked like a truncated row nobody swipes. Below lg they move
            into the menu instead. */}
        <nav aria-label="Primary" className="hidden lg:flex gap-1 items-center flex-1 min-w-0">
          {NAV_CATEGORIES.map((c) => (
            <a
              key={c.href}
              href={c.href}
              className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-semibold text-vx-fg-body transition-colors hover:text-vx-fg hover:bg-vx-panel"
            >
              {c.label}
            </a>
          ))}
        </nav>
        <div className="flex flex-1 lg:flex-none items-center justify-end gap-2 shrink-0">
          <SiteSearch className="hidden sm:inline-flex" />
          <ThemeToggle className="hidden lg:inline-flex" />
          <NavAuthButtons />
          <MobileMenu items={NAV_CATEGORIES} className="lg:hidden" />
        </div>
      </div>
    </div>
  );
}

/* ─── Hero: the promise on the left, the working price slip on the right ─── */

export function Hero({ models }) {
  return (
    <section className="relative px-4 sm:px-6 max-w-[1300px] mx-auto pt-12 sm:pt-16 lg:pt-20 pb-16 lg:pb-24">
      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-12 lg:gap-16 items-start">
        <div className="lg:pt-10">
          <h1 className="vx-display text-[52px] sm:text-[76px] lg:text-[92px] text-balance">
            The price is on the button.
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-vx-fg-body max-w-[40ch] leading-[1.5] text-pretty">
            Image, video and audio models on one credit balance. Failed jobs refund on their own.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
            <Link
              href="/app?auth=sign_up"
              className="vx-press rounded-full bg-vx-fg text-vx-base px-7 py-3.5 text-[15px] font-extrabold hover:bg-vx-fg/85"
            >
              Claim 10 credits
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
    <section id="explore" className="px-4 sm:px-6 max-w-[1300px] mx-auto">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {FEATURE_CARDS.map((f, i) => {
          const row = rowOf(modelOf(f.href));
          return (
            <MediaTile
              key={f.key}
              href={f.href}
              clip={SHOWCASE_CLIPS[f.key]}
              className="vx-rise block text-left rounded-2xl overflow-hidden"
              style={{ '--vx-i': i }}
              mediaClassName="aspect-[4/5]"
              mediaStyle={{ background: f.bg }}
            >
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
              {/* Fixed light ink: these sit on a hardcoded dark gradient under
                  a black scrim in both themes. */}
              <div className="absolute inset-x-0 bottom-0 p-4 flex flex-col gap-3">
                <div className="font-black text-[17px] leading-[1.15] text-balance text-white">{f.title}</div>
                <div className="flex items-baseline gap-2 font-vx-mono text-[12px] text-white/90 vx-num">
                  <span className="truncate">{row ? shelfName(row.name) : 'Presets'}</span>
                  <span aria-hidden className="vx-leader flex-1" />
                  <span className="shrink-0 font-bold">{row ? `${row.credits} cr` : `${PRESETS.length} looks`}</span>
                </div>
              </div>
            </MediaTile>
          );
        })}
      </div>
    </section>
  );
}
