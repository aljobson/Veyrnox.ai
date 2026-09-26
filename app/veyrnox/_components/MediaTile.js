'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

// A landing tile whose backdrop is a gradient until a showcase clip exists.
// With a clip, it plays a muted loop:
//   - fine pointer (mouse): on hover or keyboard focus, and only while on screen
//   - touch: while the tile is on screen (there is no hover to wait for)
//   - prefers-reduced-motion, or the data-saver flag: never; the poster (or
//     gradient) stays put. Reduced motion is watched, so switching it on
//     mid-visit pauses playback instead of waiting for a reload.
// preload="none" means no bytes move until the first play, so 15 tiles cost
// nothing on load. A clip that fails to load drops out and the gradient stays.
// The tile is the link, so the whole card is one target and the video is
// decoration only (aria-hidden, no controls, not focusable).

const VIEW_THRESHOLD = 0.4;

export function MediaTile({ href, clip, mediaClassName = '', mediaStyle, className = '', style, children }) {
  const rootRef = useRef(null);
  const videoRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const video = videoRef.current;
    if (!root || !video) return undefined;
    if (navigator.connection?.saveData) return undefined;
    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reducedQuery.matches) return undefined;

    const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    let onScreen = false;
    let engaged = false;
    let reduced = false;

    const sync = () => {
      const shouldPlay = !reduced && onScreen && (canHover ? engaged : true);
      if (shouldPlay) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
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
      video.pause();
    };
  }, []);

  const showVideo = clip && !failed;

  return (
    <Link ref={rootRef} href={href} className={`group vx-tile ${className}`} style={style}>
      <div className={`relative overflow-hidden ${mediaClassName}`} style={mediaStyle}>
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
            className={`absolute inset-0 h-full w-full object-cover pointer-events-none vx-tile-video ${
              playing || clip.poster ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}
        {children}
      </div>
    </Link>
  );
}
