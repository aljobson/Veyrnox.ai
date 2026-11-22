'use client';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { TEMPLATE_PHOTO_COPY, TEMPLATE_PHOTO_LIMITS } from '../../../lib/templatePhotoGuidance.mjs';

// Plain outlines only: the guide never shows a real person.
const FIGURES = {
  face: <><circle cx="48" cy="50" r="23" fill="currentColor" opacity=".75" /><path d="M14 122c2-27 16-40 34-40s32 13 34 40Z" fill="currentColor" opacity=".5" /></>,
  fullBody: <><circle cx="48" cy="22" r="11" fill="currentColor" opacity=".75" /><path d="M33 37h30l5 39h-9l-2 41H50l-2-29-2 29h-7l-2-41h-9Z" fill="currentColor" opacity=".5" /></>,
  scene: <><circle cx="68" cy="30" r="9" fill="currentColor" opacity=".45" /><path d="M12 104 38 62l18 26 11-14 17 30Z" fill="currentColor" opacity=".7" /></>,
};

export function TemplatePhotoExample({ kind = 'face', limits = 'upload' }) {
  const { t } = useI18n();
  const figure = FIGURES[kind] ? kind : 'scene';
  const rule = TEMPLATE_PHOTO_LIMITS[limits] || TEMPLATE_PHOTO_LIMITS.upload;
  return <figure className="flex items-center gap-4 rounded-xl border border-vx-accent/40 bg-vx-panel p-3" data-photo-example={figure}>
    <svg viewBox="0 0 96 128" aria-hidden="true" className="h-32 w-24 shrink-0 text-vx-accent">
      <rect x="3" y="3" width="90" height="122" rx="8" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="6 4" />
      {FIGURES[figure]}
    </svg>
    <figcaption className="min-w-0 text-sm text-vx-fg-body"><strong className="block text-vx-fg">{t('presets.photoExample.title')}</strong>{t(TEMPLATE_PHOTO_COPY[figure])}<span className="mt-1 block text-xs text-vx-fg-muted">{t(rule.key, rule.values)}</span></figcaption>
  </figure>;
}
