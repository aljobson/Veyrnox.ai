import Link from 'next/link';
import { Logo } from './_components/Logo';
import { Chip } from './_components/Chip';
import { NavAuthButtons } from './_components/NavAuthButtons';
import { MobileMenu } from './_components/MobileMenu';
import { SiteSearch } from './_components/SiteSearch';
import { ThemeToggle } from './_components/ThemeToggle';
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
} from './_lib/tokens';
import { select, envConfig } from '../../packages/db/supabase-client.js';
import { SITE_URL, JsonLd } from '../seo';

// FAQPage built from the same FAQ constant the page renders, so the markup
// and the structured data cannot drift apart.
const FAQ_LD = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  '@id': `${SITE_URL}/#faq`,
  mainEntity: FAQ.map(({ q, a }) => ({
    '@type': 'Question',
    name: q,
    acceptedAnswer: { '@type': 'Answer', text: a },
  })),
};

export const revalidate = 300;

// Landing — credit-metered AI image and video generation.
// The button is the price tag.

/**
 * Server-side read of the live catalog with a hard fallback to tokens.js.
 * Queries Postgres directly (same columns as /api/catalog) — a self-fetch
 * of our own origin does not work inside the Worker and silently served
 * the hardcoded fallback prices.
 */
async function loadCatalog() {
  try {
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) throw new Error('not_configured');
    const rows = await select(
      'model_catalog',
      { columns: 'id,name,modality,credits_5s,gated_flag', filter: 'active=eq.true&order=modality.asc,name.asc' },
      cfg,
    );
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('empty');
    // Normalise to the shape our page expects: { id, name, credits, kind, tag?, premium?, gated? }
    return rows.map((m) => ({
      id: m.id,
      name: m.name,
      credits: m.credits_5s,
      // model_catalog.modality is fine-grained (text-to-video, image-to-video,
      // text-to-audio); the page groups on the coarse bucket and keeps the
      // fine-grained value below for display.
      kind: kindOf(m.modality),
      modality: m.modality,
      premium: !!m.gated_flag,
      gated: !!m.gated_flag,
      tag: m.gated_flag ? 'PREMIUM' : undefined,
    }));
  } catch {
    return MODELS_FALLBACK;
  }
}

export default async function VeyrnoxLanding() {
  const catalog = await loadCatalog();
  return (
    <div className="min-h-dvh">
      <PromoStrip />
      <WideNav />
      <FeaturedHeroCards modelCount={catalog.length} />
      <SignupIncentive />
      <ProductTilesRow modelCount={catalog.length} catalog={catalog} />
      <HeroStatement />
      <EffectsWall />
      <ModelShelf catalog={catalog} />
      <WhyVeyrnox />
      <FeatureStripsSection />
      <FAQBlock />
      <ClosingCTA modelCount={catalog.length} />
      <FooterForest catalog={catalog} />
      <JsonLd data={FAQ_LD} />
    </div>
  );
}

/* ─── Amber promo strip ─── */
function PromoStrip() {
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
function WideNav() {
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
function FeaturedHeroCards({ modelCount }) {
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
function Hero({ modelCount }) {
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
function SignupIncentive() {
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
function ProductTilesRow({ modelCount, catalog }) {
  // PRODUCT_TILES supplies presentation only — icon, hint, badge, label. The
  // price comes from the live catalog, because CLAUDE.md makes the catalog
  // normative and this section previously printed hand-typed credits directly
  // under a headline counting live rows, so a re-priced model would be quoted
  // wrong here while ModelShelf two sections down showed the truth.
  const priceOf = (key, fallback) => {
    const row = catalog && catalog.find((m) => m.id === key);
    return row && typeof row.credits === 'number' ? row.credits : fallback;
  };
  return (
    <section id="models" className="px-4 sm:px-6 pt-16 max-w-[1400px] mx-auto">
      <div className="flex items-baseline justify-between mb-6 flex-wrap gap-2">
        <div>
          <div className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-accent mb-2">EVERY MODEL. ONE BALANCE.</div>
          <h2 className="text-2xl sm:text-3xl font-black tracking-[-0.02em]">{modelCount} models on the shelf.</h2>
        </div>
        <Link href="/pricing" className="text-sm font-semibold text-vx-fg-muted hover:text-vx-fg">
          Full catalog →
        </Link>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {PRODUCT_TILES.map((p) => (
          <Link
            key={p.key}
            href={`/app/create?model=${p.key}`}
            className="relative rounded-2xl border border-vx-border bg-vx-panel p-4 hover:border-vx-accent transition-colors block"
          >
            <div className="flex items-start justify-between">
              <div className="text-2xl leading-none">{p.icon}</div>
              {p.badge && (
                <span className={`font-vx-mono text-[8.5px] tracking-[0.1em] font-bold px-1.5 py-0.5 rounded ${
                  p.badge === 'TOP' || p.badge === 'PREMIUM'
                    ? 'bg-vx-money text-vx-money-ink'
                    : 'bg-vx-accent text-vx-accent-ink'
                }`}>
                  {p.badge}
                </span>
              )}
            </div>
            <div className="mt-3 text-sm font-extrabold">{p.name}</div>
            <div className="mt-0.5 font-vx-mono text-[9.5px] tracking-[0.1em] text-vx-fg-muted">{p.kind.toUpperCase()}</div>
            <div className="mt-2 text-[11.5px] text-vx-fg-body leading-snug">{p.hint}</div>
            <div className="mt-3 font-vx-mono text-[12px] font-bold text-vx-money vx-num">
              {priceOf(p.key, p.credits)} cr
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ─── Hero statement ─── */
// The priced model list lives in one place now: ModelShelf, below the
// presets wall. This section carries the promise, not a second copy of
// the catalog.
function HeroStatement() {
  return (
    <section id="honesty" className="px-4 sm:px-6 pt-20 pb-6 max-w-[1400px] mx-auto">
      <div className="max-w-[900px]">
        <div className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-accent mb-4">THE HONESTY SIGNATURE</div>
        <h2 className="text-[40px] sm:text-[54px] md:text-[72px] font-black leading-[0.98] tracking-[-0.035em] text-balance">
          EVERY GENERATION<br/>
          SHOWS ITS PRICE<br/>
          <span className="text-vx-money">BEFORE YOU SPEND.</span>
        </h2>
        <p className="mt-6 text-[16px] text-vx-fg-body leading-[1.6] max-w-[540px]">
          The button is the price tag. Failed jobs refund automatically.
          One balance across every model — visible math.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Link
            href="#shelf"
            className="font-vx-mono text-[11px] tracking-[0.12em] text-vx-accent hover:text-vx-fg"
          >
            SEE EVERY MODEL AND ITS PRICE →
          </Link>
          <span className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">
            REFUND ON FAILURE · ALWAYS
          </span>
        </div>
      </div>
    </section>
  );
}

/* ─── Effects preset wall ─── */
function EffectsWall() {
  return (
    <section className="px-4 sm:px-6 pt-20 pb-8 max-w-[1400px] mx-auto">
      <div className="flex items-baseline justify-between mb-6 flex-wrap gap-2">
        <div>
          <div className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-accent mb-2">PRESETS · ONE-TAP LOOKS</div>
          <h2 className="text-2xl sm:text-3xl font-black tracking-[-0.02em]">Big-budget effects. Priced on tap.</h2>
        </div>
        <Link href="/presets" className="text-sm font-semibold text-vx-fg-muted hover:text-vx-fg">
          Browse all →
        </Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {EFFECT_PRESETS.map((e) => (
          <Link
            key={e.name}
            href="/presets"
            className="group block relative rounded-2xl overflow-hidden border border-vx-border transition-transform duration-200 hover:scale-[1.02]"
            style={{ background: e.bg, aspectRatio: '1/1' }}
          >
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-90 group-hover:opacity-100" />
            <div className="absolute inset-x-0 bottom-0 p-3 text-left">
              <div className="font-black text-white text-sm tracking-tight">{e.name}</div>
              <div className="mt-1 font-vx-mono text-[9.5px] tracking-[0.1em] text-vx-accent">RECREATE →</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ─── Model shelf — live rows from the catalog (same source as /api/catalog) ─── */
const SHELF_GROUPS = [
  { kind: 'video', label: 'VIDEO', blurb: 'Text-to-video and image-to-video.' },
  { kind: 'image', label: 'IMAGE', blurb: 'Stills, edits and photoreal frames.' },
  { kind: 'audio', label: 'AUDIO', blurb: 'Music and voice, same balance.' },
];

// Catalog names carry a trailing parenthetical that restates the modality
// ("Kling 3.0 (image-to-video)", "ACE-Step (music/SFX)"); the card already
// prints the modality underneath, so drop it for display only.
function shelfName(name) {
  return String(name || '').replace(/\s*\([^()]*\)\s*$/, '');
}

function ModelShelf({ catalog }) {
  const groups = SHELF_GROUPS
    .map((g) => ({ ...g, rows: catalog.filter((m) => m.kind === g.kind) }))
    .filter((g) => g.rows.length > 0);
  if (groups.length === 0) return null;
  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <section id="shelf" className="px-4 sm:px-6 pt-20 pb-8 max-w-[1400px] mx-auto">
      <div className="flex items-baseline justify-between mb-6 flex-wrap gap-2">
        <div>
          <div className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-accent mb-2">
            THE SHELF · {total} LIVE MODELS
          </div>
          <h2 className="text-2xl sm:text-3xl font-black tracking-[-0.02em]">Every model. Every price. No tiers to decode.</h2>
        </div>
        <Link href="/pricing" className="text-sm font-semibold text-vx-fg-muted hover:text-vx-fg">
          Full pricing →
        </Link>
      </div>

      <div className="space-y-8">
        {groups.map((g) => (
          <div key={g.kind}>
            <div className="flex items-baseline gap-3 mb-3">
              <span className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">{g.label}</span>
              <span className="text-[13px] text-vx-fg-faint">{g.blurb}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {g.rows.map((m) => (
                <Link
                  key={m.id}
                  href={`/app/create?model=${m.id}`}
                  className="group rounded-2xl border border-vx-border bg-vx-panel p-4 flex flex-col gap-3 transition-colors hover:border-vx-accent/60"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-bold text-[15px] leading-tight">{shelfName(m.name)}</span>
                    {m.gated && (
                      <span className="font-vx-mono text-[8.5px] tracking-[0.12em] text-vx-money shrink-0 mt-0.5">
                        ◆ PREMIUM
                      </span>
                    )}
                  </div>
                  <div className="flex items-end justify-between gap-2 mt-auto">
                    <span className="font-vx-mono text-[9px] tracking-[0.1em] text-vx-fg-faint uppercase">{m.modality || m.kind}</span>
                    <span className="font-vx-mono text-lg font-bold text-vx-money vx-num leading-none">
                      {m.credits} <span className="text-[10px] font-semibold">cr</span>
                    </span>
                  </div>
                  <div className="font-vx-mono text-[9.5px] tracking-[0.1em] text-vx-accent opacity-0 group-hover:opacity-100 transition-opacity">
                    GENERATE →
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-6 font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">
        PRICES READ FROM THE LIVE CATALOG · REFUND ON FAILURE · ALWAYS
      </p>
    </section>
  );
}

/* ─── Why Veyrnox — 4 pillars ─── */
function WhyVeyrnox() {
  return (
    <section className="px-4 sm:px-6 pt-20 pb-6 max-w-[1400px] mx-auto">
      <div className="text-center mb-8">
        <div className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-accent mb-2">WHY VEYRNOX</div>
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-[-0.02em] text-balance">Honest math. One balance. Every credit on the record.</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {PILLARS.map((p) => (
          <div key={p.key} className="rounded-2xl border border-vx-border bg-vx-panel p-6 flex flex-col">
            <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-accent">{p.kicker}</div>
            <div className="mt-3 font-vx-mono text-[26px] sm:text-[36px] font-bold text-vx-accent vx-num leading-none">{p.stat}</div>
            <div className="mt-4 text-[15px] font-bold leading-snug text-balance">{p.title}</div>
            <div className="mt-2 text-[12.5px] text-vx-fg-body leading-[1.55]">{p.body}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── Alternating feature strips ─── */
function FeatureStripsSection() {
  return (
    <section className="px-4 sm:px-6 pt-16 pb-6 max-w-[1400px] mx-auto flex flex-col gap-4">
      <FeatureStrip
        kicker="CATALOG"
        title="One balance across every model."
        body="Nano Banana, Flux.2, Seedream, Wan, Kling, MiniMax, Veo, ACE-Step. Debit on submit, refund on fail, one balance across the whole catalog."
        cta={{ label: 'Open the app', href: '/app' }}
        bg="linear-gradient(135deg,#0a1a2c 0%,#144a7a 55%,#3ec1e8 100%)"
      />
      <FeatureStrip
        kicker="PRESETS"
        title="Big-budget effects, one tap."
        body="Curated presets wired to model + prompt combos. Browse free, generate on-tap — cost shown up front."
        cta={{ label: 'Browse presets', href: '/presets' }}
        bg="linear-gradient(135deg,#1b0632 0%,#5a0e6a 55%,#e4318f 100%)"
        reverse
      />
      <FeatureStrip
        kicker="LEDGER"
        title="Every credit accounted for."
        body="Debits and refunds are append-only ledger rows, never edits. Your balance is the sum of them, and you can read the history back."
        cta={{ label: 'See your balance', href: '/app/credits' }}
        bg="linear-gradient(135deg,#08120b 0%,#0e3a1e 55%,#2ea258 100%)"
      />
    </section>
  );
}

function FeatureStrip({ kicker, title, body, cta, bg, reverse = false }) {
  return (
    <div className={`rounded-3xl border border-vx-border bg-vx-panel overflow-hidden grid grid-cols-1 lg:grid-cols-2 ${reverse ? 'lg:grid-flow-dense lg:[&>*:first-child]:col-start-2' : ''}`}>
      <div className="p-6 sm:p-10 lg:p-14">
        <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-accent mb-3">{kicker}</div>
        <h3 className="text-[24px] sm:text-[30px] md:text-[34px] font-black leading-[1.05] tracking-[-0.02em] text-balance">{title}</h3>
        <p className="mt-4 text-vx-fg-body max-w-[500px] leading-[1.6]">{body}</p>
        <Link
          href={cta.href}
          className="inline-block mt-6 rounded-full bg-vx-accent text-vx-accent-ink px-6 py-3 text-sm font-extrabold hover:bg-vx-accent-hover"
        >
          {cta.label}
        </Link>
      </div>
      <div className="min-h-[260px]" style={{ background: bg }} />
    </div>
  );
}

/* ─── FAQ ─── */
function FAQBlock() {
  return (
    <section id="faq" className="px-4 sm:px-6 pt-16 pb-6 max-w-[900px] mx-auto">
      <div className="text-center mb-8">
        <div className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-accent mb-2">FAQ</div>
        <h2 className="text-2xl sm:text-3xl md:text-4xl font-black tracking-[-0.02em]">Everything you&rsquo;d ask.</h2>
      </div>
      <div className="rounded-2xl border border-vx-border bg-vx-panel divide-y divide-vx-border/60">
        {FAQ.map((row) => (
          <details key={row.q} className="group px-6 py-4">
            <summary className="cursor-pointer list-none flex items-center justify-between gap-4">
              <span className="font-bold text-[15px]">{row.q}</span>
              <span
                aria-hidden="true"
                className="font-vx-mono text-vx-accent text-lg leading-none transition-transform group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="mt-3 text-[14px] text-vx-fg-body leading-[1.65]">
              {row.a}
              {row.link && (
                <>
                  {' '}
                  <Link href={row.link.href} className="text-vx-accent underline underline-offset-4 hover:text-vx-accent-hover">
                    {row.link.label} →
                  </Link>
                </>
              )}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}

/* ─── Closing CTA ─── */
function ClosingCTA({ modelCount }) {
  return (
    <section className="px-4 sm:px-6 pt-16 pb-16 max-w-[1400px] mx-auto">
      <div className="rounded-3xl border border-vx-border bg-vx-panel p-6 sm:p-10 lg:p-14 text-center">
        <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-accent mb-3">
          <span aria-hidden="true" className="mr-1">●</span>{HERO_CHIP}
        </div>
        <h2 className="text-[28px] sm:text-[40px] md:text-[52px] font-black tracking-[-0.03em] leading-[1.05] text-balance max-w-[820px] mx-auto">
          Ship your first asset today.<br />
          <span className="text-vx-accent">See the price before you spend.</span>
        </h2>
        <p className="mt-4 text-vx-fg-body max-w-[560px] mx-auto">
          50 credits on the house when you join. One balance across every model. Failed jobs refund automatically.
        </p>
        <div className="mt-6 flex gap-3 justify-center flex-wrap">
          <Link href="/app" className="rounded-full bg-vx-accent text-vx-accent-ink px-8 py-4 text-base font-extrabold hover:bg-vx-accent-hover">
            Claim 50 credits
          </Link>
          <Link href="/pricing" className="rounded-full border border-vx-border text-vx-fg px-8 py-4 text-base font-bold hover:border-vx-accent">
            See pricing
          </Link>
        </div>
      </div>
      <MetricStripBlock modelCount={modelCount} />
    </section>
  );
}

function MetricStripBlock({ modelCount }) {
  return (
    <div className="mt-8 rounded-3xl border border-vx-border bg-vx-panel grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-vx-border/60">
      {METRIC_STRIP.map((m) => (
        <div key={m.label} className="p-6 md:p-8 text-center">
          <div className="font-vx-mono text-[24px] sm:text-[32px] md:text-[40px] font-bold text-vx-accent vx-num leading-none break-words">{m.value ?? modelCount}</div>
          <div className="mt-3 font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">{m.label}</div>
        </div>
      ))}
    </div>
  );
}

/* ─── Footer forest ─── */
function FooterForest({ catalog }) {
  // The Models column used to be plain text — every row is a real catalog
  // id, so each one now opens the studio on that model.
  const columns = MORE_FEATURES.map((col) =>
    col.group === 'Models'
      ? {
          ...col,
          items: catalog.map((m) => ({
            label: shelfName(m.name) + (m.premium ? ' ◆' : ''),
            href: `/app/create?model=${encodeURIComponent(m.id)}`,
          })),
        }
      : col,
  );
  return (
    <footer className="border-t border-vx-border">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-[1.4fr_repeat(4,1fr)] gap-8 sm:gap-10">
          <div className="col-span-2 sm:col-span-3 lg:col-span-1">
            {/* The wordmark is the conventional way back to the top of a
                site; it used to be inert down here. */}
            <Link href="/" aria-label="Veyrnox.ai — home" className="inline-flex">
              <Logo size={28} wordmark />
            </Link>
            <p className="mt-4 text-sm text-vx-fg-body max-w-[320px] leading-[1.6]">{FOOTER_TAGLINE}</p>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="mt-4 inline-block text-[13px] text-vx-accent underline underline-offset-4 hover:text-vx-accent-hover"
            >
              {SUPPORT_EMAIL}
            </a>
          </div>
          {columns.map((col) => (
            <div key={col.group}>
              <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted mb-3">
                {col.group.toUpperCase()}
              </div>
              <ul className="space-y-2">
                {col.items.map((it) => (
                  <li key={it.label}>
                    <FooterLink href={it.href}>{it.label}</FooterLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-vx-border">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 text-xs text-vx-fg-muted flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {/* Called at render, not at module load: a constant froze the
                year to whenever the Worker bundle happened to boot. */}
            <span>{footerStamp()}</span>
            <span aria-hidden="true">·</span>
            <span>
              Last updated <time dateTime={SITE_UPDATED}>{formatUpdated(SITE_UPDATED)}</time>
            </span>
          </div>
          <div className="flex flex-wrap gap-4">
            <Link href="/legal/terms" className="transition-colors hover:text-vx-fg">Terms</Link>
            <Link href="/legal/privacy" className="transition-colors hover:text-vx-fg">Privacy</Link>
            <Link href="/design-system" className="transition-colors hover:text-vx-fg">Design</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

// mailto: and other external schemes go through a plain anchor — next/link
// is for routes it can prefetch.
function FooterLink({ href, children }) {
  const cls = 'text-[13px] text-vx-fg-body transition-colors hover:text-vx-fg underline-offset-4 hover:underline';
  if (!href) return <span className="text-[13px] text-vx-fg-muted">{children}</span>;
  if (/^[a-z]+:/i.test(href)) {
    return <a href={href} className={cls}>{children}</a>;
  }
  return <Link href={href} className={cls}>{children}</Link>;
}

function formatUpdated(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
