'use client';

import { chip } from './oddlingStyles';
import { characterOptionLabel } from '../_lib/characterOptions';
import { ODDLING_STUDIO_SECTIONS, groupById, sectionProgress } from '../_lib/oddlingStudio';

function TraitGroup({ group, value, onChange }) {
  return (
    <fieldset className="space-y-2">
      <legend className="font-vx-mono text-[9px] font-bold uppercase tracking-[0.12em] text-vx-fg-muted">{group.label}</legend>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => onChange(group.id, '')} aria-pressed={!value} className={chip(!value)}>Any</button>
        {group.options.map(([label]) => (
          <button key={label} type="button" onClick={() => onChange(group.id, label)} aria-pressed={value === label} className={chip(value === label)}>
            {characterOptionLabel(group.id, label)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

// Sections open and close on their own, so a trait in one can be compared with
// another; each header says how many of its groups already have a choice.
export function OddlingTraitSections({ picks, openSections, onToggle, onPick }) {
  return (
    <div className="mt-3 divide-y divide-vx-border overflow-hidden rounded-2xl border border-vx-border">
      {ODDLING_STUDIO_SECTIONS.map((section) => {
        const open = openSections.includes(section.id);
        const { picked, total } = sectionProgress(section, picks);
        return (
          <section key={section.id}>
            <button type="button" onClick={() => onToggle(section.id)} aria-expanded={open} className="flex w-full items-center justify-between gap-4 bg-vx-base px-4 py-3.5 text-left">
              <span>
                <span className="block text-sm font-extrabold">{section.label}</span>
                <span className="mt-0.5 block text-[11px] text-vx-fg-faint">{section.hint}</span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className={`font-vx-mono text-[10px] font-bold ${picked ? 'text-vx-accent' : 'text-vx-fg-faint'}`}>
                  <span aria-hidden="true">{picked}/{total}</span>
                  <span className="sr-only">{picked} of {total} chosen</span>
                </span>
                <span aria-hidden="true" className="text-vx-accent">{open ? '−' : '+'}</span>
              </span>
            </button>
            {open && (
              <div className="space-y-5 bg-vx-panel p-4">
                {section.groupIds.map(groupById).filter(Boolean).map((group) => <TraitGroup key={group.id} group={group} value={picks[group.id] || ''} onChange={onPick} />)}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
