'use client';
import { useState } from 'react';
import { MarketingNav } from '../_components/NavBar';
import { Chip } from '../_components/Chip';
import { PresetCard } from '../_components/PresetCard';
import { PRESETS, PRESET_CATEGORIES } from '../_lib/tokens';

// Public preset gallery — cached demos, no card, no cost.
export default function Gallery() {
  const [cat, setCat] = useState('ALL');
  const list = cat === 'ALL' ? PRESETS : PRESETS.filter((p) => p.category === cat);

  return (
    <div className="min-h-dvh">
      <MarketingNav />

      <section className="max-w-[1200px] mx-auto px-10 pt-16 pb-8">
        <Chip tone="accent" className="mb-4">EXPLORE · CURATED PRESETS</Chip>
        <h1 className="text-[48px] font-black tracking-[-0.03em] leading-[1.05]">
          One-tap looks. Exact prices.
        </h1>
        <p className="text-muon-fg-body mt-4 max-w-[620px] leading-[1.6]">
          Every preset is pinned to its best-fit model and shows its credit cost up front.
          Demos play free from cache — nothing debits until you generate.
        </p>

        <div className="mt-8 flex flex-wrap gap-2">
          {PRESET_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`font-muon-mono text-[11px] tracking-[0.12em] font-bold rounded-full px-4 py-2 border transition-colors ${
                cat === c
                  ? 'bg-muon-accent text-muon-accent-ink border-transparent'
                  : 'border-muon-border text-muon-fg-muted hover:text-muon-fg'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </section>

      <section className="max-w-[1200px] mx-auto px-10 pb-8 flex items-baseline justify-between">
        <h2 className="text-2xl font-black tracking-[-0.02em]">Trending this week</h2>
        <div className="font-muon-mono text-[10px] tracking-[0.12em] text-muon-fg-muted">
          {list.length} PRESETS · 8 MODELS · CACHED DEMOS FREE
        </div>
      </section>

      <section className="max-w-[1200px] mx-auto px-10 pb-24">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((p) => (
            <PresetCard key={p.id} preset={p} size="lg" />
          ))}
        </div>
      </section>
    </div>
  );
}
