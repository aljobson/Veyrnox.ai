'use client';
import { useI18n } from '../../../components/I18nProvider';
import { localeTag } from '../../../lib/i18n/locales.mjs';

import { sourceDurationLimit } from '../_lib/modelPricing';

export function SourceDurationCard({ model }) {
  const { t, locale } = useI18n();
  const maxSeconds = sourceDurationLimit(model);
  if (!maxSeconds) return null;
  return (
    <div data-assistant-target="create.duration" className="scroll-mt-24 rounded-2xl border border-vx-border bg-vx-panel p-5">
      <div className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">{t("app.create.duration.title")}</div>
      <div className="mt-3 text-sm font-bold text-vx-fg">{t("app.create.duration.follows")}</div>
      <p className="mt-1 text-xs text-vx-fg-muted">{t('app.create.duration.limit', { max: locale === 'en' ? maxSeconds : maxSeconds.toLocaleString(localeTag(locale)) })}</p>
      {model?.id === 'latentsync' && <p className="mt-2 text-xs text-vx-fg-muted">{t("app.create.duration.speech")}</p>}
    </div>
  );
}
