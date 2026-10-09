'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';

// A landing tile whose backdrop is a gradient until a showcase clip exists.
// With a clip, it plays a muted loop, as decided by _lib/playbackPolicy:
//   - mouse: on hover or keyboard focus, and only while on screen
//   - touch: while on screen, one clip at a time, for at most 5 s (the
//     WCAG 2.2.2 line, so no pause control is needed)
//   - reduced motion, data-saver, or a slow connection on touch: never; the
//     poster (or gradient) stays put. Reduced motion is watched, so switching
//     it on mid-visit pauses playback instead of waiting for a reload.
// preload="none" means no bytes move until the first play, so 15 tiles cost
// nothing on load. A clip that fails to load keeps its still poster.
// The tile is the link, so the whole card is one target and the video is
// decoration only (aria-hidden, no controls, not focusable).

import { playbackMode, TOUCH_MAX_PLAY_MS } from '../_lib/playbackPolicy';

const VIEW_THRESHOLD = 0.4;

// The one touch tile allowed to be playing. Starting another stops it, so
// scrolling a phone through the preset grid never decodes several at once.
let activeTouchStop = null;

export function MediaTile({ href, clip, mediaClassName = '', mediaStyle, className = '', style, ariaLabel, onClick, footer, children }) {
  const rootRef = useRef(null);
  const videoRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);

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
  }, []);

  const showVideo = clip && !failed;

  return (
    <Link ref={rootRef} href={href} aria-label={ariaLabel} onClick={onClick} className={`group vx-tile ${className}`} style={style}>
      <div className={`relative overflow-hidden ${mediaClassName}`} style={mediaStyle}>
        {failed && clip?.poster && (
          <Image src={clip.poster} alt="" fill unoptimized className="object-cover" style={{ objectPosition: clip.objectPosition }} />
        )}
        {showVideo && (
          <video
            ref={videoRef}
            src={clip.video}
            poster={clip.poster}
            muted
            loop
            playsInline
            preload="none"
            aria-hidden="true"
            disablePictureInPicture
            disableRemotePlayback
            onPlaying={() => setPlaying(true)}
            onError={() => setFailed(true)}
            style={{ objectPosition: clip.objectPosition }}
            className={`absolute inset-0 h-full w-full object-cover pointer-events-none vx-tile-video ${
              playing || clip.poster ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}
        {children}
        {clip && (
          <span
            title={clip.title}
            className="absolute left-3 top-3 max-w-[calc(100%-1.5rem)] rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-white backdrop-blur-sm"
          >
            Viral inspiration
          </span>
        )}
      </div>
      {footer}
    </Link>
  );
}
