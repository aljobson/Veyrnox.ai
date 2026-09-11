'use client';
import { useState } from 'react';
import Link from 'next/link';
import { MarketingNav } from '../_components/NavBar';
import { Chip } from '../_components/Chip';
import { PLANS, ANNUAL_PLUS, MODELS } from '../_lib/tokens';

export default function Pricing() {
  const [annual, setAnnual] = useState(false);

  return (
    <div className="min-h-dvh">
      <MarketingNav />

      <section className="max-w-[1100px] mx-auto px-10 pt-24 pb-10 text-center">
        <Chip tone="accent" className="mb-6">CREDITS · NOT TOKENS</Chip>
        <h1 className="text-[56px] font-black tracking-[-0.03em] leading-[1.05] text-balance max-w-[820px] mx-auto">
          One balance. Every model. No add-ons.
        </h1>
        <p className="text-muon-fg-body mt-5 max-w-[560px] mx-auto leading-[1.65]">
          Pick a plan; credits refresh monthly. Failed jobs refund automatically.
          Ultra unlocks 4K and the premium tier. Cancel any time.
        </p>

        <div className="mt-8 inline-flex items-center gap-1 border border-muon-border rounded-full p-1">
          <button
            onClick={() => setAnnual(false)}
            className={`px-4 py-2 text-xs font-bold rounded-full ${!annual ? 'bg-muon-panel text-muon-fg' : 'text-muon-fg-muted'}`}
          >
            Monthly
          </button>
          <button
            onClick={() => setAnnual(true)}
            className={`px-4 py-2 text-xs font-bold rounded-full flex items-center gap-2 ${annual ? 'bg-muon-panel text-muon-fg' : 'text-muon-fg-muted'}`}
          >
            Annual
            <span className="font-muon-mono text-[9.5px] tracking-[0.1em] text-muon-money">−2 MONTHS</span>
          </button>
        </div>
      </section>

      {/* ============ PLAN CARDS ============ */}
      <section className="max-w-[1100px] mx-auto px-10 pb-20 grid grid-cols-1 md:grid-cols-3 gap-4">
        {PLANS.map((p) => {
          const shownPrice = annual && p.id === 'plus' ? ANNUAL_PLUS.price : p.price;
          const suffix = annual && p.id === 'plus' ? '' : '/mo';
          return (
            <div
              key={p.id}
              className={`relative rounded-2xl border p-6 flex flex-col ${
                p.hot ? 'border-muon-money bg-muon-panel' : 'border-muon-border bg-muon-panel'
              }`}
            >
              {p.hot && (
                <span className="absolute -top-3 right-5">
                  <Chip tone="solid">MOST PICKED</Chip>
                </span>
              )}
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-black">{p.name}</span>
                <span className="font-muon-mono text-lg font-bold muon-num">{shownPrice}<span className="text-muon-fg-muted text-xs font-semibold">{suffix}</span></span>
              </div>
              <div className="font-muon-mono text-sm text-muon-money font-bold mt-2 muon-num">{p.creditsFmt} / month</div>
              <div className="text-xs text-muon-fg-muted mt-1">{p.note}</div>

              <ul className="mt-6 space-y-2.5 text-[13px] text-muon-fg-body">
                <li className="flex gap-2"><span className="text-muon-accent">✓</span> One balance across all 10 models</li>
                <li className="flex gap-2"><span className="text-muon-accent">✓</span> Failed jobs refund automatically</li>
                <li className="flex gap-2"><span className="text-muon-accent">✓</span> Preset library + prompt saves</li>
                {p.id !== 'starter' && (
                  <li className="flex gap-2"><span className="text-muon-accent">✓</span> Premium models (Veo 3.1)</li>
                )}
                {p.id === 'ultra' && (
                  <li className="flex gap-2"><span className="text-muon-accent">✓</span> 4K exports · priority queue</li>
                )}
              </ul>

              <button
                className={`mt-6 rounded-full py-3 text-sm font-extrabold transition-colors ${
                  p.hot
                    ? 'bg-muon-money text-muon-money-ink hover:brightness-110'
                    : 'bg-muon-accent text-muon-accent-ink hover:bg-muon-accent-hover'
                }`}
              >
                Start {p.name}
              </button>
            </div>
          );
        })}
      </section>

      {/* ============ COST TABLE ============ */}
      <section className="max-w-[1100px] mx-auto px-10 pb-20">
        <div className="flex items-end justify-between mb-4">
          <h2 className="text-2xl font-black tracking-[-0.02em]">Per-generation cost, by model</h2>
          <div className="font-muon-mono text-[10px] tracking-[0.12em] text-muon-fg-muted">10s VIDEO = 2× CREDITS</div>
        </div>
        <div className="rounded-2xl border border-muon-border bg-muon-panel overflow-hidden">
          <div className="grid grid-cols-[1fr_120px_120px_1fr] px-5 py-3 border-b border-muon-border font-muon-mono text-[10px] tracking-[0.12em] text-muon-fg-muted">
            <div>MODEL</div>
            <div className="text-right">5s CLIP</div>
            <div className="text-right">10s CLIP</div>
            <div className="text-right">NOTES</div>
          </div>
          {MODELS.map((m) => (
            <div key={m.id} className="grid grid-cols-[1fr_120px_120px_1fr] px-5 py-3 border-b border-muon-border/60 last:border-b-0 items-center">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold">{m.name}</span>
                {m.premium && <span className="font-muon-mono text-[9px] tracking-[0.1em] text-muon-money">◆ PREMIUM</span>}
                {m.tag && !m.premium && (
                  <span className="font-muon-mono text-[9px] tracking-[0.1em] text-muon-fg-muted">{m.tag}</span>
                )}
              </div>
              <div className="text-right font-muon-mono text-sm font-bold text-muon-money muon-num">{m.credits} cr</div>
              <div className="text-right font-muon-mono text-sm font-bold text-muon-money muon-num">
                {m.kind === 'video' ? `${m.credits * 2} cr` : '—'}
              </div>
              <div className="text-right text-xs text-muon-fg-muted uppercase tracking-wider">{m.kind}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-muon-border">
        <div className="max-w-[900px] mx-auto px-10 py-14 text-center">
          <div className="text-3xl font-black tracking-[-0.02em]">Questions before you commit?</div>
          <div className="text-muon-fg-muted mt-2">Free preset gallery, no card — see the models live.</div>
          <Link
            href="/muon/presets"
            className="inline-block mt-6 rounded-full bg-muon-accent text-muon-accent-ink px-6 py-3 text-sm font-extrabold hover:bg-muon-accent-hover"
          >
            Browse the gallery
          </Link>
        </div>
      </section>
    </div>
  );
}
