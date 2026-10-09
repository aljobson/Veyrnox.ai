'use client';

import { useEffect, useRef, useState } from 'react';
import { playbackMode } from '../_lib/playbackPolicy';

// The landing film: a muted loop that starts once half of it is on screen and
// stops when it leaves. It runs longer than five seconds, so it carries its
// own Play/Pause button (WCAG 2.2.2); pressing Pause holds it until the
// visitor presses Play. Reduced motion, data-saver or a slow connection on
// touch: it never starts by itself, and the button still works.
// preload="none" means no bytes move until the first play.

const VIEW_THRESHOLD = 0.5;

export function FilmPlayer({ film, describedBy }) {
  const videoRef = useRef(null);
  // The visitor pressed Pause: scrolling back must not restart it for them.
  const heldRef = useRef(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const connection = navigator.connection;
    const mode = playbackMode({
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      saveData: Boolean(connection?.saveData),
      effectiveType: connection?.effectiveType,
      canHover: window.matchMedia('(hover: hover) and (pointer: fine)').matches,
    });
    if (mode === 'off') return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) video.pause();
        else if (!heldRef.current) video.play().catch(() => {});
      },
      { threshold: VIEW_THRESHOLD },
    );
    observer.observe(video);
    return () => observer.disconnect();
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
      <div className="overflow-hidden rounded-2xl border border-vx-border bg-[#0a0a0b]">
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
          aria-describedby={describedBy}
          disablePictureInPicture
          disableRemotePlayback
          onPlaying={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          className="block h-auto w-full"
        />
      </div>
      {/* On a phone the film is under 200px tall and a 44px button would
          cover a quarter of it, so the button sits below. From sm up it lies
          on the film, in fixed light ink: the film is dark in both themes. */}
      <button
        type="button"
        onClick={toggle}
        className="vx-press mt-3 inline-flex min-h-11 items-center gap-2 rounded-full border border-vx-border px-4 text-[13px] font-bold text-vx-fg-body hover:text-vx-fg sm:absolute sm:bottom-3 sm:left-3 sm:mt-0 sm:border-transparent sm:bg-black/70 sm:text-white sm:backdrop-blur-sm sm:hover:bg-black/85 sm:hover:text-white"
      >
        <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3 fill-current">
          {playing ? <path d="M2 1h3v10H2zM7 1h3v10H7z" /> : <path d="M2.5 1 11 6l-8.5 5z" />}
        </svg>
        {playing ? 'Pause' : 'Play'}
      </button>
    </div>
  );
}
