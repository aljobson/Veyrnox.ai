import Link from 'next/link';
import { MarketingNav } from './_components/NavBar';
import { Chip } from './_components/Chip';
import { PresetCard } from './_components/PresetCard';
import { MODELS, PRESETS } from './_lib/tokens';

const WALL = Array.from({ length: 18 }, (_, i) => {
  const hues = [180, 40, 300, 12, 200, 90];
  const h = hues[i % hues.length];
  return {
    bg: `linear-gradient(${(i * 37) % 360}deg, hsl(${h} 40% 12%), hsl(${h} 45% 30%), hsl(${h} 55% 55%))`,
    dur: 12 + (i % 5) * 3,
    h: 160 + (i % 3) * 60,
    mt: (i % 4) * 20,
  };
});

const PILLARS = [
  { badge: '−15 cr',    title: 'The button is the price tag',   body: 'Every generate button shows the exact debit before you press it. No surprise bills, no hidden multipliers.' },
  { badge: '+15 cr',    title: 'Failed jobs refund automatically', body: 'Moderation reject, model error, timeout — credits return to your balance the moment we know. Always.' },
  { badge: '10 models', title: 'One balance across every model',   body: 'Wan, Veo, Kling, Seedance, Nano Banana — pick by cost or capability. Never buy a model-specific credit again.' },
];

export default function MuonLanding() {
  return (
    <div className="min-h-dvh">
      <MarketingNav />

      {/* ================= HERO ================= */}
      <section className="relative overflow-hidden">
        <div
          className="absolute -inset-10 grid grid-cols-6 gap-2.5 opacity-55"
          style={{ transform: 'rotate(-4deg) scale(1.12)' }}
          aria-hidden
        >
          {WALL.map((w, i) => (
            <div
              key={i}
              className="rounded-xl"
              style={{
                background: w.bg,
                backgroundSize: '220% 220%',
                animation: `muonDrift ${w.dur}s ease-in-out infinite`,
                height: w.h,
                marginTop: w.mt,
              }}
            />
          ))}
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-muon-base/70 via-muon-base/85 to-muon-base pointer-events-none" />

        <div className="relative max-w-[980px] mx-auto px-10 pt-32 pb-24 flex flex-col items-center text-center gap-6">
          <Chip tone="accent">AI VIDEO · IMAGE · 10 MODELS · ONE BALANCE</Chip>
          <h1 className="text-[64px] md:text-[72px] font-black leading-[1.02] tracking-[-0.035em] text-balance max-w-[860px]">
            Every generation shows its price before you spend.
          </h1>
          <p className="text-lg text-muon-fg-body max-w-[600px] leading-[1.6]">
            Muon is a credit-metered studio for short-form creators. Pick a look, see the exact cost on the button, generate. Failed jobs refund automatically — always.
          </p>
          <div className="flex gap-3 mt-2 flex-wrap justify-center">
            <button className="flex items-center gap-3 bg-muon-accent text-muon-accent-ink rounded-full px-8 py-4 text-base font-extrabold hover:bg-muon-accent-hover transition-colors">
              <span>Join the waitlist</span>
              <span className="font-muon-mono text-[13px]">→</span>
            </button>
            <Link
              href="/muon/presets"
              className="bg-transparent text-muon-fg border border-muon-border rounded-full px-8 py-4 text-base font-bold hover:border-muon-accent transition-colors"
            >
              Browse presets free
            </Link>
          </div>
          <div className="font-muon-mono text-[10px] tracking-[0.12em] text-muon-fg-faint mt-1">
            NO CARD TO BROWSE · DEMOS PLAY FROM CACHE
          </div>
        </div>
      </section>

      {/* ================= MODEL STRIP ================= */}
      <section className="border-y border-muon-border px-10 py-6 flex items-center gap-4 overflow-hidden">
        <span className="font-muon-mono text-[10px] tracking-[0.14em] text-muon-fg-muted shrink-0">
          MODELS · PRICE PER CLIP
        </span>
        <div className="flex gap-2 flex-wrap">
          {MODELS.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-2 border border-muon-border rounded-full px-3.5 py-1.5 whitespace-nowrap"
            >
              <span className="text-[12.5px] font-bold">{m.name}</span>
              {m.premium && <span className="font-muon-mono text-[8.5px] tracking-[0.1em] text-muon-money">◆</span>}
              <span className="font-muon-mono text-[11px] font-bold text-muon-money muon-num">{m.credits} cr</span>
            </div>
          ))}
        </div>
      </section>

      {/* ================= PILLARS ================= */}
      <section className="max-w-[1100px] mx-auto px-10 pt-20 pb-8 grid grid-cols-1 md:grid-cols-3 gap-5">
        {PILLARS.map((p) => (
          <div key={p.title} className="bg-muon-panel border border-muon-border rounded-2xl p-6">
            <div className="font-muon-mono text-[22px] font-bold text-muon-money muon-num">{p.badge}</div>
            <div className="text-[17px] font-bold mt-3">{p.title}</div>
            <div className="text-[13.5px] text-muon-fg-body mt-2 leading-[1.6]">{p.body}</div>
          </div>
        ))}
      </section>

      {/* ================= PRESET WALL PREVIEW ================= */}
      <section className="max-w-[1200px] mx-auto px-10 pt-16 pb-20">
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="font-muon-mono text-[11px] tracking-[0.14em] text-muon-accent mb-2">CURATED PRESETS</div>
            <h2 className="text-[36px] font-black tracking-[-0.02em]">One-tap looks. Exact prices.</h2>
          </div>
          <Link href="/muon/presets" className="text-sm font-semibold text-muon-fg-muted hover:text-muon-fg">
            See all →
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {PRESETS.slice(0, 6).map((p) => (
            <PresetCard key={p.id} preset={p} size="md" />
          ))}
        </div>
      </section>

      {/* ================= CLOSING RIBBON ================= */}
      <section className="border-t border-muon-border">
        <div className="max-w-[1100px] mx-auto px-10 py-14 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <div className="text-[26px] font-black tracking-[-0.02em]">Start with 200 credits. Cancel any time.</div>
            <div className="text-sm text-muon-fg-muted mt-1">No card to browse. Failed jobs always refund.</div>
          </div>
          <div className="flex gap-3">
            <Link
              href="/muon/pricing"
              className="rounded-full bg-muon-accent text-muon-accent-ink px-6 py-3 text-sm font-extrabold hover:bg-muon-accent-hover"
            >
              See pricing
            </Link>
            <Link
              href="/muon/app"
              className="rounded-full border border-muon-border text-muon-fg px-6 py-3 text-sm font-bold hover:border-muon-accent"
            >
              Open the studio
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-muon-border">
      <div className="max-w-[1200px] mx-auto px-10 py-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-6 text-xs text-muon-fg-muted">
        <div className="flex items-center gap-3">
          <span className="font-muon-mono tracking-[0.18em] font-extrabold text-muon-fg">MUON</span>
          <span>© {new Date().getFullYear()} · UK / EU first</span>
        </div>
        <div className="flex gap-6">
          <Link href="/muon/pricing" className="hover:text-muon-fg">Pricing</Link>
          <Link href="/muon/presets" className="hover:text-muon-fg">Gallery</Link>
          <Link href="/muon/design-system" className="hover:text-muon-fg">Design system</Link>
        </div>
      </div>
    </footer>
  );
}
