'use client';
import { tOr } from '../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../components/I18nProvider';

import Link from 'next/link';
import { SKILLS, SKILL_GROUPS } from '../../_lib/studioSkills';

/**
 * The Studio skills (ADR-0073): always on the empty chat, grouped by what they help with. Choosing one starts the chat with
 * that skill's instructions; it never makes anything and never spends Credits (its draft opens in the Studio, where the
 * person presses Generate).
 */
export function SkillsPanel({ selectedId, onPick, disabled }) {
  const { t } = useI18n();
  return (
    <section data-assistant-target="chat.skills" aria-label={t("label.Studio skills")} className="mx-auto mt-8 w-full max-w-[760px] text-start">
      <h2 className="font-vx-mono text-[11px] tracking-[0.14em] text-vx-fg-muted">{t("app.chat.skills.title")}</h2>
      <p className="mt-1 text-sm text-vx-fg-muted">{t("app.chat.skills.help")}</p>
      <Link href="/app/film-studio" className="mt-3 inline-block text-sm font-semibold text-vx-accent">{t("app.chat.skills.film")}</Link>
      {SKILL_GROUPS.map((group) => (
        <div key={group} className="mt-4">
          <h3 className="text-xs font-semibold text-vx-fg-muted">{tOr(t, `app.chat.skill.${group}`, group)}</h3>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {SKILLS.filter((s) => s.group === group).map((s) => (
              <li key={s.id}>
                <button type="button" disabled={disabled} aria-pressed={selectedId === s.id} onClick={() => onPick(s.id)}
                  className={`flex h-full w-full items-center gap-3 rounded-2xl border p-3 text-start transition-colors disabled:opacity-50 ${selectedId === s.id ? 'border-vx-accent bg-vx-panel' : 'border-vx-border bg-vx-panel hover:border-vx-accent'}`}>
                  <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-vx-base"><span className="size-2.5 rounded-full bg-vx-accent" /></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{tOr(t, `app.chat.skill.${s.id}.name`, s.name)}</span>
                    <span className="mt-0.5 block text-xs text-vx-fg-muted">{tOr(t, `app.chat.skill.${s.id}.blurb`, s.blurb)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
