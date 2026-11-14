'use client';
import { useReducedMotion } from 'motion/react';
import VeyCharacter from '../../_components/VeyCharacter';
import { useGenerationProgress } from '../../_components/GenerationStatusBar';

const pad = (value) => String(value).padStart(2, '0');

// The status bar above the canvas prints the percent, so the canvas prints the
// other half of the same reading: the bar's own clock. One figure is never on
// the screen twice. Until the bar has the job, this is the old "…".
export function GeneratingProgress({ jobId }) {
  const reduced = useReducedMotion();
  const progress = useGenerationProgress(jobId);
  const seconds = progress ? Math.floor(progress.elapsedMs / 1000) : 0;
  return (
    <>
      <div className="mt-2 flex items-center justify-center gap-3">
        {/* Beside the figure, at its height: the canvas can be 180px tall, with no room above it.
            The helper's own shadow is sized for the full-height mascot. */}
        <div aria-hidden="true" className="w-10 shrink-0 [&>svg]:drop-shadow-none">
          <VeyCharacter pose="thinking" reducedMotion={reduced !== false} />
        </div>
        {/* The bar above announces the percent; a bare "02:15" read aloud adds nothing. */}
        <div aria-hidden="true" className="font-vx-mono text-[42px] font-bold leading-none vx-num">{progress ? `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}` : '…'}</div>
      </div>
    </>
  );
}
