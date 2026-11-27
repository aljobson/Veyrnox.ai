'use client';

import Link from 'next/link';
import { useI18n } from '../../../components/I18nProvider';

// Mobile Create exposes Creative tools under "Start from". Keep the web entry
// in the same point of the journey so customers do not need to know the hidden
// /app/features route before they can choose a guided workflow.
export function CreateStartFrom() {
  const { t } = useI18n();
  return (
    <section aria-labelledby="create-start-from-title" className="rounded-2xl border border-vx-border bg-vx-panel p-5">
      <h2 id="create-start-from-title" className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-fg-muted">
        {t('app.create.startFrom')}
      </h2>
      <Link
        href="/app/features"
        data-testid="create-start-creative-tools"
        className="vx-press mt-3 flex min-h-14 items-center gap-3 rounded-xl border border-vx-border px-3 py-3 text-start transition-colors hover:border-vx-accent"
      >
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-vx-accent/10 text-lg text-vx-accent">✦</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-black text-vx-fg">{t('app.create.creativeTools')}</span>
          <span className="mt-0.5 block text-xs leading-5 text-vx-fg-muted">{t('app.features.intro')}</span>
        </span>
        <span aria-hidden="true" className="shrink-0 text-vx-accent">→</span>
      </Link>
    </section>
  );
}
