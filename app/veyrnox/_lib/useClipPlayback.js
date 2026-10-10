'use client';

import { useEffect } from 'react';
import { playbackMode, TOUCH_MAX_PLAY_MS } from './playbackPolicy';

const VIEW_THRESHOLD = 0.4;

// The one touch clip allowed to be playing. Starting another stops it, so
// scrolling a phone through a grid never decodes several at once.
let activeTouchStop = null;

// Plays the muted loop in `videoRef` as _lib/playbackPolicy decides, watching
// `rootRef` (the card) for hover, focus and being on screen:
//   - mouse: on hover or keyboard focus, and only while on screen
//   - touch: while on screen, one clip at a time, for at most 5 s (the
//     WCAG 2.2.2 line, so no pause control is needed)
//   - reduced motion, data-saver, or a slow connection on touch: never.
//     Reduced motion is watched, so switching it on mid-visit pauses playback
//     instead of waiting for a reload.
export function useClipPlayback(rootRef, videoRef) {
  useEffect(() => {
    const root = rootRef.current;
    const video = videoRef.current;
    if (!root || !video) return undefined;

    const connection = navigator.connection;
    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const mode = playbackMode({
      reducedMotion: reducedQuery.matches,
      saveData: Boolean(connection?.saveData),
      effectiveType: connection?.effectiveType,
      canHover: window.matchMedia('(hover: hover) and (pointer: fine)').matches,
    });
    if (mode === 'off') return undefined;

    let onScreen = false;
    let engaged = false;
    let reduced = false;
    let timer;

    const stop = () => {
      window.clearTimeout(timer);
      video.pause();
      if (activeTouchStop === stop) activeTouchStop = null;
    };

    const start = () => {
      if (!video.paused) return;
      if (mode === 'inview') {
        if (activeTouchStop && activeTouchStop !== stop) activeTouchStop();
        activeTouchStop = stop;
        timer = window.setTimeout(stop, TOUCH_MAX_PLAY_MS);
      }
      video.play().catch(() => {});
    };

    const sync = () => {
      const shouldPlay = !reduced && onScreen && (mode === 'hover' ? engaged : true);
      if (shouldPlay) start();
      else stop();
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        sync();
      },
      { threshold: VIEW_THRESHOLD },
    );
    observer.observe(root);

    const engage = () => { engaged = true; sync(); };
    const release = () => { engaged = false; sync(); };
    const onReducedChange = (event) => { reduced = event.matches; sync(); };
    reducedQuery.addEventListener('change', onReducedChange);
    root.addEventListener('pointerenter', engage);
    root.addEventListener('pointerleave', release);
    root.addEventListener('focusin', engage);
    root.addEventListener('focusout', release);

    return () => {
      observer.disconnect();
      reducedQuery.removeEventListener('change', onReducedChange);
      root.removeEventListener('pointerenter', engage);
      root.removeEventListener('pointerleave', release);
      root.removeEventListener('focusin', engage);
      root.removeEventListener('focusout', release);
      stop();
    };
  }, [rootRef, videoRef]);
}
