'use client';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { imageTemplateNeedsPhoto } from '../_lib/imageTemplateModels.js';
import { useState } from 'react';

// The artwork is a separate release. Missing files leave the gradient visible.
export function TemplateImage({ preset, className = '' }) {
  const { t } = useI18n();
  const needsPhoto = imageTemplateNeedsPhoto(preset);
  const [failedSource, setFailedSource] = useState(null);
  return <div className={`relative overflow-hidden ${className}`} style={{ background: preset.bg, aspectRatio: preset.previewAspect || preset.aspect?.replace(':', ' / ') }}>
    {!needsPhoto && preset.previewImage && failedSource !== preset.previewImage && <img
      src={preset.previewImage} alt="" loading="lazy"
      className="absolute inset-0 h-full w-full object-contain"
      onError={() => setFailedSource(preset.previewImage)}
    />}
    {needsPhoto && <p className="absolute inset-x-4 bottom-4 rounded-xl bg-vx-base p-3 text-sm text-vx-fg">{t('presets.use.photoRequired')}</p>}
  </div>;
}
