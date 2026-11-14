'use client';
import { useI18n } from '../../../components/I18nProvider.jsx';
import { imageTemplateNeedsPhoto } from '../_lib/imageTemplateModels.js';
import { useState } from 'react';

// Preview artwork and photo requirements are independent. Failed images leave the gradient visible.
export function TemplateImage({ preset, className = '' }) {
  const { t } = useI18n();
  const needsPhoto = imageTemplateNeedsPhoto(preset);
  const [failedSource, setFailedSource] = useState(null);
  return <div className={`@container relative overflow-hidden ${className}`} style={{ background: preset.bg, aspectRatio: preset.previewAspect || preset.aspect?.replace(':', ' / ') }}>
    {preset.previewImage && failedSource !== preset.previewImage && <img
      src={preset.previewImage} alt="" loading="lazy"
      className="absolute inset-0 h-full w-full object-contain"
      onError={() => setFailedSource(preset.previewImage)}
    />}
    {needsPhoto && <p className="hidden @xs:block absolute inset-x-4 bottom-4 rounded-xl bg-vx-base p-3 text-sm text-vx-fg">{t('presets.use.photoRequired')}</p>}
    {needsPhoto && <p className="@xs:hidden absolute start-2 end-2 bottom-2 w-fit truncate rounded-full bg-vx-base px-2 py-0.5 font-vx-mono text-[10px] font-bold text-vx-fg">{t('presets.use.photoRequiredShort')}</p>}
  </div>;
}
