'use client';

import Link from 'next/link';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { tOr } from '../../../lib/i18n/translate.mjs';
import { TemplateArtwork } from './TemplateArtwork';
import { presetTitle } from '../_lib/tokens.js';
import { templateHandoffVisual, templateNeedsSource } from '../_lib/templateHandoff.js';

export function TemplateHandoffCard({ preset, canChooseSource = false, onChooseSource, settings, onEdit }) {
  const { t } = useI18n();
  const visual = templateHandoffVisual(preset);
  const needs = templateNeedsSource(preset);
  if (!visual) return null;
  const title = presetTitle(preset.name);
  const settingItems = [
    { id: 'model', target: 'models', label: t('app.create.modelHeading'), value: settings?.model },
    { id: 'aspect', target: 'aspect', label: t('app.create.aspectHeading'), value: settings?.aspect },
    { id: 'duration', target: 'duration', label: t('app.create.durationHeading'), value: settings?.duration },
    { id: 'cost', target: 'cost', label: t('app.create.totalCost'), value: settings?.cost },
  ].filter(item => item.value);
  if (settings?.sourceRequired) settingItems.splice(settingItems.length - 1, 0, {
    id: 'source',
    target: 'upload',
    label: t('app.create.sources.image.label'),
    value: settings.sourceLabel || t('app.create.chooseTemplateSource'),
  });

  return (
    <section data-testid="create-template-handoff" className="mt-3 grid gap-4 rounded-xl border border-vx-accent/35 bg-vx-accent/[0.06] p-4 sm:grid-cols-[180px_1fr] sm:items-center">
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
        <p role="status" className="mt-1 text-xs text-vx-fg-muted">{t('app.create.templateSettingsLoaded')}</p>
        <p className="mt-1 text-xs text-vx-fg-muted">{t('app.create.templateReferenceOnly')}</p>
        {needs && <p className="mt-2 text-sm text-vx-fg-body">{tOr(t, `presets.needs.${preset.needsKey || preset.id}`, needs)}</p>}
        {preset.sourceAspect && <p className="mt-2 text-sm font-bold text-vx-fg-body">{t('presets.detail.sourceAspect', { aspect: preset.sourceAspect })}</p>}
        {settings && (
          <button
            type="button"
            data-testid="template-setting-prompt"
            onClick={() => onEdit?.('prompt')}
            aria-label={`${t('mobile.prompt')}: ${(settings.prompt || t('app.create.promptOrPreset')).slice(0, 160)}`}
            className="mt-4 w-full rounded-xl border border-vx-border bg-vx-base/70 px-3 py-2.5 text-start hover:border-vx-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent"
          >
            <span className="block font-vx-mono text-[9px] font-bold tracking-[0.12em] text-vx-fg-muted">{t('mobile.prompt')}</span>
            <span className="mt-1 line-clamp-2 block text-xs leading-5 text-vx-fg-body">{settings.prompt || t('app.create.promptOrPreset')}</span>
          </button>
        )}
        {settingItems.length > 0 && (
          <div data-testid="template-settings-summary" className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-3">
            {settingItems.map(item => (
              <button
                key={item.id}
                type="button"
                data-testid={`template-setting-${item.id}`}
                onClick={() => onEdit?.(item.target)}
                aria-label={`${item.label}: ${item.value}`}
                className="min-h-14 rounded-xl border border-vx-border bg-vx-base/70 px-3 py-2 text-start hover:border-vx-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent"
              >
                <span className="block font-vx-mono text-[9px] font-bold tracking-[0.1em] text-vx-fg-muted">{item.label}</span>
                <span className="mt-1 block truncate text-xs font-extrabold text-vx-fg">{item.value}</span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-3 text-xs font-bold">
          {canChooseSource && <button type="button" onClick={onChooseSource} className="rounded-full border border-vx-accent/50 px-3 py-2 text-vx-accent hover:bg-vx-accent/10">{t('app.create.chooseTemplateSource')}</button>}
          <Link href={`/presets/${encodeURIComponent(preset.id)}`} className="rounded-full border border-vx-border px-3 py-2 text-vx-fg-body hover:border-vx-fg-muted">{t('app.create.reviewTemplate')}</Link>
        </div>
      </div>
    </section>
  );
}
