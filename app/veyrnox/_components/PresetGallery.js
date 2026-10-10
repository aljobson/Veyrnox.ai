'use client';
import { useState } from 'react';
import { PresetCard } from './PresetCard';
import { PRESETS, PRESET_CATEGORIES, templatesIn } from '../_lib/tokens';
import { useCatalog } from '../_lib/useCatalog';
import { usePopularTemplates } from '../_lib/usePopularTemplates';

const CATEGORY_LABEL = { ALL: 'All', NEW: 'New', POPULAR: 'Popular', 'YOUR PHOTO': 'Your photo', CINEMATIC: 'Cinematic', ANIME: 'Anime', CARTOONS: 'Cartoons', MOVIES: 'Movies', FANTASY: 'Fantasy', REALISTIC: 'Realistic', FASHION: 'Fashion', PRODUCTS: 'Products', VFX: 'VFX', UGC: 'UGC', ADS: 'Ads' };

// The preset filter and grid, shared by the public /presets page and the
// studio's Explore tab so the two never drift apart.
export function PresetGallery({ size = 'lg', columns = 'lg:grid-cols-3' }) {
  const [cat, setCat] = useState('ALL');
  const { models } = useCatalog();
  const popularIds = usePopularTemplates();
  // Popular (ADR-0072) is a ranking, not a home category: it appears only once some template has enough use to rank, in rank order.
  const popular = popularIds.map((id) => PRESETS.find((preset) => preset.id === id)).filter(Boolean);
  const categories = popular.length ? ['ALL', 'NEW', 'POPULAR', ...PRESET_CATEGORIES.slice(2)] : PRESET_CATEGORIES;
  const list = cat === 'POPULAR' ? popular : templatesIn(cat);
  return (
    <>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter templates">
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCat(c)}
            aria-pressed={cat === c}
            className="vx-press rounded-full border px-4 py-2 text-[14px] font-semibold border-vx-border text-vx-fg-body hover:border-vx-fg-muted aria-pressed:border-vx-fg aria-pressed:bg-vx-fg aria-pressed:text-vx-base"
          >
            {CATEGORY_LABEL[c] || c}
          </button>
        ))}
      </div>
      <p className="mt-8 mb-6 text-[14px] text-vx-fg-muted" aria-live="polite">
        {list.length} {list.length === 1 ? 'template' : 'templates'} on {new Set(list.map((p) => p.model)).size} models
      </p>
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${columns} gap-x-6 gap-y-10`}>
        {list.map((p) => (
          <PresetCard key={p.id} preset={p} catalog={models} size={size} />
        ))}
      </div>
    </>
  );
}
