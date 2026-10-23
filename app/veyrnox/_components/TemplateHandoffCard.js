'use client';

import Link from 'next/link';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { tOr } from '../../../lib/i18n/translate.mjs';
import { TemplateArtwork } from './TemplateArtwork';
import { presetTitle } from '../_lib/tokens.js';
import { templateHandoffVisual, templateNeedsSource } from '../_lib/templateHandoff.js';

export function TemplateHandoffCard({ preset, canChooseSource = false, onChooseSource }) {
  const { t } = useI18n();
  const visual = templateHandoffVisual(preset);
  const needs = templateNeedsSource(preset);
  if (!visual) return null;
  const title = presetTitle(preset.name);

  return (
    <section role="status" data-testid="create-template-handoff" className="mt-3 grid gap-4 rounded-xl border border-vx-accent/35 bg-vx-accent/[0.06] p-4 sm:grid-cols-[180px_1fr] sm:items-center">
      <div className="relative overflow-hidden rounded-lg border border-vx-border bg-vx-base" style={{ aspectRatio: visual.aspectRatio }}>
        {visual.kind === 'video' ? (
          <video
            src={visual.video}
            poster={visual.poster}
            controls
            muted
            playsInline
            preload="none"
            aria-label={t('presets.detail.preview', { title })}
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <TemplateArtwork preset={preset} eyebrow={t('app.create.templateReference')} title={title} compact />
        )}
      </div>
      <div className="min-w-0">
        <div className="font-vx-mono text-[9px] font-bold tracking-[0.14em] text-vx-accent">{t('app.create.templateLinked')}</div>
        <h2 className="mt-1 text-sm font-extrabold text-vx-fg">{title}</h2>
        <p className="mt-1 text-xs text-vx-fg-muted">{t('app.create.templateSettingsLoaded')}</p>
        <p className="mt-1 text-xs text-vx-fg-muted">{t('app.create.templateReferenceOnly')}</p>
        {needs && <p className="mt-2 text-sm text-vx-fg-body">{tOr(t, `presets.needs.${preset.needsKey || preset.id}`, needs)}</p>}
        <div className="mt-3 flex flex-wrap gap-3 text-xs font-bold">
          {canChooseSource && <button type="button" onClick={onChooseSource} className="rounded-full border border-vx-accent/50 px-3 py-2 text-vx-accent hover:bg-vx-accent/10">{t('app.create.chooseTemplateSource')}</button>}
          <Link href={`/presets/${encodeURIComponent(preset.id)}`} className="rounded-full border border-vx-border px-3 py-2 text-vx-fg-body hover:border-vx-fg-muted">{t('app.create.reviewTemplate')}</Link>
        </div>
      </div>
    </section>
  );
}
