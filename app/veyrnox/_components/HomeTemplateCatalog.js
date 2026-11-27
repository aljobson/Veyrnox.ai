'use client';

import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { TemplateCatalog } from './TemplateCatalog';

function validCatalog(value) {
  return value && ['kling', 'seedance', 'veo', 'suno'].every(key => Array.isArray(value[key]));
}

export function HomeTemplateCatalog() {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setFailed(false);
    setAttempt(value => value + 1);
  }, []);

  useEffect(() => {
    let live = true;
    fetch('/api/template-catalog/ready')
      .then(response => response.ok ? response.json() : null)
      .then(body => {
        if (!live) return;
        if (validCatalog(body)) setCatalog(body);
        else setFailed(true);
      })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [attempt]);

  if (catalog) return <TemplateCatalog {...catalog} />;
  if (failed) return (
    <div role="status" className="rounded-2xl border border-vx-border bg-vx-panel p-6 text-sm text-vx-fg-body">
      <p>{t('app.templates.unavailable')}</p>
      <button type="button" onClick={retry} className="vx-press mt-4 min-h-11 rounded-full border border-vx-border px-5 font-bold text-vx-accent hover:border-vx-accent">{t('app.templates.retry')}</button>
    </div>
  );
  return <p role="status" className="rounded-2xl border border-dashed border-vx-border p-8 text-center text-sm text-vx-fg-muted">{t('app.templates.loading')}</p>;
}
