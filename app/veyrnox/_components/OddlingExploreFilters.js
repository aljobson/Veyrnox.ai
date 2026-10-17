'use client';

import { chip } from './oddlingStyles';
import { ODDLING_EXPLORE_TABS, ODDLING_KIND_FILTERS, exploreKindCounts } from '../_lib/oddlingExplore';

// The themed collections are tabs; Human / Other beings narrow whichever one is open.
export function OddlingExploreFilters({ source, kind, onSource, onKind }) {
  const counts = exploreKindCounts(source);
  return (
    <>
      <div className="mt-8 flex flex-wrap gap-2" role="tablist" aria-label="Preset source">
        {ODDLING_EXPLORE_TABS.map(({ id, label }) => <button key={id} type="button" role="tab" aria-selected={source === id} onClick={() => onSource(id)} className={chip(source === id)}>{label}</button>)}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Show characters">
        <span className="font-vx-mono text-[9px] font-bold tracking-[0.12em] text-vx-fg-faint">SHOW</span>
        {ODDLING_KIND_FILTERS.map(({ id, label }) => (
          <button key={id} type="button" aria-pressed={kind === id} disabled={!counts[id]} onClick={() => onKind(id)} className={`${chip(kind === id)} disabled:cursor-not-allowed disabled:opacity-40`}>
            {label} · {counts[id]}
          </button>
        ))}
      </div>
    </>
  );
}
