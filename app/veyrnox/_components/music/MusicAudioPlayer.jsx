'use client';

import { useRef, useState } from 'react';
import { musicPreviewAudioUrl } from '../../_lib/music/previewAudio';

const HEIGHTS = ['h-2', 'h-4', 'h-6', 'h-3', 'h-5', 'h-8', 'h-4', 'h-7', 'h-3', 'h-6', 'h-5', 'h-2', 'h-7', 'h-4', 'h-8', 'h-3', 'h-5', 'h-6', 'h-2', 'h-4', 'h-7', 'h-3', 'h-5', 'h-2'];

export function MusicAudioPlayer({ songId, title, compact = false }) {
  const [source] = useState(() => musicPreviewAudioUrl(songId));
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const audioRef = useRef(null);

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) await audio.play();
    else audio.pause();
  }

  return (
    <div className={compact ? 'mt-3' : 'rounded-2xl border border-vx-border bg-vx-panel p-4'}>
      <div aria-hidden="true" className="mb-3 flex h-8 items-center gap-1 overflow-hidden text-vx-accent">
        {HEIGHTS.map((height, index) => <span key={index} className={`w-1 shrink-0 rounded-full bg-current opacity-70 ${height}`} />)}
      </div>
      {source ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <button type="button" onClick={togglePlayback} disabled={!ready} aria-pressed={playing} className="vx-press min-h-10 shrink-0 rounded-full border border-vx-border px-4 text-sm font-bold text-vx-fg hover:border-vx-accent disabled:cursor-wait disabled:opacity-50">
            {!ready ? 'Loading preview' : playing ? 'Pause preview' : 'Play preview'}
          </button>
          <audio ref={audioRef} aria-label={`Preview ${title}`} src={source} controls preload="metadata" onCanPlay={() => setReady(true)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} className="h-10 w-full" />
        </div>
      ) : <div className="vx-shimmer h-10 rounded-full bg-vx-panel-raised" />}
      {!compact && <p className="mt-2 text-xs text-vx-fg-muted">Deterministic browser tone for interaction testing—not generated music.</p>}
    </div>
  );
}
