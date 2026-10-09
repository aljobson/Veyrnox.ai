'use client';

import { useEffect, useRef, useState } from 'react';
import { playbackMode } from '../_lib/playbackPolicy';

// Landing films: muted loops that start once half on screen and stop when
// they leave. Looping motion carries its own Play/Pause button (WCAG 2.2.2);
// pressing Pause holds it until the
// visitor presses Play. Reduced motion, data-saver or a slow connection on
// touch: it never starts by itself, and the button still works.
// preload="none" means no bytes move until the first play. A film that fails
// to load keeps its poster and loses the button, which would do nothing.

const VIEW_THRESHOLD = 0.5;

export function FilmPlayer({ film, label = 'the film', aspectRatio = '16 / 9' }) {
  const videoRef = useRef(null);
  // The visitor pressed Pause: scrolling back must not restart it for them.
  const heldRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const connection = navigator.connection;
    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const startsItself = () => playbackMode({
      reducedMotion: reducedQuery.matches,
      saveData: Boolean(connection?.saveData),
      effectiveType: connection?.effectiveType,
      canHover: window.matchMedia('(hover: hover) and (pointer: fine)').matches,
    }) !== 'off';

    // Off screen it always stops, however it was started. A fast flick can
    // deliver several entries at once, oldest first: only the last is true now.
    const observer = new IntersectionObserver(
      (entries) => {
        const onScreen = entries.at(-1).isIntersecting;
        if (!onScreen) video.pause();
        else if (startsItself() && !heldRef.current && !video.error) video.play().catch(() => {});
      },
      { threshold: VIEW_THRESHOLD },
    );
    observer.observe(video);
    // Reduced motion switched on mid-visit stops it; Play still works.
    const onReducedChange = (event) => { if (event.matches) video.pause(); };
    reducedQuery.addEventListener('change', onReducedChange);
    return () => {
      observer.disconnect();
      reducedQuery.removeEventListener('change', onReducedChange);
    };
  }, []);

  function toggle() {
    const video = videoRef.current;
    if (!video) return;
    heldRef.current = !video.paused;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  return (
    <div className="relative">
      {/* Reserve the film's full frame before the poster arrives. */}
      <div style={{ aspectRatio }} className="aspect-video overflow-hidden rounded-2xl border border-vx-border bg-[#0a0a0b]">
        <video
          ref={videoRef}
          src={film.video}
          poster={film.poster}
          width={film.width}
          height={film.height}
          muted
          loop
          playsInline
          preload="none"
          // Decoration for a screen reader: the section's heading and
          // summary say what it shows, and the button below controls it.
          aria-hidden="true"
          disablePictureInPicture
          disableRemotePlayback
          // `play`, not `playing`: the button must say Pause from the press,
          // not once the first frame has buffered.
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => setFailed(true)}
          className="block h-full w-full"
        />
      </div>
      {/* On a phone the button sits below to keep the full frame clear. From sm up it lies
          on the film, in fixed light ink: the film is dark in both themes. */}
      {!failed && (
      <button
        type="button"
        onClick={toggle}
        aria-label={`${playing ? 'Pause' : 'Play'} ${label}`}
        className="vx-press mt-3 inline-flex min-h-11 items-center gap-2 rounded-full border border-vx-border px-4 text-[13px] font-bold text-vx-fg-body hover:text-vx-fg sm:absolute sm:bottom-3 sm:left-3 sm:mt-0 sm:border-transparent sm:bg-black/70 sm:text-white sm:backdrop-blur-sm sm:hover:bg-black/85 sm:hover:text-white"
      >
        <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3 fill-current">
          {playing ? <path d="M2 1h3v10H2zM7 1h3v10H7z" /> : <path d="M2.5 1 11 6l-8.5 5z" />}
        </svg>
        {playing ? 'Pause' : 'Play'}
      </button>
      )}
    </div>
  );
}
