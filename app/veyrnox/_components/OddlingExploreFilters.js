'use client';
import { useI18n } from '../../../components/I18nProvider';
import { localeTag } from '../../../lib/i18n/locales.mjs';


import { chip } from './oddlingStyles';
import { ODDLING_EXPLORE_TABS, ODDLING_KIND_FILTERS, exploreKindCounts } from '../_lib/oddlingExplore';

// The themed collections are tabs; Human / Other beings narrow whichever one is open.
export function OddlingExploreFilters({ source, kind, onSource, onKind }) {
  const { t, locale } = useI18n();
  const counts = exploreKindCounts(source);
  return (
    <>
      <div className="mt-8 flex flex-wrap gap-2" role="tablist" aria-label={t("app.oddlings.explore.source")}>
        {ODDLING_EXPLORE_TABS.map(({ id, label }) => <button key={id} type="button" role="tab" aria-selected={source === id} onClick={() => onSource(id)} className={chip(source === id)}>{label}</button>)}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={t("app.oddlings.explore.showLabel")}>
        <span className="font-vx-mono text-[9px] font-bold tracking-[0.12em] text-vx-fg-faint">{t("app.oddlings.explore.show")}</span>
        {ODDLING_KIND_FILTERS.map(({ id }) => (
          <button key={id} type="button" aria-pressed={kind === id} disabled={!counts[id]} onClick={() => onKind(id)} className={`${chip(kind === id)} disabled:cursor-not-allowed disabled:opacity-40`}>
            {id === 'human' ? t('app.oddlings.explore.human') : t('oddlings.group.creature')} · {locale === 'en' ? counts[id] : counts[id].toLocaleString(localeTag(locale))}
          </button>
        ))}
      </div>
    </>
  );
}
