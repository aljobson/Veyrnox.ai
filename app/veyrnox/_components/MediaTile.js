'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ClipBadge } from './ClipBadge';

// A landing tile whose backdrop is a gradient until a showcase clip exists.
// With a clip, it plays a muted loop, as decided by _lib/playbackPolicy
// (the Library's cards share the same hook, _lib/useClipPlayback):
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

import { useClipPlayback } from '../_lib/useClipPlayback';

export function MediaTile({ href, clip, mediaClassName = '', mediaStyle, className = '', style, ariaLabel, onClick, footer, children, uncroppedOnMobile = false, imageSizes = '(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 25vw' }) {
  const rootRef = useRef(null);
  const videoRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [nearViewport, setNearViewport] = useState(false);
  const clipVideo = clip?.video;

  // Posters are cheap and useful immediately. Video elements and their
  // playback observers are only mounted shortly before a tile can be seen,
  // keeping the long landing page from creating dozens of media players.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !clipVideo) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => setNearViewport(entry.isIntersecting),
      { rootMargin: '600px 0px' },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [clipVideo]);

  useClipPlayback(rootRef, videoRef, nearViewport);

  const showVideo = clip && nearViewport && !failed;
  const mediaFit = uncroppedOnMobile ? 'object-contain lg:object-cover' : 'object-cover';

  return (
    <Link ref={rootRef} href={href} aria-label={ariaLabel} onClick={onClick} className={`group vx-tile ${className}`} style={style}>
      <div className={`relative overflow-hidden ${mediaClassName}`} style={mediaStyle}>
        {clip?.poster && (
          <Image src={clip.poster} alt="" sizes={imageSizes} fill className={mediaFit} style={{ objectPosition: clip.objectPosition, objectFit: clip.objectFit }} />
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
            style={{ objectPosition: clip.objectPosition, objectFit: clip.objectFit }}
            className={`absolute inset-0 h-full w-full ${mediaFit} pointer-events-none vx-tile-video ${
              playing || clip.poster ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}
        {children}
        {clip && <ClipBadge clip={clip} />}
      </div>
      {footer && <Fragment key="footer">{footer}</Fragment>}
    </Link>
  );
}
