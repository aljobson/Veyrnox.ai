'use client';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { TEMPLATE_PHOTO_COPY, TEMPLATE_PHOTO_LIMITS } from '../../../lib/templatePhotoGuidance.mjs';

const PHOTOS = {
  face: { src: '/examples/photo-face.jpg', width: 480, height: 480 },
  fullBody: { src: '/examples/photo-full-body.jpg', width: 440, height: 1073 },
};

function SceneDiagram() {
  return <svg viewBox="0 0 96 128" aria-hidden="true" className="h-32 w-24 shrink-0 text-vx-accent">
    <rect x="3" y="3" width="90" height="122" rx="8" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="6 4" />
    <circle cx="68" cy="30" r="9" fill="currentColor" opacity=".45" />
    <path d="M12 104 38 62l18 26 11-14 17 30Z" fill="currentColor" opacity=".7" />
  </svg>;
}

export function TemplatePhotoExample({ kind = 'face', limits = 'upload' }) {
  const { t } = useI18n();
  const photo = PHOTOS[kind], copy = t(TEMPLATE_PHOTO_COPY[kind] || TEMPLATE_PHOTO_COPY.scene);
  const rule = TEMPLATE_PHOTO_LIMITS[limits] || TEMPLATE_PHOTO_LIMITS.upload;
  return <figure className="flex items-center gap-4 rounded-xl border border-vx-accent/40 bg-vx-panel p-3" data-photo-example={kind}>
    {photo ? <img src={photo.src} width={photo.width} height={photo.height} alt={copy} loading="lazy" className="h-32 w-auto shrink-0 rounded-lg object-cover" /> : <SceneDiagram />}
    <figcaption className="min-w-0 text-sm text-vx-fg-body"><strong className="block text-vx-fg">{t('presets.photoExample.title')}</strong>{copy}<span className="mt-1 block text-xs text-vx-fg-muted">{t(rule.key, rule.values)}</span></figcaption>
  </figure>;
}
