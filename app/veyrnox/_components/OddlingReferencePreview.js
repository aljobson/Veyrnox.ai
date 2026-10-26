'use client';

import { useEffect, useRef, useState } from 'react';

export function OddlingReferencePreview({ file, alt }) {
  const canvas = useRef(null);
  const [previewState, setPreviewState] = useState('loading');
  useEffect(() => {
    let cancelled = false;
    let bitmap = null;
    setPreviewState('loading');
    if (typeof createImageBitmap !== 'function') {
      setPreviewState('failed');
      return () => { cancelled = true; };
    }
    createImageBitmap(file, { imageOrientation: 'from-image' }).then((decoded) => {
      if (cancelled) { decoded.close(); return; }
      bitmap = decoded;
      const target = canvas.current;
      if (!target) return;
      const scale = Math.min(1, 1024 / decoded.width, 1024 / decoded.height);
      target.width = Math.max(1, Math.round(decoded.width * scale));
      target.height = Math.max(1, Math.round(decoded.height * scale));
      const context = target.getContext('2d');
      if (!context) { setPreviewState('failed'); return; }
      context.drawImage(decoded, 0, 0, target.width, target.height);
      setPreviewState('ready');
    }).catch(() => { if (!cancelled) setPreviewState('failed'); });
    return () => { cancelled = true; bitmap?.close(); };
  }, [file]);
  return (
    <div className="mt-3">
      <canvas ref={canvas} hidden={previewState !== 'ready'} data-testid="oddling-reference-image" role="img" aria-label={alt} className="max-h-48 w-full rounded-xl object-cover" />
      {previewState !== 'ready' && <p data-testid="oddling-reference-fallback" className="rounded-xl border border-white/10 bg-black/20 px-3 py-4 text-xs text-white/65">{alt}</p>}
    </div>
  );
}
