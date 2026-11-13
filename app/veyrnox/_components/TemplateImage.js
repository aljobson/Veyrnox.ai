'use client';
import { useState } from 'react';

// The artwork is a separate release. Missing files leave the gradient visible.
export function TemplateImage({ preset, className = '' }) {
  const [failedSource, setFailedSource] = useState(null);
  return <div className={`relative overflow-hidden ${className}`} style={{ background: preset.bg, aspectRatio: preset.previewAspect || preset.aspect?.replace(':', ' / ') }}>
    {preset.previewImage && failedSource !== preset.previewImage && <img
      src={preset.previewImage} alt="" loading="lazy"
      className="absolute inset-0 h-full w-full object-contain"
      onError={() => setFailedSource(preset.previewImage)}
    />}
  </div>;
}
