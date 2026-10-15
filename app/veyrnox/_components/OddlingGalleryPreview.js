'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import styles from './OddlingGalleryPreview.module.css';

function subscribeEnvironment(notify) {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  document.addEventListener('visibilitychange', notify);
  preference.addEventListener('change', notify);
  return () => {
    document.removeEventListener('visibilitychange', notify);
    preference.removeEventListener('change', notify);
  };
}

export function useGalleryMotionAllowed() {
  return useSyncExternalStore(subscribeEnvironment,
    () => !document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false);
}

// Presentation only: no generation, upload, audio, or credit-bearing action.
export function OddlingGalleryPreview({ id, playing, children }) {
  const frame = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!frame.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.05 });
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);
  const variant = [...id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 3;
  return (
    <div ref={frame} data-testid={`oddling-preview-${id}`} data-preview-running={playing && visible}
      className="flex aspect-[4/5] items-center justify-center overflow-hidden bg-vx-base">
      <div className={`${styles.portrait} ${styles[`motion${variant}`]}`}>
        {children}
      </div>
    </div>
  );
}
