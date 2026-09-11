import Link from 'next/link';
import { Logo } from './_components/Logo';
import { Chip } from './_components/Chip';
import {
  NAV_CATEGORIES,
  FEATURE_CARDS,
  WORKFLOW_STRIPS,
  HERO_STATS,
  METRIC_STRIP,
  MODEL_SHELF,
  MORE_FEATURES,
  HERO_CHIP,
  FOOTER_TAGLINE,
  FOOTER_STAMP,
} from './_lib/tokens';

// Landing — credit-metered AI image and video generation.
// EU-hosted, C2PA-signed. The button is the price tag.
export default function VeyrnoxLanding() {
  return (
    <div className="min-h-dvh">
      <WideNav />
      <Hero />
      <FourSurfaces />
      <ShippingSection />
      <MetricStrip />
      <ModelShelf />
      <ClosingCTA />
      <FooterForest />
    </div>
  );
}

/* ─── Wide nav ─── */
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
          <button className="text-vx-fg-body text-sm font-semibold px-3 py-2 hover:text-vx-fg">Log in</button>
          <Link
            href="/veyrnox/app"
            className="rounded-full bg-vx-accent text-vx-accent-ink text-sm font-bold px-5 py-2.5 hover:bg-vx-accent-hover"
          >
            Sign up
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ─── Hero ─── */
function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 opacity-40 pointer-events-none"
        style={{
          background:
            'radial-gradient(60% 55% at 50% 20%, rgba(62,230,196,0.14), transparent 65%),' +
            'radial-gradient(45% 40% at 15% 80%, rgba(228,169,60,0.12), transparent 65%)',
        }}
      />
      <div className="relative max-w-[1100px] mx-auto px-8 pt-24 pb-20 flex flex-col items-center text-center gap-6">
        <Chip tone="accent" noGlyph>
          <span aria-hidden="true" className="mr-1 text-vx-accent">●</span>
          {HERO_CHIP}
        </Chip>

        <h1 className="text-[64px] md:text-[80px] font-black leading-[0.98] tracking-[-0.035em] text-balance max-w-[900px]">
          One prompt in.<br />
          Endless creations out.<br />
          <span className="text-vx-accent">Priced on the button.</span>
        </h1>

        <p className="text-lg text-vx-fg-body max-w-[640px] leading-[1.6]">
          Credit-metered AI image and video. See the exact cost before you press generate —
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

        <div className="mt-10 grid grid-cols-3 gap-8 max-w-[720px] w-full">
          {HERO_STATS.map((s) => (
            <div key={s.label} className="text-center">
              <div className="font-vx-mono text-[26px] font-bold text-vx-accent vx-num">{s.value}</div>
              <div className="mt-1 text-xs text-vx-fg-muted">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─── Four surfaces ─── */
function FourSurfaces() {
  return (
    <section id="studio" className="px-8 pt-12 pb-4 max-w-[1300px] mx-auto">
      <div className="max-w-[720px]">
        <div className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-accent mb-2">FOUR SURFACES. ONE CREATOR STACK.</div>
        <h2 className="text-[36px] md:text-[44px] font-black leading-[1.05] tracking-[-0.03em]">
          Every layer talks to the next.
        </h2>
        <p className="mt-3 text-vx-fg-body leading-[1.6]">
          Studio names the price, Models keep it honest, EU + C2PA prove it. One balance across the whole catalog — every cost visible before you spend.
        </p>
      </div>

      <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {FEATURE_CARDS.map((f) => (
          <div
            key={f.key}
            className="group rounded-2xl border border-vx-border bg-vx-panel overflow-hidden transition-transform duration-200 ease-out hover:scale-[1.015] focus-within:scale-[1.015]"
          >
            <div className="aspect-[4/5] relative" style={{ background: f.bg }}>
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-5">
                <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-body/90">{f.kicker}</div>
                <div className="mt-1 font-black text-xl leading-tight text-balance">{f.title}</div>
                <div className="mt-2 text-[13px] text-vx-fg-body/90 leading-snug">{f.body}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── Shipping section ─── */
function ShippingSection() {
  return (
    <section id="studio" className="px-8 pt-20 pb-8 max-w-[1300px] mx-auto">
      <div className="max-w-[720px]">
        <h2 className="text-[36px] md:text-[44px] font-black leading-[1.05] tracking-[-0.03em]">
          Made for shipping, not fiddling.
        </h2>
        <p className="mt-3 text-vx-fg-body leading-[1.6]">
          Two workflows cover 90% of creator work. The rest is one prompt away.
        </p>
      </div>

      <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {WORKFLOW_STRIPS.map((s, i) => (
          <div
            key={s.kicker}
            className="rounded-3xl border border-vx-border bg-vx-panel overflow-hidden grid grid-rows-[1fr_auto]"
          >
            <div className="min-h-[240px] relative" style={{ background: s.bg }}>
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
            </div>
            <div className="p-6 md:p-8">
              <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-accent">{s.kicker}</div>
              <h3 className="mt-2 text-[24px] font-black leading-tight tracking-[-0.02em]">{s.title}</h3>
              <p className="mt-2 text-[14px] text-vx-fg-body leading-[1.6]">{s.body}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── Metric strip ─── */
function MetricStrip() {
  return (
    <section id="honesty" className="max-w-[1300px] mx-auto px-8 pt-16 pb-12">
      <div className="rounded-3xl border border-vx-border bg-vx-panel grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-vx-border/60">
        {METRIC_STRIP.map((m) => (
          <div key={m.label} className="p-6 md:p-8 text-center">
            <div className="font-vx-mono text-[36px] md:text-[44px] font-bold text-vx-accent vx-num leading-none">{m.value}</div>
            <div className="mt-3 font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">{m.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── Model shelf ─── */
function ModelShelf() {
  return (
    <section id="models" className="max-w-[1300px] mx-auto px-8 pt-6 pb-16">
      <div className="flex items-baseline justify-between mb-6 flex-wrap gap-2">
        <h2 className="text-[28px] md:text-[36px] font-black tracking-[-0.02em]">The model shelf.</h2>
        <Link href="/veyrnox/pricing" className="text-sm font-semibold text-vx-fg-muted hover:text-vx-fg">
          Full catalog →
        </Link>
      </div>
      <div className="flex flex-wrap gap-2">
        {MODEL_SHELF.map((name) => (
          <span
            key={name}
            className="inline-flex items-center rounded-full border border-vx-border bg-vx-panel px-4 py-2 text-[13px] font-semibold text-vx-fg"
          >
            {name}
          </span>
        ))}
      </div>
    </section>
  );
}

/* ─── Closing CTA ─── */
function ClosingCTA() {
  return (
    <section className="px-8 pt-6 pb-16 max-w-[1300px] mx-auto">
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
            Start creating
          </Link>
          <Link href="/veyrnox/pricing" className="rounded-full border border-vx-border text-vx-fg px-8 py-4 text-base font-bold hover:border-vx-accent">
            See pricing
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ─── Footer forest ─── */
function FooterForest() {
  return (
    <footer id="community" className="border-t border-vx-border">
      <div className="max-w-[1300px] mx-auto px-8 py-14">
        <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_repeat(4,1fr)] gap-10">
          <div>
            <Logo size={28} wordmark />
            <p className="mt-4 text-sm text-vx-fg-body max-w-[300px] leading-[1.6]">
              {FOOTER_TAGLINE}
            </p>
          </div>
          {MORE_FEATURES.map((col) => (
            <div key={col.group}>
              <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted mb-3">
                {col.group.toUpperCase()}
              </div>
              <ul className="space-y-2">
                {col.items.map((it) => (
                  <li key={it}>
                    <span className="text-[13px] text-vx-fg-body hover:text-vx-fg cursor-pointer">
                      {it}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-vx-border">
        <div className="max-w-[1300px] mx-auto px-8 py-6 text-xs text-vx-fg-muted flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
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
