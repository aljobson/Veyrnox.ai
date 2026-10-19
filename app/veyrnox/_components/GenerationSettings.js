'use client';
import { useI18n } from '../../../components/I18nProvider';
import { localeTag } from '../../../lib/i18n/locales.mjs';

import { seedIsInvalid, SEED_MAX } from '../_lib/generationSettings';

// Seed and negative prompt, for the models whose capability record declares
// them (catalog `capabilities.inputs`). The gateway validates both again
// against the same record (lib/modelCapabilities.js), so this is a form, not
// a guard.

export function GenerationSettings({ model, seed, onSeed, negative, onNegative }) {
  const { t, locale } = useI18n();
  if (!model?.takesSeed && !model?.takesNegative) return null;
  const bad = seedIsInvalid(seed);
  return (
    <details className="rounded-2xl border border-vx-border bg-vx-panel p-5">
      <summary className="cursor-pointer font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">{t("app.create.settings.title")}</summary>
      {model.takesSeed && (
        <div className="mt-4">
          <label htmlFor="vx-seed" className="block text-[13px] text-vx-fg-body">{t("app.create.settings.seed")}</label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="vx-seed"
              inputMode="numeric"
              value={seed}
              onChange={(e) => onSeed(e.target.value.trim())}
              placeholder={t("app.create.settings.random")}
              aria-invalid={bad}
              aria-describedby="vx-seed-help"
              className="min-w-0 flex-1 rounded-lg border border-vx-field bg-vx-base px-3 py-2 font-vx-mono text-[13px]"
            />
            <button
              type="button"
              onClick={() => onSeed(String(Math.floor(Math.random() * SEED_MAX)))}
              className="font-vx-mono text-[11px] font-bold rounded-full px-3.5 py-1.5 border border-vx-border text-vx-fg-muted hover:text-vx-fg"
            >
              {t("app.create.settings.roll")}</button>
          </div>
          <p id="vx-seed-help" aria-live="polite" className={`mt-1.5 text-[12px] ${bad ? 'text-vx-danger' : 'text-vx-fg-muted'}`}>
            {bad ? t('app.create.settings.range', { max: locale === 'en' ? SEED_MAX : SEED_MAX.toLocaleString(localeTag(locale), { useGrouping: false }) }) : t("app.create.settings.help")}
          </p>
        </div>
      )}
      {model.takesNegative && (
        <div className="mt-4">
          <label htmlFor="vx-negative" className="block text-[13px] text-vx-fg-body">{t("app.create.settings.exclude")}</label>
          <textarea
            id="vx-negative"
            value={negative}
            onChange={(e) => onNegative(e.target.value)}
            maxLength={2000}
            rows={2}
            placeholder={t("app.create.settings.example")}
            className="mt-1.5 w-full rounded-lg border border-vx-field bg-vx-base px-3 py-2 text-[13px]"
          />
        </div>
      )}
    </details>
  );
}
