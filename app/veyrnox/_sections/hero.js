import Link from 'next/link';
import { Logo } from '../_components/Logo';
import { Chip } from '../_components/Chip';
import { NavAuthButtons } from '../_components/NavAuthButtons';
import { MobileMenu } from '../_components/MobileMenu';
import { SiteSearch } from '../_components/SiteSearch';
import { ThemeToggle } from '../_components/ThemeToggle';
import {
  NAV_CATEGORIES,
  FEATURE_CARDS,
  PRODUCT_TILES,
  EFFECT_PRESETS,
  MORE_FEATURES,
  HERO_STATS,
  METRIC_STRIP,
  PILLARS,
  FAQ,
  PROMO_STRIP,
  HERO_CHIP,
  FOOTER_TAGLINE,
  footerStamp,
  SITE_UPDATED,
  SUPPORT_EMAIL,
  MODELS as MODELS_FALLBACK,
  kindOf,
} from '../_lib/tokens';

export function PromoStrip() {
  return (
    <div data-print="hide" className="bg-vx-money text-vx-money-ink text-[12px] sm:text-[13px] font-bold px-4 sm:px-6 py-2 flex items-center justify-center gap-2 sm:gap-3 flex-wrap text-center">
      <span aria-hidden="true" className="font-vx-mono text-[11px] tracking-[0.14em]">◆</span>
      <span>{PROMO_STRIP.message}</span>
      <Link
        href={PROMO_STRIP.href}
        className="bg-vx-base text-vx-fg rounded-full px-3 py-1 text-[11px] font-bold hover:opacity-80"
      >
        {PROMO_STRIP.cta}
      </Link>
    </div>
  );
}

/* ─── Wide sticky nav ─── */

export function WideNav() {
  return (
    <div data-print="hide" className="sticky top-0 z-40 h-16 border-b border-vx-border bg-vx-base/90 backdrop-blur">
      <div className="h-full px-4 sm:px-6 flex items-center gap-3 lg:gap-6 max-w-[1300px] mx-auto">
        <Link href="/" className="flex items-center shrink-0" aria-label="Veyrnox.ai — home">
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

/* ─── Featured hero cards (5 wide, kicker + title + Open) ─── */

export function FeaturedHeroCards({ modelCount }) {
  return (
    <section id="explore" className="px-4 sm:px-6 pt-8 max-w-[1400px] mx-auto">
      <Hero modelCount={modelCount} />
      <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {FEATURE_CARDS.map((f) => (
          <Link
            key={f.key}
            href={f.href}
            className="group text-left rounded-2xl border border-vx-border bg-vx-panel overflow-hidden transition-transform duration-200 ease-out hover:scale-[1.015]"
          >
            <div className="aspect-[4/5] relative" style={{ background: f.bg }}>
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-4 flex flex-col gap-2">
                {/* Fixed light ink, not theme tokens: this sits on a hardcoded
                    dark gradient under a from-black scrim, so --vx-fg would
                    resolve to near-black in light theme and the card would
                    read at 1.06:1. Same reasoning as EffectsWall below. */}
                <div className="font-vx-mono text-[10px] tracking-[0.14em] text-white/85">
                  {f.kicker}
                </div>
                <div className="font-black text-[16px] leading-tight text-balance text-white">{f.title}</div>
                <div className="text-[12px] text-white/85 leading-snug">{f.body}</div>
                <span className="mt-1 inline-flex items-center gap-1 font-vx-mono text-[10px] tracking-[0.12em] text-vx-accent">
                  {f.cta} →
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ─── Hero (headline + sub + CTAs + trust row) ─── */

export function Hero({ modelCount }) {
  return (
    <div className="relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 opacity-40 pointer-events-none"
        style={{
          background:
            'radial-gradient(60% 55% at 50% 20%, rgba(62,230,196,0.14), transparent 65%),' +
            'radial-gradient(45% 40% at 15% 80%, rgba(228,169,60,0.12), transparent 65%)',
        }}
      />
      <div className="relative max-w-[1000px] mx-auto pt-10 sm:pt-16 pb-8 flex flex-col items-center text-center gap-5 sm:gap-6">
        <Chip tone="accent" noGlyph>
          <span aria-hidden="true" className="mr-1 text-vx-accent">●</span>
          {HERO_CHIP}
        </Chip>
        <h1 className="text-[34px] sm:text-[48px] md:text-[72px] font-black leading-[1.02] md:leading-[0.98] tracking-[-0.03em] md:tracking-[-0.035em] text-balance max-w-[900px]">
          One prompt in. Endless creations out.<br />
          <span className="text-vx-accent">Priced on the button.</span>
        </h1>
        <p className="text-base sm:text-lg text-vx-fg-body max-w-[640px] leading-[1.6]">
          Credit-metered AI image, video and audio. See the exact cost before you press generate —
          refund on failure, always.
        </p>
        <div className="flex gap-3 mt-2 flex-wrap justify-center">
          <Link
            href="/app/create"
            className="rounded-full bg-vx-accent text-vx-accent-ink px-8 py-4 text-base font-extrabold hover:bg-vx-accent-hover"
          >
            Start creating
          </Link>
          <Link
            href="/pricing"
            className="rounded-full border border-vx-border text-vx-fg px-8 py-4 text-base font-bold hover:border-vx-accent"
          >
            See how it works
          </Link>
        </div>
        <div className="mt-8 grid grid-cols-3 gap-3 sm:gap-8 max-w-[720px] w-full">
          {HERO_STATS.map((s) => (
            <div key={s.label} className="text-center">
              <div className="font-vx-mono text-[20px] sm:text-[24px] font-bold text-vx-accent vx-num">{s.value ?? modelCount}</div>
              <div className="mt-1 text-[11px] sm:text-xs text-vx-fg-muted leading-snug">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Sign-up incentive over hero gradient ─── */

export function SignupIncentive() {
  return (
    <section className="px-4 sm:px-6 pt-8 max-w-[1400px] mx-auto">
      <div
        className="relative rounded-3xl overflow-hidden border border-vx-border"
        style={{ background: 'linear-gradient(135deg,#0a1a2c 0%,#0e3a4a 45%,#2ec8a3 100%)' }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-transparent" />
        <div className="relative p-6 sm:p-10 lg:p-14">
          <div className="max-w-[560px]">
            <Chip tone="money" className="mb-4">SIGN-UP BONUS</Chip>
            {/* Fixed dark surface again - see FeaturedHeroCards. */}
            <h2 className="text-[28px] sm:text-[36px] lg:text-[44px] font-black leading-[1.05] lg:leading-[1.02] tracking-[-0.03em] text-balance text-white">
              50 free credits.<br/>
              <span className="text-vx-accent">Every button shows its price.</span>
            </h2>
            <ul className="mt-5 space-y-2 text-[14px] text-white/85">
              <li className="flex gap-2"><span className="text-vx-accent">✓</span> Every model on one balance</li>
              <li className="flex gap-2"><span className="text-vx-accent">✓</span> Failed jobs refund automatically</li>
              <li className="flex gap-2"><span className="text-vx-accent">✓</span> No card required to browse</li>
            </ul>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/app"
                className="whitespace-nowrap rounded-full bg-vx-accent text-vx-accent-ink px-6 py-3 text-sm font-extrabold hover:bg-vx-accent-hover"
              >
                Claim 50 credits
              </Link>
              <Link
                href="/presets"
                className="whitespace-nowrap rounded-full border border-white/30 text-white px-6 py-3 text-sm font-bold hover:border-white"
              >
                Browse presets free
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Product tiles ─── */
