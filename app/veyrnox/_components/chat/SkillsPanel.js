'use client';
import { SKILLS, SKILL_GROUPS } from '../../_lib/studioSkills';

/**
 * The Studio skills (ADR-0073): always on the empty chat, grouped by what they help with. Choosing one starts the chat with
 * that skill's instructions; it never makes anything and never spends Credits (its draft opens in the Studio, where the
 * person presses Generate).
 */
export function SkillsPanel({ selectedId, onPick, disabled }) {
  return (
    <section aria-label="Studio skills" className="mx-auto mt-8 w-full max-w-[760px] text-left">
      <h2 className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-fg-muted">STUDIO SKILLS</h2>
      <p className="mt-1 text-sm text-vx-fg-muted">Pick one to get help making or editing something. It prepares the job; you press Generate in the Studio.</p>
      {SKILL_GROUPS.map((group) => (
        <div key={group} className="mt-4">
          <h3 className="text-xs font-semibold text-vx-fg-muted">{group}</h3>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {SKILLS.filter((s) => s.group === group).map((s) => (
              <li key={s.id}>
                <button type="button" disabled={disabled} aria-pressed={selectedId === s.id} onClick={() => onPick(s.id)}
                  className={`h-full w-full rounded-xl border p-3 text-left transition-colors disabled:opacity-50 ${selectedId === s.id ? 'border-vx-accent bg-vx-panel' : 'border-vx-border hover:border-vx-accent'}`}>
                  <span className="block text-sm font-semibold">{s.name}</span>
                  <span className="mt-0.5 block text-xs text-vx-fg-muted">{s.blurb}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
