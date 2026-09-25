import Link from 'next/link';
import {
  Logo } from '../_components/Logo';
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
  shelfName,
} from '../_lib/tokens';

export function WhyVeyrnox() {
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

export function FeatureStripsSection() {
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

export function FeatureStrip({ kicker, title, body, cta, bg, reverse = false }) {
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

export function FAQBlock() {
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

export function ClosingCTA({ modelCount }) {
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
          10 credits on the house when you join. One balance across every model. Failed jobs refund automatically.
        </p>
        <div className="mt-6 flex gap-3 justify-center flex-wrap">
          <Link href="/app?auth=sign_up" className="rounded-full bg-vx-accent text-vx-accent-ink px-8 py-4 text-base font-extrabold hover:bg-vx-accent-hover">
            Claim 10 credits
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

export function MetricStripBlock({ modelCount }) {
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

export function FooterForest({ catalog }) {
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
            <Link href="/legal/aup" className="transition-colors hover:text-vx-fg">Acceptable Use</Link>
            <Link href="/design-system" className="transition-colors hover:text-vx-fg">Design</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

// mailto: and other external schemes go through a plain anchor — next/link
// is for routes it can prefetch.

export function FooterLink({ href, children }) {
  const cls = 'text-[13px] text-vx-fg-body transition-colors hover:text-vx-fg underline-offset-4 hover:underline';
  if (!href) return <span className="text-[13px] text-vx-fg-muted">{children}</span>;
  if (/^[a-z]+:/i.test(href)) {
    return <a href={href} className={cls}>{children}</a>;
  }
  return <Link href={href} className={cls}>{children}</Link>;
}

export function formatUpdated(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
