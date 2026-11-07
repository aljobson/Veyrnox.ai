'use client';
import { useEffect, useState } from 'react';
import { publicTemplateClip, isTemplateClipModel } from './templateClips.js';

export function useTemplateClipAvailable(id) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!publicTemplateClip(id)) return;
    let live = true;
    fetch(`/api/catalog?template_clip=${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(clip => { if (live) setState(clip?.id === id && isTemplateClipModel(clip.model) && Number.isInteger(clip.credits) && clip.credits > 0 && clip.durationSeconds === 5 ? clip : null); }, () => { if (live) setState(null); });
    return () => { live = false; };
  }, [id]);
  return publicTemplateClip(id) && state?.id === id ? state : null;
}
