import Link from 'next/link';
import { MediaTile } from '../_components/MediaTile';
import { SHOWCASE_CLIPS } from '../_lib/showcase';
import {
  NAV_CATEGORIES,
  FEATURE_CARDS,
  PRODUCT_TILES,
  EFFECT_PRESETS,
  MORE_FEATURES,
  METRIC_STRIP,
  PILLARS,
  FAQ,
  PROMO_STRIP,
  FOOTER_TAGLINE,
  footerStamp,
  SITE_UPDATED,
  SUPPORT_EMAIL,
  MODELS as MODELS_FALLBACK,
  kindOf,
  shelfName,
} from '../_lib/tokens';

export function ProductTilesRow({ modelCount, catalog }) {
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
        <h2 className="text-2xl sm:text-3xl font-black tracking-[-0.02em]">{modelCount} models on the shelf.</h2>
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

export function HeroStatement() {
  return (
    <section id="honesty" className="px-4 sm:px-6 pt-20 pb-6 max-w-[1400px] mx-auto">
      <div className="max-w-[900px]">
        <h2 className="text-[40px] sm:text-[54px] md:text-[72px] font-black leading-[0.98] tracking-[-0.035em] text-balance">
          EVERY GENERATION<br/>
          SHOWS ITS PRICE<br/>
          <span className="text-vx-money">BEFORE YOU SPEND.</span>
        </h2>
        <p className="mt-6 text-[16px] text-vx-fg-body leading-[1.6] max-w-[540px]">
          The button is the price tag. Failed jobs refund automatically.
          One balance across every model, with the math visible.
        </p>
        <Link
          href="#shelf"
          className="mt-6 inline-block font-vx-mono text-[11px] tracking-[0.12em] text-vx-accent hover:text-vx-fg"
        >
          SEE EVERY MODEL AND ITS PRICE →
        </Link>
      </div>
    </section>
  );
}

/* ─── Effects preset wall ─── */

export function EffectsWall() {
  return (
    <section className="px-4 sm:px-6 pt-20 pb-8 max-w-[1400px] mx-auto">
      <div className="flex items-baseline justify-between mb-6 flex-wrap gap-2">
        <h2 className="text-2xl sm:text-3xl font-black tracking-[-0.02em]">Big-budget effects. Priced on tap.</h2>
        <Link href="/presets" className="text-sm font-semibold text-vx-fg-muted hover:text-vx-fg">
          Browse all →
        </Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {EFFECT_PRESETS.map((e) => (
          <MediaTile
            key={e.name}
            href="/presets"
            clip={SHOWCASE_CLIPS[e.name]}
            className="block rounded-2xl overflow-hidden border border-vx-border"
            mediaClassName="aspect-square"
            mediaStyle={{ background: e.bg }}
          >
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent opacity-90 group-hover:opacity-100" />
            <div className="absolute inset-x-0 bottom-0 p-3 text-left">
              <div className="font-black text-white text-sm tracking-tight">{e.name}</div>
              <div className="mt-1 font-vx-mono text-[9.5px] tracking-[0.1em] text-vx-accent">RECREATE →</div>
            </div>
          </MediaTile>
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

export function ModelShelf({ catalog }) {
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
            {total} LIVE MODELS
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

      <p className="mt-6 text-[13px] text-vx-fg-muted">
        Prices are read from the live catalog. Failed generations refund.
      </p>
    </section>
  );
}

/* ─── Why Veyrnox — 4 pillars ─── */
