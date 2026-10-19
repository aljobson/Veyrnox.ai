'use client';
import { helperCopy } from '../../../../lib/i18n/helperCopy.mjs';
import { useI18n } from '../../../../components/I18nProvider';
import { localeTag } from '../../../../lib/i18n/locales.mjs';
import { pluralKey, tOr } from '../../../../lib/i18n/translate.mjs';
import { useState } from 'react';
import { Button } from '../Button';
import { FILTER_LOOKS, FILTER_CATEGORIES, searchFilterLooks, filterSelectionProblemDiagnostic as filterSelectionProblem, applyFilterLook, resetFilterGrade } from '../../_lib/editorFilters.mjs';

export function FilterPanel({ tl, selected, selection = [], disabled, apply }) {
  const { t, locale } = useI18n();
    const number = value => locale === 'en' ? String(value) : new Intl.NumberFormat(localeTag(locale)).format(value);
    const categoryLabel = value => tOr(t, `app.editor.filters.category.${value}`, value);
    const [query, setQuery] = useState(''), [category, setCategory] = useState('All');
    const [presetId, setPresetId] = useState('warm-film'), [intensity, setIntensity] = useState(100), [scope, setScope] = useState('current');
    const current = selected?.track === 'video' ? [selected] : [];
    const visuals = selection.filter(item => item.track === 'video');
    const targets = scope === 'selected' ? visuals : current;
    const problem = filterSelectionProblem(tl, targets), preset = FILTER_LOOKS.find(item => item.id === presetId);
    const matches = searchFilterLooks(query, category);
    return <section aria-label={t("app.editor.filters.catalog")} className="space-y-3">
        <h2 className="text-sm font-bold">{t("app.editor.filters.title")}</h2>
        <input aria-label={t("app.editor.filters.search")} type="search" value={query} onChange={event => setQuery(event.target.value)} className="w-full rounded-lg border border-vx-border bg-vx-base p-2 text-xs" placeholder={t("app.editor.filters.placeholder")} />
        <label className="block text-xs">{t("app.editor.filters.category")}<select aria-label={t("app.editor.filters.category")} value={category} onChange={event => setCategory(event.target.value)} className="mt-1 w-full rounded-lg border border-vx-border bg-vx-base p-2 text-xs">{FILTER_CATEGORIES.map(name => <option key={name} value={name}>{categoryLabel(name)}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-2" aria-label={t("app.editor.filters.results")}>
            {matches.map(item => <button key={item.id} type="button" aria-pressed={presetId === item.id} onClick={() => setPresetId(item.id)} className={`rounded-lg border p-2 text-start text-xs ${presetId === item.id ? 'border-vx-accent bg-vx-accent/10' : 'border-vx-border bg-vx-base'}`}><span className="block font-semibold">{item.name}</span><span className="block text-vx-fg-muted">{categoryLabel(item.category)}</span></button>)}
        </div>
        {!matches.length && <p role="status" className="text-xs text-vx-fg-muted">{t("app.editor.filters.empty")}</p>}
        <div className="space-y-2 border-t border-vx-border pt-3">
            <p className="text-xs"><strong>{preset.name}</strong> · {preset.description}</p>
            <label className="block text-xs">{t('app.editor.filters.strength', {value: number(intensity)})}<input aria-label={t("app.editor.filters.strengthLabel")} type="range" min="0" max="100" step="1" value={intensity} disabled={disabled} onChange={event => setIntensity(Number(event.target.value))} className="mt-1 w-full" /></label>
            <label className="block text-xs">{t("app.editor.filters.scope")}<select aria-label={t("app.editor.filters.scope")} value={scope} onChange={event => setScope(event.target.value)} className="mt-1 w-full rounded-lg border border-vx-border bg-vx-base p-2 text-xs"><option value="current">{t("app.editor.filters.current")}</option><option value="selected">{t(pluralKey(t, locale, 'app.editor.filters.selected', visuals.length), {count: number(visuals.length)})}</option></select></label>
            {problem && <p role="status" className="text-xs text-vx-fg-muted">{helperCopy(t, locale, problem)}</p>}
            <Button size="sm" disabled={disabled || !!problem || intensity === 0} onClick={() => apply(timeline => applyFilterLook(timeline, targets, presetId, intensity / 100))}>{t("app.editor.filters.apply")}{targets.length > 1 ? t(pluralKey(t, locale, 'app.editor.filters.multiple', targets.length), {count: number(targets.length)}) : ''}</Button>
            <Button size="sm" variant="ghost" disabled={disabled || !!problem} onClick={() => apply(timeline => resetFilterGrade(timeline, targets))}>{t("app.editor.filters.reset")}</Button>
            <p className="text-xs text-vx-fg-muted">{t("app.editor.filters.help")}</p>
        </div>
    </section>;
}
