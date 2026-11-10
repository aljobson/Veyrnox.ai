'use client';

import { useEffect, useState } from 'react';

export const PERFORMANCE_PREVIEW_FLAG = 'veyrnox_performance';

export function usePerformancePreview() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const read = () => {
      try { setEnabled(localStorage.getItem(PERFORMANCE_PREVIEW_FLAG) === '1'); }
      catch { setEnabled(false); }
    };
    read();
    window.addEventListener('storage', read);
    window.addEventListener('veyrnox:performance-preview', read);
    return () => {
      window.removeEventListener('storage', read);
      window.removeEventListener('veyrnox:performance-preview', read);
    };
  }, []);
  return enabled;
}

export function enablePerformancePreview(storage = window.localStorage) {
  storage.setItem(PERFORMANCE_PREVIEW_FLAG, '1');
  window.dispatchEvent(new Event('veyrnox:performance-preview'));
}
