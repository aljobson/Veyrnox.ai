'use client';
import { useState } from 'react';
import { PresetCard } from './PresetCard';
import { TemplateRoller } from './TemplateRoller';
import { PRESETS, PRESET_CATEGORIES, searchTemplates, templatesIn } from '../_lib/tokens';
import { useCatalog } from '../_lib/useCatalog';
import { usePopularTemplates } from '../_lib/usePopularTemplates';
import { useI18n } from '../../../components/I18nProvider';
import { rankByTaste } from '../../../lib/creatorWords.js';

const TEMPLATE_BATCH_SIZE = 50;

// The preset filter and grid, shared by the public /presets page and the
// studio's Explore tab so the two never drift apart.
// `taste` is the person's vibe check answers (ADR-0251), or null: templates that fit come first and nothing else changes.
export function PresetGallery({ size = 'lg', columns = 'lg:columns-3', taste = null }) {
  const { t } = useI18n();
  const [cat, setCat] = useState('ALL');
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(TEMPLATE_BATCH_SIZE);
  const { models } = useCatalog();
  const popularIds = usePopularTemplates();
  // Popular (ADR-0072) is a ranking, not a home category: it appears only once some template has enough use to rank, in rank order.
  const popular = popularIds.map((id) => PRESETS.find((preset) => preset.id === id)).filter(Boolean);
  const categories = popular.length ? ['ALL', 'NEW', 'POPULAR', ...PRESET_CATEGORIES.slice(2)] : PRESET_CATEGORIES;
  const list = cat === 'POPULAR' ? popular : templatesIn(cat);
  const matches = searchTemplates(list, query);
  const ordered = rankByTaste(matches, taste, (p) => `${p.name} ${p.category} ${p.prompt}`);
  // The roller is for instantly playable previews. Recipes without preview
  // media still appear in the complete searchable grid below it.
  const rollerPresets = ordered.filter((preset) => preset.clipKey).slice(0, 48);
  const modelCount = new Set(matches.map((preset) => preset.model)).size;
  return (
    <>
      <label className="block max-w-xl">
        <span className="text-[15px] font-bold tracking-tight">{t('presets.search.label')}</span>
        <input
          type="search"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setVisibleCount(TEMPLATE_BATCH_SIZE); }}
          placeholder={t('presets.search.placeholder')}
          className="mt-3 w-full rounded-xl border border-vx-border bg-vx-panel px-4 py-3 text-[16px] text-vx-fg outline-none placeholder:text-vx-fg-muted focus:border-vx-accent focus:ring-2 focus:ring-vx-accent/30"
        />
      </label>
      <h2 className="mt-7 mb-3 text-[15px] font-bold tracking-tight">{t('presets.categories.title')}</h2>
      {/* One scrolling row below sm (thirteen chips wrapped to four rows on a
          phone); it wraps again from sm. The vertical padding keeps a chip's
          focus ring inside the scroller. */}
      <div className="-mx-4 -my-1.5 flex gap-2 overflow-x-auto px-4 py-1.5 sm:mx-0 sm:my-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:py-0" role="group" aria-label={t('presets.filter')}>
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => { setCat(c); setVisibleCount(TEMPLATE_BATCH_SIZE); }}
            aria-pressed={cat === c}
            className="vx-press shrink-0 whitespace-nowrap rounded-full border px-4 py-2 text-[14px] font-semibold border-vx-border text-vx-fg-body hover:border-vx-fg-muted aria-pressed:border-vx-fg aria-pressed:bg-vx-fg aria-pressed:text-vx-base"
          >
            {t.messages[`presets.cat.${c}`] ?? c}
          </button>
        ))}
      </div>
      <p className="mt-8 mb-6 text-[14px] text-vx-fg-muted" aria-live="polite">
        {t('presets.count', {
          templates: t(matches.length === 1 ? 'presets.templates.one' : 'presets.templates.other', { n: matches.length }),
          models: t(modelCount === 1 ? 'presets.models.one' : 'presets.models.other', { n: modelCount }),
        })}
      </p>
      <TemplateRoller presets={rollerPresets} catalog={models} className="mb-10" />
      <div id="preset-gallery-results" className={`columns-1 sm:columns-2 ${columns} gap-6 [&>a]:mb-10 [&>a]:break-inside-avoid`}>
        {ordered.slice(0, visibleCount).map((p) => (
          <PresetCard key={p.id} preset={p} catalog={models} size={size} />
        ))}
      </div>
      {visibleCount < matches.length && <div className="mt-4 text-center">
        <p className="mb-3 text-sm text-vx-fg-muted" aria-live="polite">{t('presets.showing', { shown: Math.min(visibleCount, matches.length), total: matches.length })}</p>
        <button type="button" aria-controls="preset-gallery-results" onClick={() => setVisibleCount((count) => count + TEMPLATE_BATCH_SIZE)} className="rounded-full border border-vx-border px-6 py-3 font-semibold hover:border-vx-accent">{t('presets.more')}</button>
      </div>}
    </>
  );
}
