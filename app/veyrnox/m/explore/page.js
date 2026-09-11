'use client';
import { useState } from 'react';
import { MobileTabs } from '../_MobileNav';
import { PresetCard } from '../../_components/PresetCard';
import { PRESETS, PRESET_CATEGORIES } from '../../_lib/tokens';

export default function MobileExplore() {
  const [cat, setCat] = useState('ALL');
  const list = cat === 'ALL' ? PRESETS : PRESETS.filter((p) => p.category === cat);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto p-[14px_18px_16px]">
        <div className="flex justify-between items-center mb-3">
          <span className="text-[22px] font-extrabold tracking-[-0.02em]">Explore</span>
          <span className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">CACHED FREE</span>
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1 mb-3">
          {PRESET_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`shrink-0 font-vx-mono text-[10px] tracking-[0.12em] font-bold rounded-full px-3.5 py-1.5 border ${
                cat === c
                  ? 'bg-vx-accent text-vx-accent-ink border-transparent'
                  : 'border-vx-border text-vx-fg-muted'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {list.map((p) => <PresetCard key={p.id} preset={p} size="sm" />)}
        </div>
      </div>
      <MobileTabs />
    </div>
  );
}
