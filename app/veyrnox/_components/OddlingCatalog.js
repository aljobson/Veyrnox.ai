'use client';
import { useI18n } from '../../../components/I18nProvider';

import { localeTag } from '../../../lib/i18n/locales.mjs';
import { pluralKey } from '../../../lib/i18n/translate.mjs';
import { useState } from 'react';
import { CATALOG_CATEGORIES, CATEGORY_FOCUS, CATEGORY_ICONS, categoryById, categoryGroups, categoryProgress, controlKind } from '../_lib/oddlingCatalog';
import { CHARACTER_GROUPS } from '../_lib/character';
import { characterOptionLabel } from '../_lib/characterOptions';
import { OddlingMannequin } from './OddlingMannequin';
import { SliderGroup, SwatchGroup, TileGroup } from './OddlingCatalogControls';


// Sims-style creator: a figure that updates as you pick, a rail of categories, and for each group a swatch, slider or tile control.
// A full-width workbench: the figure stays beside the choices on a wide screen and stacks above them on a phone. It edits the same `picks` the trait chips used to, so prompts, saved passports and the Create handoff are unchanged.
export function OddlingCatalog({ picks, onPick, onClear }) {
  const { t, locale } = useI18n();
  const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale)).format(value);
  const [categoryId, setCategoryId] = useState(CATALOG_CATEGORIES[0].id);
  const category = categoryById(categoryId);
  const groups = categoryGroups(category);
  const total = CHARACTER_GROUPS.filter((group) => picks?.[group.id]).length;
  const summaryFields = {Hair:'hair',Outfit:'wardrobe_style',Body:'body_type'};
  const summary = Object.entries(summaryFields).map(([name, field]) => [name, picks?.[field], field]);

  return (
    <section data-assistant-target="oddlings.doll-lab" aria-label={t("app.oddlings.catalog.title")} className="min-w-0 max-w-full overflow-hidden border-b border-vx-border bg-vx-base">
      <div className="mx-auto grid min-w-0 max-w-[1500px] lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
        <div className="min-w-0 border-b border-vx-border p-3 lg:sticky lg:top-16 lg:self-start lg:border-b-0 lg:border-e lg:p-6">
          <div className="grid grid-cols-[148px_minmax(0,1fr)] items-stretch gap-3 lg:grid-cols-1">
            <div className="rounded-xl border border-vx-border bg-vx-panel p-1"><OddlingMannequin picks={picks} focus={CATEGORY_FOCUS[categoryId] || 'body'} className="h-56 w-full lg:h-[28rem]" label={t("app.oddlings.catalog.preview")} /></div>
            <div className="flex min-w-0 flex-col">
              <span className="font-vx-mono text-[9px] font-bold tracking-[0.14em] text-vx-accent">{t("app.oddlings.catalog.eyebrow")}</span>
              <h2 className="mt-1 text-xl font-extrabold leading-tight">{t("app.oddlings.catalog.heading")}</h2>
              <p className="mt-1 text-xs leading-relaxed text-vx-fg-muted">{t("app.oddlings.catalog.help")}</p>
              <dl className="mt-2 space-y-1 font-vx-mono text-[9px] text-vx-fg-faint">
                {summary.map(([name, value, field]) => <div key={name} className="flex gap-2"><dt className="w-10 shrink-0 uppercase">{name}</dt><dd className="truncate text-vx-fg">{value ? characterOptionLabel(field, value) : t("app.create.character.any")}</dd></div>)}
              </dl>
              <p className="mt-auto pt-2 text-[10px] leading-snug text-vx-fg-faint">{t("app.oddlings.catalog.note")}</p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="font-vx-mono text-[10px] text-vx-fg-muted">{t(pluralKey(t, locale, 'app.oddlings.catalog.chosen', total), {count:number(total)})}</span>
                {onClear && <button type="button" onClick={onClear} disabled={!total} className="font-vx-mono text-[10px] font-bold text-vx-fg-muted underline disabled:opacity-40">{t("app.oddlings.catalog.clear")}</button>}
              </div>
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <div role="tablist" aria-label={t("app.oddlings.catalog.category")} className="flex min-w-0 max-w-full gap-1 overflow-x-auto border-b border-vx-border px-2 py-2 lg:px-4">
            {CATALOG_CATEGORIES.map((item) => {
              const on = item.id === categoryId, { picked } = categoryProgress(item, picks);
              return (
                <button key={item.id} type="button" role="tab" aria-selected={on} onClick={() => setCategoryId(item.id)} title={item.hint}
                  className={`relative flex min-w-[64px] shrink-0 flex-col items-center gap-1 rounded-lg px-2 py-2 text-[10px] font-bold lg:min-w-[84px] lg:py-3 lg:text-xs ${on ? 'bg-vx-accent/[0.1] text-vx-accent' : 'text-vx-fg-muted hover:text-vx-fg'}`}>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={CATEGORY_ICONS[item.id]} /></svg>
                  <span>{item.label}</span>
                  {picked > 0 && <span className="absolute end-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-vx-accent px-1 font-vx-mono text-[8px] font-bold text-vx-accent-ink" aria-label={t(pluralKey(t, locale, 'app.oddlings.catalog.chosen', picked), {count:number(picked)})}>{number(picked)}</span>}
                </button>
              );
            })}
          </div>

          <div role="tabpanel" aria-label={category.label} className="space-y-6 p-3 lg:p-6">
            <p className="text-[11px] text-vx-fg-faint lg:text-xs">{category.hint}</p>
            {groups.map((group) => {
              const kind = controlKind(group.id);
              if (kind === 'swatch') return <SwatchGroup key={group.id} group={group} value={picks?.[group.id]} onChange={onPick} />;
              if (kind === 'slider') return <SliderGroup key={group.id} group={group} picks={picks} onChange={onPick} />;
              return <TileGroup key={group.id} group={group} picks={picks} value={picks?.[group.id]} onChange={onPick} categoryId={categoryId} />;
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
