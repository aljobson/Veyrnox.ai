'use client';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../components/I18nProvider';

import { useState } from 'react';
import { MobileTabs } from '../_MobileNav';
import { PresetCard } from '../../_components/PresetCard';
import { TemplateRoller } from '../../_components/TemplateRoller';
import { PRESET_CATEGORIES, templatesIn } from '../../_lib/tokens';
import { useCatalog } from '../../_lib/useCatalog';

export default function MobileExplore() {
  const { t } = useI18n();
  const [cat, setCat] = useState('ALL');
  const [visibleCount, setVisibleCount] = useState(24);
  const { models } = useCatalog();
  const list = templatesIn(cat);
  const rollerPresets = list.filter((preset) => preset.clipKey).slice(0, 48);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto p-[14px_18px_16px]">
        <div className="flex justify-between items-center mb-3">
          <span className="text-[22px] font-extrabold tracking-[-0.02em]">{t('label.Explore')}</span>
          <span className="font-vx-mono text-[10px] tracking-[0.12em] text-vx-fg-muted">{t('mobile.cached')}</span>
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1 mb-3">
          {PRESET_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => { setCat(c); setVisibleCount(24); }}
              aria-pressed={cat === c}
              className={`shrink-0 font-vx-mono text-[10px] tracking-[0.12em] font-bold rounded-full px-3.5 py-1.5 border ${
                cat === c
                  ? 'bg-vx-accent text-vx-accent-ink border-transparent'
                  : 'border-vx-border text-vx-fg-muted'
              }`}
            >
              {tOr(t, `presets.cat.${c}`, c)}
            </button>
          ))}
        </div>

        <TemplateRoller presets={rollerPresets} catalog={models} className="mb-5" />

        <div className="grid grid-cols-2 gap-2.5">
          {list.slice(0, visibleCount).map((p) => <PresetCard key={p.id} preset={p} catalog={models} size="sm" />)}
        </div>
        {visibleCount < list.length && <div className="mt-5 text-center">
          <p className="mb-3 text-sm text-vx-fg-muted" aria-live="polite">{t('presets.showing', { shown: Math.min(visibleCount, list.length), total: list.length })}</p>
          <button type="button" onClick={() => setVisibleCount((count) => count + 24)} className="rounded-full border border-vx-border px-6 py-3 font-semibold hover:border-vx-accent">{t('presets.more')}</button>
        </div>}
      </div>
      <MobileTabs />
    </div>
  );
}
