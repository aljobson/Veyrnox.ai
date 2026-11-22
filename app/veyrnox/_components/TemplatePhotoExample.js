'use client';
import { useI18n } from '../../../components/I18nProvider.jsx';

const EXAMPLES = {
  face: { src: '/examples/photo-face.jpg', width: 480, height: 480, copy: 'presets.photoExample.face' },
  fullBody: { src: '/examples/photo-full-body.jpg', width: 274, height: 800, copy: 'presets.photoExample.fullBody' },
};

export function TemplatePhotoExample({ kind = 'face' }) {
  const { t } = useI18n();
  const limits = t('presets.photoExample.limits', { size: 20, side: 256 });
  // A product or scene reference has no person to show, so it gets the file rules alone.
  if (kind === 'limits') return <p className="text-xs text-vx-fg-muted" data-photo-example="limits">{limits}</p>;
  const example = EXAMPLES[kind] || EXAMPLES.face;
  const copy = t(example.copy);
  return <figure className="flex items-center gap-4 rounded-xl border border-vx-accent/40 bg-vx-panel p-3" data-photo-example={kind}>
    <img src={example.src} width={example.width} height={example.height} alt={copy} loading="lazy" className="h-32 w-auto shrink-0 rounded-lg object-cover" />
    <figcaption className="min-w-0 text-sm text-vx-fg-body"><strong className="block text-vx-fg">{t('presets.photoExample.title')}</strong>{copy}<span className="mt-1 block text-xs text-vx-fg-muted">{limits}</span></figcaption>
  </figure>;
}
