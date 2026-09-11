import Link from 'next/link';
import { Logo } from './_components/Logo';
import { Chip } from './_components/Chip';
import { NavAuthButtons } from './_components/NavAuthButtons';
import {
  NAV_CATEGORIES,
  FEATURE_CARDS,
  PRODUCT_TILES,
  EFFECT_PRESETS,
  CREATOR_PROJECTS,
  MORE_FEATURES,
  HERO_STATS,
  METRIC_STRIP,
  PILLARS,
  FAQ,
  PROMO_STRIP,
  HERO_CHIP,
  FOOTER_TAGLINE,
  FOOTER_STAMP,
  MODELS as MODELS_FALLBACK,
} from './_lib/tokens';
import { select, envConfig } from '../../packages/db/supabase-client.js';

export const revalidate = 300;

// Landing — credit-metered AI image and video generation.
// EU-hosted, C2PA-signed. The button is the price tag.

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
      kind: m.modality,
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
      <FeaturedHeroCards />
      <SignupIncentive />
      <ProductTilesRow />
      <HeroStatement catalog={catalog} />
      <EffectsWall />
      <WhyVeyrnox />
      <CreatorGrid />
      <FeatureStripsSection />
      <FAQBlock />
      <ClosingCTA />
      <FooterForest />
    </div>
  );
}

/* ─── Amber promo strip ─── */
function PromoStrip() {
  return (
    <div className="bg-vx-money text-vx-money-ink text-[13px] font-bold px-6 py-2 flex items-center justify-center gap-3 flex-wrap">
      <span aria-hidden="true" className="font-vx-mono text-[11px] tracking-[0.14em]">◆</span>
      <span>{PROMO_STRIP.message}</span>
      <Link
        href={PROMO_STRIP.href}
        className="bg-vx-base text-vx-fg rounded-full px-3 py-1 text-[11px] font-bold hover:bg-black/80"
      >
        {PROMO_STRIP.cta}
      </Link>
    </div>
  );
}

/* ─── Wide sticky nav ─── */
function WideNav() {
  return (
    <div className="sticky top-0 z-40 h-16 border-b border-vx-border bg-vx-base/90 backdrop-blur">
      <div className="h-full px-6 flex items-center gap-6 max-w-[1300px] mx-auto">
        <Link href="/veyrnox" className="flex items-center shrink-0" aria-label="Veyrnox.ai">
          <Logo size={30} wordmark />
        </Link>
        <nav className="flex gap-1 items-center overflow-x-auto scrollbar-none flex-1">
          {NAV_CATEGORIES.map((c) => (
            <a
              key={c.href}
              href={c.href}
              className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-semibold text-vx-fg-body hover:text-vx-fg hover:bg-vx-panel"
            >
              {c.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2 shrink-0">
          <NavAuthButtons />
        </div>
      </div>
    </div>
  );
}

/* ─── Featured hero cards (5 wide, kicker + title + Open) ─── */
function FeaturedHeroCards() {
  return (
    <section id="explore" className="px-6 pt-8 max-w-[1400px] mx-auto">
      <Hero />
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
                <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-body/85">
                  {f.kicker}
                </div>
                <div className="font-black text-[16px] leading-tight text-balance">{f.title}</div>
                <div className="text-[12px] text-vx-fg-body/85 leading-snug">{f.body}</div>
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
function Hero() {
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
      <div className="relative max-w-[1000px] mx-auto pt-16 pb-8 flex flex-col items-center text-center gap-6">
        <Chip tone="accent" noGlyph>
          <span aria-hidden="true" className="mr-1 text-vx-accent">●</span>
          {HERO_CHIP}
        </Chip>
        <h1 className="text-[56px] md:text-[72px] font-black leading-[0.98] tracking-[-0.035em] text-balance max-w-[900px]">
          One prompt in. Endless creations out.<br />
          <span className="text-vx-accent">Priced on the button.</span>
        </h1>
        <p className="text-lg text-vx-fg-body max-w-[640px] leading-[1.6]">
          Credit-metered AI image, video and audio. See the exact cost before you press generate —
          refund on failure, always. EU-hosted, C2PA-signed.
        </p>
        <div className="flex gap-3 mt-2 flex-wrap justify-center">
          <Link
            href="/veyrnox/app/create"
            className="rounded-full bg-vx-accent text-vx-accent-ink px-8 py-4 text-base font-extrabold hover:bg-vx-accent-hover"
          >
            Start creating
          </Link>
          <Link
            href="/veyrnox/pricing"
            className="rounded-full border border-vx-border text-vx-fg px-8 py-4 text-base font-bold hover:border-vx-accent"
          >
            See how it works
          </Link>
        </div>
        <div className="mt-8 grid grid-cols-3 gap-8 max-w-[720px] w-full">
          {HERO_STATS.map((s) => (
            <div key={s.label} className="text-center">
              <div className="font-vx-mono text-[24px] font-bold text-vx-accent vx-num">{s.value}</div>
              <div className="mt-1 text-xs text-vx-fg-muted">{s.label}</div>
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
    <section className="px-6 pt-8 max-w-[1400px] mx-auto">
      <div
        className="relative rounded-3xl overflow-hidden border border-vx-border"
        style={{ background: 'linear-gradient(135deg,#0a1a2c 0%,#0e3a4a 45%,#2ec8a3 100%)' }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-transparent" />
        <div className="relative grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-8 p-10 lg:p-14 items-center">
          <div>
            <Chip tone="money" className="mb-4">SIGN-UP BONUS</Chip>
            <h2 className="text-[44px] font-black leading-[1.02] tracking-[-0.03em] text-balance">
              50 free credits.<br/>
              <span className="text-vx-accent">Every button shows its price.</span>
            </h2>
            <ul className="mt-5 space-y-2 text-[14px] text-vx-fg-body">
              <li className="flex gap-2"><span className="text-vx-accent">✓</span> Every model on one balance</li>
              <li className="flex gap-2"><span className="text-vx-accent">✓</span> Failed jobs refund automatically</li>
              <li className="flex gap-2"><span className="text-vx-accent">✓</span> No card required to browse</li>
            </ul>
            <div className="mt-6 flex gap-3">
              <Link
                href="/veyrnox/app"
                className="rounded-full bg-vx-accent text-vx-accent-ink px-6 py-3 text-sm font-extrabold hover:bg-vx-accent-hover"
              >
                Claim 50 credits
              </Link>
              <Link
                href="/veyrnox/presets"
                className="rounded-full border border-white/30 text-white px-6 py-3 text-sm font-bold hover:border-white"
              >
                Browse presets free
              </Link>
            </div>
          </div>
          <div />
        </div>
      </div>
    </section>
  );
}

/* ─── Product tiles (6, live catalog rows) ─── */
function ProductTilesRow() {
  return (
    <section id="models" className="px-6 pt-16 max-w-[1400px] mx-auto">
      <div className="flex items-baseline justify-between mb-6 flex-wrap gap-2">
        <div>
          <div className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-accent mb-2">EVERY MODEL. ONE BALANCE.</div>
          <h2 className="text-3xl font-black tracking-[-0.02em]">Ten models on the shelf.</h2>
        </div>
        <Link href="/veyrnox/pricing" className="text-sm font-semibold text-vx-fg-muted hover:text-vx-fg">
          Full catalog →
        </Link>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {PRODUCT_TILES.map((p) => (
          <Link
            key={p.key}
            href={`/veyrnox/app/create?model=${p.key}`}
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
              {p.credits} cr
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ─── Hero statement + live catalog ledger ─── */
function HeroStatement({ catalog }) {
  return (
    <section id="honesty" className="px-6 pt-20 pb-6 max-w-[1400px] mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-10 items-center">
        <div>
          <div className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-accent mb-4">THE HONESTY SIGNATURE</div>
          <h2 className="text-[54px] md:text-[64px] font-black leading-[0.98] tracking-[-0.035em] text-balance">
            EVERY GENERATION<br/>
            SHOWS ITS PRICE<br/>
            <span className="text-vx-money">BEFORE YOU SPEND.</span>
          </h2>
          <p className="mt-6 text-[16px] text-vx-fg-body leading-[1.6] max-w-[540px]">
            The button is the price tag. Failed jobs refund automatically.
            One balance across every model — visible math.
          </p>
        </div>
        <div className="rounded-2xl border border-vx-border bg-vx-panel overflow-hidden">
          <div className="px-5 py-3 border-b border-vx-border font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted flex justify-between">
            <span>MODEL · MODALITY</span>
            <span>CREDITS</span>
          </div>
          {catalog.slice(0, 10).map((m) => (
            <div key={m.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-5 py-2.5 border-b border-vx-border/60 last:border-b-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-bold truncate">{m.name}</span>
                {m.premium && <span className="font-vx-mono text-[8.5px] tracking-[0.1em] text-vx-money shrink-0">◆</span>}
              </div>
              <span className="font-vx-mono text-[9px] tracking-[0.1em] text-vx-fg-faint uppercase">{m.kind}</span>
              <div className="font-vx-mono text-sm font-bold text-vx-money vx-num text-right w-16">{m.credits} cr</div>
            </div>
          ))}
          <div className="px-5 py-3 border-t border-vx-border font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted text-center">
            REFUND ON FAILURE · ALWAYS
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Effects preset wall ─── */
function EffectsWall() {
  return (
    <section className="px-6 pt-20 pb-8 max-w-[1400px] mx-auto">
      <div className="flex items-baseline justify-between mb-6 flex-wrap gap-2">
        <div>
          <div className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-accent mb-2">PRESETS · ONE-TAP LOOKS</div>
          <h2 className="text-3xl font-black tracking-[-0.02em]">Big-budget effects. Priced on tap.</h2>
        </div>
        <Link href="/veyrnox/presets" className="text-sm font-semibold text-vx-fg-muted hover:text-vx-fg">
          Browse all →
        </Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {EFFECT_PRESETS.map((e, i) => (
          <button
            key={e.name}
            className="group relative rounded-2xl overflow-hidden border border-vx-border transition-transform duration-200 hover:scale-[1.02]"
            style={{ background: e.bg, aspectRatio: i % 5 === 0 ? '3/4' : '1/1' }}
          >
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-90 group-hover:opacity-100" />
            <div className="absolute inset-x-0 bottom-0 p-3 text-left">
              <div className="font-black text-white text-sm tracking-tight">{e.name}</div>
              <div className="mt-1 font-vx-mono text-[9.5px] tracking-[0.1em] text-vx-accent">RECREATE →</div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ─── Why Veyrnox — 4 pillars ─── */
function WhyVeyrnox() {
  return (
    <section className="px-6 pt-20 pb-6 max-w-[1400px] mx-auto">
      <div className="text-center mb-8">
        <div className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-accent mb-2">WHY VEYRNOX</div>
        <h2 className="text-3xl md:text-4xl font-black tracking-[-0.02em]">Honest math. Sovereign infra. Signed by default.</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {PILLARS.map((p) => (
          <div key={p.key} className="rounded-2xl border border-vx-border bg-vx-panel p-6 flex flex-col">
            <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-accent">{p.kicker}</div>
            <div className="mt-3 font-vx-mono text-[36px] font-bold text-vx-accent vx-num leading-none">{p.stat}</div>
            <div className="mt-4 text-[15px] font-bold leading-snug text-balance">{p.title}</div>
            <div className="mt-2 text-[12.5px] text-vx-fg-body leading-[1.55]">{p.body}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── Creator grid ─── */
function CreatorGrid() {
  return (
    <section id="community" className="px-6 pt-20 pb-8 max-w-[1400px] mx-auto">
      <div className="flex items-baseline justify-between mb-6 flex-wrap gap-2">
        <div>
          <div className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-accent mb-2">MADE ON VEYRNOX</div>
          <h2 className="text-3xl font-black tracking-[-0.02em]">Watch it get made.</h2>
        </div>
        <Link href="/veyrnox/community" className="text-sm font-semibold text-vx-fg-muted hover:text-vx-fg">Explore all →</Link>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {CREATOR_PROJECTS.map((p) => (
          <button
            key={p.title}
            className="text-left rounded-2xl overflow-hidden border border-vx-border bg-vx-panel hover:border-vx-accent transition-colors"
          >
            <div className="aspect-[4/5] relative" style={{ background: p.bg }}>
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute top-3 left-3 flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-black/60 border border-white/30 flex items-center justify-center font-vx-mono text-[10px] text-vx-accent">
                  {p.handle[1]?.toUpperCase() || 'V'}
                </div>
                <span className="font-vx-mono text-[10px] text-white/85">{p.handle}</span>
              </div>
              <div className="absolute inset-x-0 bottom-0 p-3">
                <div className="font-extrabold text-white text-sm tracking-tight">{p.title}</div>
                <div className="mt-1 flex gap-3 font-vx-mono text-[10px] text-white/80 vx-num">
                  <span>♥ {p.likes}</span>
                  <span>▶ {p.views}</span>
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ─── Alternating feature strips ─── */
function FeatureStripsSection() {
  return (
    <section className="px-6 pt-16 pb-6 max-w-[1400px] mx-auto flex flex-col gap-4">
      <FeatureStrip
        kicker="CATALOG"
        title="One balance across every model."
        body="Nano Banana, Wan, Seedance, Kling, Veo, ACE Step. Debit on submit, refund on fail, one balance across the whole catalog."
        cta={{ label: 'Open the studio', href: '/veyrnox/app' }}
        bg="linear-gradient(135deg,#0a1a2c 0%,#144a7a 55%,#3ec1e8 100%)"
      />
      <FeatureStrip
        kicker="PRESETS"
        title="Big-budget effects, one tap."
        body="Curated preset gradients wired to model + prompt combos. Browse free, generate on-tap — cost shown up front."
        cta={{ label: 'Browse presets', href: '/veyrnox/presets' }}
        bg="linear-gradient(135deg,#1b0632 0%,#5a0e6a 55%,#e4318f 100%)"
        reverse
      />
      <FeatureStrip
        kicker="EU · C2PA"
        title="Frankfurt-hosted. Signed by default."
        body="Compute stays in the EU. Every generation carries a C2PA signature — auditable origin, model, creator."
        cta={{ label: 'Read the honesty ledger', href: '/veyrnox/design-system' }}
        bg="linear-gradient(135deg,#08120b 0%,#0e3a1e 55%,#2ea258 100%)"
      />
    </section>
  );
}

function FeatureStrip({ kicker, title, body, cta, bg, reverse = false }) {
  return (
    <div className={`rounded-3xl border border-vx-border bg-vx-panel overflow-hidden grid grid-cols-1 lg:grid-cols-2 ${reverse ? 'lg:[&>*:first-child]:col-start-2' : ''}`}>
      <div className="p-10 lg:p-14">
        <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-accent mb-3">{kicker}</div>
        <h3 className="text-[30px] md:text-[34px] font-black leading-[1.05] tracking-[-0.02em] text-balance">{title}</h3>
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
    <section id="faq" className="px-6 pt-16 pb-6 max-w-[900px] mx-auto">
      <div className="text-center mb-8">
        <div className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-accent mb-2">FAQ</div>
        <h2 className="text-3xl md:text-4xl font-black tracking-[-0.02em]">Everything you'd ask.</h2>
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
function ClosingCTA() {
  return (
    <section className="px-6 pt-16 pb-16 max-w-[1400px] mx-auto">
      <div className="rounded-3xl border border-vx-border bg-vx-panel p-14 text-center">
        <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-accent mb-3">
          <span aria-hidden="true" className="mr-1">●</span>{HERO_CHIP}
        </div>
        <h2 className="text-[40px] md:text-[52px] font-black tracking-[-0.03em] leading-[1.05] text-balance max-w-[820px] mx-auto">
          Ship your first asset today.<br />
          <span className="text-vx-accent">See the price before you spend.</span>
        </h2>
        <p className="mt-4 text-vx-fg-body max-w-[560px] mx-auto">
          50 credits on the house when you join. One balance across every model. Failed jobs refund automatically.
        </p>
        <div className="mt-6 flex gap-3 justify-center flex-wrap">
          <Link href="/veyrnox/app" className="rounded-full bg-vx-accent text-vx-accent-ink px-8 py-4 text-base font-extrabold hover:bg-vx-accent-hover">
            Claim 50 credits
          </Link>
          <Link href="/veyrnox/pricing" className="rounded-full border border-vx-border text-vx-fg px-8 py-4 text-base font-bold hover:border-vx-accent">
            See pricing
          </Link>
        </div>
      </div>
      <MetricStripBlock />
    </section>
  );
}

function MetricStripBlock() {
  return (
    <div className="mt-8 rounded-3xl border border-vx-border bg-vx-panel grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-vx-border/60">
      {METRIC_STRIP.map((m) => (
        <div key={m.label} className="p-6 md:p-8 text-center">
          <div className="font-vx-mono text-[32px] md:text-[40px] font-bold text-vx-accent vx-num leading-none">{m.value}</div>
          <div className="mt-3 font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">{m.label}</div>
        </div>
      ))}
    </div>
  );
}

/* ─── Footer forest ─── */
function FooterForest() {
  return (
    <footer className="border-t border-vx-border">
      <div className="max-w-[1400px] mx-auto px-6 py-14">
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_repeat(4,1fr)] gap-10">
          <div>
            <Logo size={28} wordmark />
            <p className="mt-4 text-sm text-vx-fg-body max-w-[320px] leading-[1.6]">{FOOTER_TAGLINE}</p>
          </div>
          {MORE_FEATURES.map((col) => (
            <div key={col.group}>
              <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted mb-3">
                {col.group.toUpperCase()}
              </div>
              <ul className="space-y-2">
                {col.items.map((it) => {
                  const label = typeof it === 'string' ? it : it.label;
                  const href = typeof it === 'string' ? null : it.href;
                  return (
                    <li key={label}>
                      {href ? (
                        <Link href={href} className="text-[13px] text-vx-fg-body hover:text-vx-fg underline-offset-4 hover:underline">
                          {label}
                        </Link>
                      ) : (
                        <span className="text-[13px] text-vx-fg-body">{label}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-vx-border">
        <div className="max-w-[1400px] mx-auto px-6 py-6 text-xs text-vx-fg-muted flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div>{FOOTER_STAMP}</div>
          <div className="flex gap-4">
            <Link href="/veyrnox/design-system" className="hover:text-vx-fg">Design</Link>
            <Link href="/veyrnox/app/admin" className="hover:text-vx-fg">Status</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
