'use client';
import { useRef, useState } from 'react';

const SPOOL_MIN = 5;
const SPOOL_GAIN = 4;

/**
 * An audio result drawn as a cassette. The browser's own audio controls stay underneath as the one
 * accessible way to play, seek and hear it; the cassette is decoration that follows them: the reels
 * turn while it plays, and the tape moves from the left spool to the right as it progresses.
 * Clicking the cassette is a mouse shortcut for play and pause. Reduced motion keeps the reels still.
 * @param {{ src: string, onError?: () => void, onLoadedData?: () => void, autoPlay?: boolean, label?: string }} props
 */
export function CassettePlayer({ src, onError, onLoadedData, autoPlay = false, label }) {
  const audio = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const left = SPOOL_MIN + SPOOL_GAIN * (1 - progress);
  const right = SPOOL_MIN + SPOOL_GAIN * progress;
  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {}); else el.pause();
  };
  return (
    <div className="vx-cassette flex w-full max-w-xl flex-col items-center gap-4" data-playing={playing}>
      <svg viewBox="0 0 160 100" aria-hidden="true" onClick={toggle} className="w-64 cursor-pointer select-none drop-shadow-[0_6px_14px_rgb(0_0_0/0.5)]">
        <rect x="2" y="2" width="156" height="96" rx="9" fill="#2a2724" stroke="#0e0d0c" strokeWidth="2" />
        <rect x="14" y="12" width="132" height="50" rx="5" fill="#f5f1e8" />
        <rect x="20" y="16" width="120" height="14" rx="2" fill="none" stroke="#1d1b17" strokeOpacity="0.35" strokeDasharray="3 2" />
        <rect x="32" y="38" width="96" height="18" rx="9" fill="#1d1b17" />
        <circle cx="52" cy="47" r={left} fill="#6b4a2f" />
        <circle cx="108" cy="47" r={right} fill="#6b4a2f" />
        {[52, 108].map((cx) => (
          <g key={cx} className="vx-reel">
            <circle cx={cx} cy="47" r="4.2" fill="#f5f1e8" />
            {[0, 60, 120, 180, 240, 300].map((deg) => (
              <rect key={deg} x={cx - 0.7} y="43" width="1.4" height="2.6" fill="#1d1b17" transform={`rotate(${deg} ${cx} 47)`} />
            ))}
          </g>
        ))}
        <path d="M30 98 L38 76 H122 L130 98 Z" fill="#3a3632" stroke="#0e0d0c" strokeWidth="1.5" />
        <circle cx="62" cy="87" r="3" fill="#0e0d0c" />
        <circle cx="98" cy="87" r="3" fill="#0e0d0c" />
      </svg>
      <audio
        ref={audio}
        src={src}
        controls
        autoPlay={autoPlay}
        aria-label={label}
        onError={onError}
        onLoadedData={onLoadedData}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setProgress(0); }}
        onTimeUpdate={(e) => {
          const { currentTime, duration } = e.currentTarget;
          setProgress(duration > 0 ? Math.min(1, currentTime / duration) : 0);
        }}
        className="w-full"
      />
    </div>
  );
}
