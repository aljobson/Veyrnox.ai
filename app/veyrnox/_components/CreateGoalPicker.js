'use client';
import { tOr } from '../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../components/I18nProvider';


import { CREATE_GOALS } from '../_lib/starterModels';

export function CreateGoalPicker({ goal, onChange }) {
  const { t } = useI18n();
  return (
    <div className="rounded-2xl border border-vx-border bg-vx-panel p-5">
      <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">{t("app.create.goal.title")}</div>
      <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label={t("app.create.goal.label")}>
        {CREATE_GOALS.map((option) => (
          <button
            key={option.id}
            data-testid={`create-goal-${option.id}`}
            type="button"
            aria-pressed={goal === option.id}
            onClick={() => onChange(option.id)}
            className={`min-h-11 rounded-xl border px-3 py-2 text-start text-sm font-bold transition-colors ${
              goal === option.id
                ? 'border-vx-accent bg-vx-accent/[0.07] text-vx-fg'
                : 'border-vx-border text-vx-fg-body hover:border-vx-fg-muted hover:text-vx-fg'
            }`}
          >
            {tOr(t, `app.create.goal.${option.id}`, option.label)}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-vx-fg-muted">{t("app.create.goal.help")}</p>
    </div>
  );
}
