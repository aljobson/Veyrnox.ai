'use client';
import { useState } from 'react';
import { AppNav } from '../_components/NavBar';
import { Chip } from '../_components/Chip';
import { PresetCard } from '../_components/PresetCard';
import { PRESETS, PRESET_CATEGORIES } from '../_lib/tokens';

export default function Explore() {
  const [cat, setCat] = useState('ALL');
  const list = cat === 'ALL' ? PRESETS : PRESETS.filter((p) => p.category === cat);

  return (
    <div className="min-h-dvh">
      {/* No balance prop: AppNav reads the signed-in balance itself. This
          used to pass a hardcoded 823, so the pill showed a number that
          belonged to nobody. */}
      <AppNav active="explore" />

      <section className="max-w-[1400px] mx-auto px-8 pt-10 pb-4">
        <Chip tone="accent" className="mb-3">EXPLORE · CURATED PRESETS</Chip>
        <h1 className="text-[44px] font-black tracking-[-0.03em] leading-[1.05]">
          One-tap looks. Exact prices.
        </h1>
        <p className="text-vx-fg-body mt-3 max-w-[640px] leading-[1.6]">
          Every preset is pinned to its best-fit model and shows its credit cost up front.
          Demos play free from cache — nothing debits until you generate.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {PRESET_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`font-vx-mono text-[11px] tracking-[0.12em] font-bold rounded-full px-4 py-2 border ${
                cat === c
                  ? 'bg-vx-accent text-vx-accent-ink border-transparent'
                  : 'border-vx-border text-vx-fg-muted hover:text-vx-fg'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </section>

      <section className="max-w-[1400px] mx-auto px-8 pt-4 pb-4 flex items-baseline justify-between">
        <h2 className="text-xl font-black tracking-[-0.02em]">Trending this week</h2>
        <div className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">
          {list.length} PRESETS · 10 MODELS · CACHED DEMOS FREE
        </div>
      </section>

      <section className="max-w-[1400px] mx-auto px-8 pb-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {list.map((p) => <PresetCard key={p.id} preset={p} size="md" />)}
        </div>
      </section>
    </div>
  );
}
