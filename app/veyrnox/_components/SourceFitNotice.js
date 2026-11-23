'use client';
import { useI18n } from '../../../components/I18nProvider.jsx';

export function SourceFitNotice({ fit }) {
  const { t } = useI18n();
  if (fit.blocked) {
    return <p role="alert" data-testid="source-fit-refused" className="mt-2 text-xs font-bold text-vx-danger">{t('app.create.sources.fit.refused', { min: fit.min, max: fit.max })}</p>;
  }
  if (fit.trimmed) return <p role="status" data-testid="source-fit-trimmed" className="mt-2 text-xs text-vx-fg-muted">{t('app.create.sources.fit.trimmed')}</p>;
  return null;
}
