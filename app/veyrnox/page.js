import Link from 'next/link';
import { Logo } from './_components/Logo';
import { Chip } from './_components/Chip';
import {
  NAV_CATEGORIES,
  FEATURE_CARDS,
  PRODUCT_TILES,
  EFFECT_PRESETS,
  CREATOR_PROJECTS,
  MORE_FEATURES,
  PROMO_STRIP,
  CONTEST,
  MODELS,
} from './_lib/tokens';

// Landing — Higgsfield-genre density, Muon voice (aqua+amber, no lime).
export default function MuonLanding() {
  return (
    <div className="min-h-dvh">
      <PromoStrip />
      <WideNav />

      {/* ============ FEATURE PROMO ROW (5 wide cards) ============ */}
      <FeaturePromoRow />

      {/* ============ SIGN-UP INCENTIVE OVER HERO IMAGE ============ */}
      <SignupIncentive />

      {/* ============ PRODUCT TILES ROW ============ */}
      <ProductTilesRow />

      {/* ============ HERO STATEMENT + MODEL LEDGER ============ */}
      <HeroStatement />

      {/* ============ EFFECTS PRESET WALL ============ */}
      <EffectsWall />

      {/* ============ CONTEST RIBBON ============ */}
      <ContestRibbon />

      {/* ============ CREATOR GRID ============ */}
      <CreatorGrid />

      {/* ============ FEATURE STRIPS (alternating) ============ */}
      <FeatureStrip
        kicker="NEW"
        title="One canvas. Every workflow."
        body="Moodboard, chain workflows, share with your team — one page. Every step shows its debit, so no surprise bills."
        cta={{ label: 'Try Canvas', href: '/veyrnox/app/create' }}
        bg="linear-gradient(135deg,#0a1a2c 0%,#144a7a 55%,#3ec1e8 100%)"
      />
      <FeatureStrip
        kicker="CINEMA STUDIO"
        title="Different scenes. Same star."
        body="Character stays. Lens, look, weather change. One click does the rest — you still see the price first."
        cta={{ label: 'Open Cinema', href: '/veyrnox/app/create' }}
        bg="linear-gradient(135deg,#1b0632 0%,#5a0e6a 55%,#e4318f 100%)"
        reverse
      />
      <FeatureStrip
        kicker="MCP · CLI"
        title="Turn Claude into a creative engine."
        body="Point Claude Code at Veyrnox.ai. It picks the model, watches the cost, refunds on failure. Your balance is the ceiling."
        cta={{ label: 'Install the plugin', href: '/veyrnox/mcp' }}
        bg="linear-gradient(135deg,#08120b 0%,#0e3a1e 55%,#2ea258 100%)"
      />

      {/* ============ CLOSING CTA ============ */}
      <ClosingCTA />

      {/* ============ FOOTER FOREST ============ */}
      <FooterForest />
    </div>
  );
}

/* ─── Promo strip ─── */
function PromoStrip() {
  return (
    <div className="bg-muon-money text-muon-money-ink text-[13px] font-bold px-6 py-2 flex items-center justify-center gap-4">
      <span className="font-muon-mono text-[11px] tracking-[0.12em]">◆</span>
      <span>{PROMO_STRIP.message}</span>
      <Link
        href={PROMO_STRIP.href}
        className="bg-muon-base text-muon-fg rounded-full px-3 py-1 text-[11px] font-bold hover:bg-black/80"
      >
        {PROMO_STRIP.cta}
      </Link>
    </div>
  );
}

/* ─── Wide nav with category tabs + auth ─── */
function WideNav() {
  return (
    <div className="sticky top-0 z-40 h-16 border-b border-muon-border bg-muon-base/90 backdrop-blur">
      <div className="h-full px-6 flex items-center gap-6">
        <Link href="/veyrnox" className="flex items-center gap-2.5 shrink-0">
          <Logo size={30} />
          <span className="font-extrabold text-[14px] tracking-[0.18em]">VEYRNOX</span>
        </Link>

        <nav className="flex gap-1 items-center overflow-x-auto scrollbar-none flex-1">
          {NAV_CATEGORIES.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-semibold text-muon-fg-body hover:text-muon-fg hover:bg-muon-panel"
            >
              <span>{c.label}</span>
              {c.badge && (
                <span className={`font-muon-mono text-[8.5px] tracking-[0.1em] font-bold px-1.5 py-0.5 rounded ${
                  c.badge === 'NEW' ? 'bg-muon-accent text-muon-accent-ink' : 'bg-muon-money text-muon-money-ink'
                }`}>
                  {c.badge}
                </span>
              )}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <button className="text-muon-fg-body text-sm font-semibold px-3 py-2 hover:text-muon-fg">Sign in</button>
          <Link
            href="/veyrnox/app"
            className="rounded-full bg-muon-accent text-muon-accent-ink text-sm font-bold px-5 py-2.5 hover:bg-muon-accent-hover"
          >
            Start creating
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ─── Feature promo row (5 wide cards) ─── */
function FeaturePromoRow() {
  return (
    <section className="px-6 pt-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {FEATURE_CARDS.map((f) => (
          <button
            key={f.key}
            className="group text-left rounded-2xl border border-muon-border bg-muon-panel overflow-hidden transition-transform duration-200 ease-out hover:scale-[1.015]"
          >
            <div className="aspect-[4/5] relative" style={{ background: f.bg }}>
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-4">
                <div className="font-muon-mono text-[10px] tracking-[0.12em] text-muon-fg-body/90">
                  {f.kicker}
                </div>
                <div className="mt-1 font-black text-lg leading-tight text-balance">{f.title}</div>
                <div className="mt-1 text-xs text-muon-fg-body/85 leading-snug">{f.body}</div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ─── Sign-up incentive with hero preset backdrop ─── */
function SignupIncentive() {
  return (
    <section className="px-6 pt-6">
      <div
        className="relative rounded-3xl overflow-hidden border border-muon-border"
        style={{ background: 'linear-gradient(135deg,#0a1a2c 0%,#0e3a4a 45%,#2ec8a3 100%)' }}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-transparent" />
        <div className="relative grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-8 p-10 lg:p-14 items-center">
          <div>
            <Chip tone="money" className="mb-4">EARLY ACCESS</Chip>
            <h2 className="text-[44px] font-black leading-[1.02] tracking-[-0.03em] text-balance">
              START WITH<br/>200 FREE CREDITS.
            </h2>
            <ul className="mt-5 space-y-2 text-[14px] text-muon-fg-body">
              <li className="flex gap-2"><span className="text-muon-accent">✓</span> Every model on one balance</li>
              <li className="flex gap-2"><span className="text-muon-accent">✓</span> Failed jobs refund automatically</li>
              <li className="flex gap-2"><span className="text-muon-accent">✓</span> No card required to browse</li>
            </ul>
            <div className="mt-6 flex gap-3">
              <Link
                href="/veyrnox/pricing"
                className="rounded-full bg-muon-accent text-muon-accent-ink px-6 py-3 text-sm font-extrabold hover:bg-muon-accent-hover"
              >
                Claim credits
              </Link>
              <Link
                href="/veyrnox/presets"
                className="rounded-full border border-white/30 text-white px-6 py-3 text-sm font-bold hover:border-white"
              >
                Browse presets
              </Link>
            </div>
          </div>
          <div />
        </div>
      </div>
    </section>
  );
}

/* ─── Product tiles ─── */
function ProductTilesRow() {
  return (
    <section className="px-6 pt-8">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-xl font-black tracking-[-0.02em]">Everything in one balance</h2>
        <span className="font-muon-mono text-[10px] tracking-[0.12em] text-muon-fg-muted">10 MODELS · 3 AGENTS · 1 LEDGER</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {PRODUCT_TILES.map((p) => (
          <div
            key={p.key}
            className="relative rounded-2xl border border-muon-border bg-muon-panel p-4 hover:border-muon-accent transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="text-2xl leading-none">{p.icon}</div>
              {p.badge && (
                <span className={`font-muon-mono text-[8.5px] tracking-[0.1em] font-bold px-1.5 py-0.5 rounded ${
                  p.badge === 'TOP' ? 'bg-muon-money text-muon-money-ink' : 'bg-muon-accent text-muon-accent-ink'
                }`}>
                  {p.badge}
                </span>
              )}
            </div>
            <div className="mt-3 text-sm font-extrabold">{p.name}</div>
            <div className="mt-0.5 font-muon-mono text-[9.5px] tracking-[0.1em] text-muon-fg-muted">{p.kind.toUpperCase()}</div>
            <div className="mt-2 text-[11.5px] text-muon-fg-body leading-snug">{p.hint}</div>
            <div className="mt-3 font-muon-mono text-[12px] font-bold text-muon-money muon-num">
              {p.credits != null ? `${p.credits} cr` : 'free'}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── Hero statement + model ledger ─── */
function HeroStatement() {
  return (
    <section className="px-6 pt-16 pb-6">
      <div className="max-w-[1200px] mx-auto grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-10 items-center">
        <div>
          <div className="font-muon-mono text-[11px] tracking-[0.14em] text-muon-accent mb-4">THE HONESTY SIGNATURE</div>
          <h2 className="text-[64px] font-black leading-[0.98] tracking-[-0.035em] text-balance">
            EVERY GENERATION<br/>
            SHOWS ITS PRICE<br/>
            <span className="text-muon-money">BEFORE YOU SPEND.</span>
          </h2>
          <p className="mt-6 text-[16px] text-muon-fg-body leading-[1.6] max-w-[540px]">
            The button is the price tag. Failed jobs refund automatically.
            No opaque tokens, no per-model wallets — one balance, every model,
            visible math.
          </p>
        </div>
        <div className="rounded-2xl border border-muon-border bg-muon-panel overflow-hidden">
          <div className="px-5 py-3 border-b border-muon-border font-muon-mono text-[10px] tracking-[0.12em] text-muon-fg-muted flex justify-between">
            <span>MODEL · 5s CLIP</span>
            <span>CREDITS</span>
          </div>
          {MODELS.slice(0, 8).map((m) => (
            <div key={m.id} className="grid grid-cols-[1fr_auto] items-center px-5 py-2.5 border-b border-muon-border/60 last:border-b-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-bold truncate">{m.name}</span>
                {m.premium && <span className="font-muon-mono text-[8.5px] tracking-[0.1em] text-muon-money shrink-0">◆</span>}
                {m.tag && !m.premium && (
                  <span className="font-muon-mono text-[8.5px] tracking-[0.1em] text-muon-fg-faint shrink-0">{m.tag}</span>
                )}
              </div>
              <div className="font-muon-mono text-sm font-bold text-muon-money muon-num">{m.credits} cr</div>
            </div>
          ))}
          <div className="px-5 py-3 border-t border-muon-border font-muon-mono text-[10px] tracking-[0.12em] text-muon-fg-muted text-center">
            10s VIDEO = 2× · FAILURE ALWAYS REFUNDS
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─── Effects preset wall (masonry-ish) ─── */
function EffectsWall() {
  return (
    <section className="px-6 pt-16 pb-12">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <div className="font-muon-mono text-[11px] tracking-[0.14em] text-muon-accent mb-2">VISUAL EFFECTS</div>
          <h2 className="text-3xl font-black tracking-[-0.02em]">Big-budget effects, one tap.</h2>
        </div>
        <Link href="/veyrnox/presets" className="text-sm font-semibold text-muon-fg-muted hover:text-muon-fg">View all →</Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {EFFECT_PRESETS.map((e, i) => (
          <button
            key={e.name}
            className="group relative rounded-2xl overflow-hidden border border-muon-border transition-transform duration-200 hover:scale-[1.02]"
            style={{ background: e.bg, aspectRatio: i % 5 === 0 ? '3/4' : '1/1' }}
          >
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-90 group-hover:opacity-100" />
            <div className="absolute inset-x-0 bottom-0 p-3 text-left">
              <div className="font-black text-white text-sm tracking-tight">{e.name}</div>
              <div className="mt-1 font-muon-mono text-[9.5px] tracking-[0.1em] text-muon-accent">RECREATE →</div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ─── Contest ribbon ─── */
function ContestRibbon() {
  return (
    <section className="px-6 pt-6 pb-14">
      <div className="rounded-3xl border border-muon-border bg-muon-panel overflow-hidden grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="p-10">
          <Chip tone="danger" className="mb-4">{CONTEST.eyebrow}</Chip>
          <h2 className="text-[36px] font-black leading-[1.05] tracking-[-0.02em] text-balance">
            {CONTEST.title}
          </h2>
          <p className="mt-3 text-muon-fg-body max-w-[520px]">{CONTEST.body}</p>
          <div className="mt-5 flex gap-3">
            <Link
              href={CONTEST.primary.href}
              className="rounded-full bg-muon-accent text-muon-accent-ink px-6 py-3 text-sm font-extrabold hover:bg-muon-accent-hover"
            >
              {CONTEST.primary.label}
            </Link>
            <Link
              href={CONTEST.secondary.href}
              className="rounded-full border border-muon-border text-muon-fg px-6 py-3 text-sm font-bold hover:border-muon-accent"
            >
              {CONTEST.secondary.label}
            </Link>
          </div>
        </div>
        <div className="relative min-h-[220px]" style={{ background: 'linear-gradient(135deg,#0a1a2c 0%,#5a0e6a 55%,#e4318f 100%)' }}>
          <div className="absolute inset-0 bg-gradient-to-l from-black/30 to-transparent" />
          <div className="absolute top-6 right-6 font-muon-mono text-[10px] tracking-[0.12em] text-white/85">JURY · 12 CREATORS · 4 CATEGORIES</div>
        </div>
      </div>
    </section>
  );
}

/* ─── Creator grid ─── */
function CreatorGrid() {
  return (
    <section className="px-6 pt-6 pb-14">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <div className="font-muon-mono text-[11px] tracking-[0.14em] text-muon-accent mb-2">CREATING IN PUBLIC</div>
          <h2 className="text-3xl font-black tracking-[-0.02em]">Watch it get made.</h2>
        </div>
        <Link href="/veyrnox/community" className="text-sm font-semibold text-muon-fg-muted hover:text-muon-fg">Explore all →</Link>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {CREATOR_PROJECTS.map((p) => (
          <button
            key={p.title}
            className="text-left rounded-2xl overflow-hidden border border-muon-border bg-muon-panel hover:border-muon-accent transition-colors"
          >
            <div className="aspect-[4/5] relative" style={{ background: p.bg }}>
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute top-3 left-3 flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-black/60 border border-white/30 flex items-center justify-center font-muon-mono text-[10px] text-muon-accent">
                  {p.handle[1]?.toUpperCase() || 'M'}
                </div>
                <span className="font-muon-mono text-[10px] text-white/85">{p.handle}</span>
              </div>
              <div className="absolute inset-x-0 bottom-0 p-3">
                <div className="font-extrabold text-white text-sm tracking-tight">{p.title}</div>
                <div className="mt-1 flex gap-3 font-muon-mono text-[10px] text-white/80 muon-num">
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

/* ─── Alternating feature strip ─── */
function FeatureStrip({ kicker, title, body, cta, bg, reverse = false }) {
  return (
    <section className="px-6 pb-6">
      <div className={`rounded-3xl border border-muon-border bg-muon-panel overflow-hidden grid grid-cols-1 lg:grid-cols-2 ${reverse ? 'lg:[&>*:first-child]:col-start-2' : ''}`}>
        <div className="p-10 lg:p-14">
          <div className="font-muon-mono text-[10px] tracking-[0.14em] text-muon-accent mb-3">{kicker}</div>
          <h2 className="text-[34px] font-black leading-[1.05] tracking-[-0.02em] text-balance">{title}</h2>
          <p className="mt-4 text-muon-fg-body max-w-[500px] leading-[1.6]">{body}</p>
          <Link
            href={cta.href}
            className="inline-block mt-6 rounded-full bg-muon-accent text-muon-accent-ink px-6 py-3 text-sm font-extrabold hover:bg-muon-accent-hover"
          >
            {cta.label}
          </Link>
        </div>
        <div className="min-h-[260px]" style={{ background: bg }} />
      </div>
    </section>
  );
}

/* ─── Closing CTA ─── */
function ClosingCTA() {
  return (
    <section className="px-6 pt-6 pb-16">
      <div className="rounded-3xl border border-muon-border bg-muon-panel p-14 text-center">
        <div className="font-muon-mono text-[10px] tracking-[0.14em] text-muon-accent mb-3">READY WHEN YOU ARE</div>
        <h2 className="text-[44px] font-black tracking-[-0.02em] leading-[1.05] text-balance max-w-[720px] mx-auto">
          Start with 200 credits.<br/>See the ledger. Cancel any time.
        </h2>
        <div className="mt-6 flex gap-3 justify-center flex-wrap">
          <Link href="/veyrnox/pricing" className="rounded-full bg-muon-accent text-muon-accent-ink px-8 py-4 text-base font-extrabold hover:bg-muon-accent-hover">
            Claim credits
          </Link>
          <Link href="/veyrnox/app" className="rounded-full border border-muon-border text-muon-fg px-8 py-4 text-base font-bold hover:border-muon-accent">
            Open the studio
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ─── Footer forest ─── */
function FooterForest() {
  return (
    <footer className="border-t border-muon-border">
      <div className="px-6 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-6">
          {MORE_FEATURES.map((col) => (
            <div key={col.group}>
              <div className="font-muon-mono text-[10px] tracking-[0.12em] text-muon-fg-faint mb-3">
                {col.group.toUpperCase()}
              </div>
              <ul className="space-y-1.5">
                {col.items.map((it) => (
                  <li key={it}>
                    <span className="text-[12.5px] text-muon-fg-body hover:text-muon-fg cursor-pointer">
                      {it}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-muon-border">
        <div className="px-6 py-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-xs text-muon-fg-muted">
          <div className="flex items-center gap-3">
            <Logo size={22} />
            <span className="font-muon-mono tracking-[0.18em] font-extrabold text-muon-fg">VEYRNOX</span>
            <span>© {new Date().getFullYear()} · UK / EU first</span>
          </div>
          <div className="flex gap-5">
            <Link href="/veyrnox/pricing" className="hover:text-muon-fg">Pricing</Link>
            <Link href="/veyrnox/presets" className="hover:text-muon-fg">Gallery</Link>
            <Link href="/veyrnox/design-system" className="hover:text-muon-fg">Design</Link>
            <Link href="/veyrnox/app/admin" className="hover:text-muon-fg">Status</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
